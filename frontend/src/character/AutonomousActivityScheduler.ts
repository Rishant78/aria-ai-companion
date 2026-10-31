import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { AttentionController, GestureHeadAccent } from './AttentionController';
import {
  AUTONOMOUS_ACTIVITY_DEFINITIONS,
  AUTONOMOUS_ACTIVITY_NAMES,
  AutonomousActivityEvaluator,
  INACTIVITY_TIER_THRESHOLDS,
} from './AutonomousActivityLibrary';
import type {
  AutonomousActivityDefinition,
  AutonomousActivityName,
  AutonomousActivityPhase,
} from './AutonomousActivityLibrary';
import type { AutonomousTorsoOffset, BreathingController } from './BreathingController';
import { EMOTION_PRIORITY_VALUES } from './ExpressionController';
import type { ExpressionController } from './ExpressionController';
import type { GestureController } from './GestureController';
import { UPPER_LIMB_BONE_NAMES } from './HandPoseLibrary';
import type { UpperLimbBoneName } from './HandPoseLibrary';
import type { AutonomousLowerBodyOffset, NaturalIdleController } from './NaturalIdleController';
import type { SpeechMouthController } from './SpeechMouthController';
import type { AvatarController } from './types';

export interface AutonomousActivitySchedulerConfig {
  /** Whether autonomous background activities are enabled (default: true). */
  enabled: boolean;
  /** Randomized [min, max] seconds between scheduler evaluations at 1.0x frequency (default: [11, 19]). */
  decisionIntervalRangeSeconds: readonly [number, number];
  /** Randomized [min, max] seconds of intentional stillness when stillness is chosen (default: [7, 13]). */
  stillnessIntervalRangeSeconds: readonly [number, number];
  /** Probability [0..1] of choosing quiet stillness at a decision window (default: 0.26). */
  stillnessProbability: number;
  /** Frequency multiplier in [0.25, 3.0] scaling decision frequency (default: 1.0). */
  frequencyMultiplier: number;
  /** Graceful recovery blend duration (seconds) when interrupted by user interaction (default: 0.6). */
  interruptionRecoverySeconds: number;
}

export const DEFAULT_AUTONOMOUS_ACTIVITY_CONFIG: AutonomousActivitySchedulerConfig = {
  enabled: true,
  decisionIntervalRangeSeconds: [11.0, 19.0],
  stillnessIntervalRangeSeconds: [7.0, 13.0],
  stillnessProbability: 0.26,
  frequencyMultiplier: 1.0,
  interruptionRecoverySeconds: 0.6,
};

export interface AutonomousActivitySchedulerDependencies {
  attention: AttentionController;
  breathing: BreathingController;
  naturalIdle: NaturalIdleController;
  gesture: GestureController;
  expression?: ExpressionController;
  speechMouth?: SpeechMouthController;
  config?: Partial<AutonomousActivitySchedulerConfig>;
  /** Optional deterministic RNG `[0, 1)` for reproducible automated tests. */
  rng?: () => number;
}

export interface TriggerAutonomousActivityOptions {
  /** Ignores per-activity cooldown when true (default: false). */
  bypassCooldown?: boolean;
  /** Allows manual dev triggering even during active conversation states when true (default: false). */
  force?: boolean;
}

export interface AutonomousActivityStatusSnapshot {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly tabHidden: boolean;
  readonly activeActivity: AutonomousActivityName | null;
  readonly activeActivityLabel: string;
  readonly phase: AutonomousActivityPhase;
  readonly phaseProgress: number;
  readonly frequencyMultiplier: number;
  readonly idleSeconds: number;
  readonly nextDecisionInSeconds: number;
  readonly lastCompletedActivity: AutonomousActivityName | null;
}

export type AutonomousActivityListener = (snapshot: AutonomousActivityStatusSnapshot) => void;

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function smootherstep01(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
}

function isKnownAutonomousActivity(name: string): name is AutonomousActivityName {
  return (AUTONOMOUS_ACTIVITY_NAMES as readonly string[]).includes(name);
}

/**
 * Context-aware orchestration controller for autonomous full-body activities.
 *
 * Strict Bone Ownership Guarantee:
 * - Writes ZERO bones or morph targets directly on the VRM.
 * - Coordinates `NaturalIdleController` (lower body), `GestureController` (upper limbs/fingers),
 *   `BreathingController` (spine/chest/shoulders), `AttentionController` (head accent while
 *   preserving camera-relative gaze), and `ExpressionController` (low-priority ambient mood).
 * - Runs inside the existing single render loop via `update(vrm, deltaTime)`.
 */
export class AutonomousActivityScheduler implements AvatarController {
  public readonly id = 'autonomousActivity';

  private readonly attention: AttentionController;
  private readonly breathing: BreathingController;
  private readonly naturalIdle: NaturalIdleController;
  private readonly gesture: GestureController;
  private readonly expression?: ExpressionController;
  private readonly speechMouth?: SpeechMouthController;
  private readonly rng: () => number;

  private config: AutonomousActivitySchedulerConfig;
  private enabled: boolean;
  private paused = false;
  private tabHidden = false;
  private frequencyMultiplier: number;

  // Continuous non-conversational idle timer & next decision countdown
  private idleSeconds = 0;
  private decisionCountdownSeconds: number;

  // Active activity state machine
  private activeActivity: AutonomousActivityName | null = null;
  private phase: AutonomousActivityPhase = 'idle';
  private phaseElapsedSeconds = 0;
  private anticipationDurationSeconds = 0.7;
  private executionDurationSeconds = 2.5;
  private recoveryDurationSeconds = 1.1;
  private postureAppliedInExecution = false;
  private ambientEmotionApplied = false;

  // Alternating lateral side (+1 = left, -1 = right) for balanced directional stretches/shifts
  private nextSideSign: 1 | -1 = 1;
  private activeSideSign: 1 | -1 = 1;

  // Anti-repetition & per-activity cooldown tracking
  private lastSelectedActivity: AutonomousActivityName | null = null;
  private secondLastSelectedActivity: AutonomousActivityName | null = null;
  private lastCompletedActivity: AutonomousActivityName | null = null;
  private readonly cooldowns = new Map<AutonomousActivityName, number>();

  // Zero-allocation biomechanical evaluator & interruption capture buffers
  private readonly evaluator = new AutonomousActivityEvaluator();
  private isInterruptedRecovery = false;
  private readonly capturedLimbMap = new Map<UpperLimbBoneName, THREE.Quaternion>();
  private capturedHasLimb = false;
  private capturedLimbWeight = 0;
  private readonly capturedPelvisPos: [number, number, number] = [0, 0, 0];
  private readonly capturedPelvisRot: [number, number, number] = [0, 0, 0];
  private readonly capturedTorso = {
    spinePitchRad: 0,
    spineYawRad: 0,
    spineRollRad: 0,
    chestPitchRad: 0,
    chestYawRad: 0,
    chestRollRad: 0,
    upperChestPitchRad: 0,
    leftShoulderLiftRad: 0,
    rightShoulderLiftRad: 0,
    leftShoulderProtractRad: 0,
    rightShoulderProtractRad: 0,
    breathDepthBoost: 0,
  };
  private readonly capturedLower = {
    pelvisTranslation: [0, 0, 0] as [number, number, number],
    pelvisRotationEuler: [0, 0, 0] as [number, number, number],
    leftHeelLiftRad: 0,
    rightHeelLiftRad: 0,
    leftKneeSwivelRad: 0,
    rightKneeSwivelRad: 0,
    suppressPostureTimer: false,
  };
  private readonly capturedHead = {
    rollRad: 0,
    pitchRad: 0,
  };

  // Live pre-allocated output wrappers for interrupted recovery scaling (zero per-frame allocations)
  private readonly scaledTorsoOut: {
    spinePitchRad: number;
    spineYawRad: number;
    spineRollRad: number;
    chestPitchRad: number;
    chestYawRad: number;
    chestRollRad: number;
    upperChestPitchRad: number;
    leftShoulderLiftRad: number;
    rightShoulderLiftRad: number;
    leftShoulderProtractRad: number;
    rightShoulderProtractRad: number;
    breathDepthBoost: number;
  } = {
    spinePitchRad: 0,
    spineYawRad: 0,
    spineRollRad: 0,
    chestPitchRad: 0,
    chestYawRad: 0,
    chestRollRad: 0,
    upperChestPitchRad: 0,
    leftShoulderLiftRad: 0,
    rightShoulderLiftRad: 0,
    leftShoulderProtractRad: 0,
    rightShoulderProtractRad: 0,
    breathDepthBoost: 0,
  };
  private readonly scaledPelvisPos: [number, number, number] = [0, 0, 0];
  private readonly scaledPelvisRot: [number, number, number] = [0, 0, 0];
  private readonly scaledLowerOut: {
    pelvisTranslation: [number, number, number];
    pelvisRotationEuler: [number, number, number];
    leftHeelLiftRad: number;
    rightHeelLiftRad: number;
    leftKneeSwivelRad: number;
    rightKneeSwivelRad: number;
    suppressPostureTimer: boolean;
  };
  private readonly scaledHeadOut: { rollRad: number; pitchRad: number } = {
    rollRad: 0,
    pitchRad: 0,
  };

  // Track last published live frame for seamless C0 interruption from any point in time
  private readonly lastLiveLimbMap = new Map<UpperLimbBoneName, THREE.Quaternion>();
  private lastLiveHasLimb = false;
  private lastLiveLimbWeight = 0;
  private readonly lastLiveTorso = {
    spinePitchRad: 0,
    spineYawRad: 0,
    spineRollRad: 0,
    chestPitchRad: 0,
    chestYawRad: 0,
    chestRollRad: 0,
    upperChestPitchRad: 0,
    leftShoulderLiftRad: 0,
    rightShoulderLiftRad: 0,
    leftShoulderProtractRad: 0,
    rightShoulderProtractRad: 0,
    breathDepthBoost: 0,
  };
  private readonly lastLivePelvisPos: [number, number, number] = [0, 0, 0];
  private readonly lastLivePelvisRot: [number, number, number] = [0, 0, 0];
  private lastLiveLeftHeel = 0;
  private lastLiveRightHeel = 0;
  private lastLiveLeftSwivel = 0;
  private lastLiveRightSwivel = 0;
  private lastLiveHeadRoll = 0;
  private lastLiveHeadPitch = 0;

  private readonly listeners = new Set<AutonomousActivityListener>();
  private cachedSnapshot: AutonomousActivityStatusSnapshot;

  constructor(deps: AutonomousActivitySchedulerDependencies) {
    this.attention = deps.attention;
    this.breathing = deps.breathing;
    this.naturalIdle = deps.naturalIdle;
    this.gesture = deps.gesture;
    this.expression = deps.expression;
    this.speechMouth = deps.speechMouth;
    this.rng = deps.rng ?? Math.random;

    this.config = {
      ...DEFAULT_AUTONOMOUS_ACTIVITY_CONFIG,
      ...deps.config,
    };
    this.enabled = this.config.enabled;
    this.frequencyMultiplier = clamp(this.config.frequencyMultiplier, 0.25, 3.0);

    for (const name of AUTONOMOUS_ACTIVITY_NAMES) {
      this.cooldowns.set(name, 0);
    }

    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      this.capturedLimbMap.set(boneName, new THREE.Quaternion());
      this.lastLiveLimbMap.set(boneName, new THREE.Quaternion());
    }

    this.capturedLower.pelvisTranslation = this.capturedPelvisPos;
    this.capturedLower.pelvisRotationEuler = this.capturedPelvisRot;
    this.scaledLowerOut = {
      pelvisTranslation: this.scaledPelvisPos,
      pelvisRotationEuler: this.scaledPelvisRot,
      leftHeelLiftRad: 0,
      rightHeelLiftRad: 0,
      leftKneeSwivelRad: 0,
      rightKneeSwivelRad: 0,
      suppressPostureTimer: false,
    };

    this.decisionCountdownSeconds = this.sampleDecisionIntervalSeconds();
    this.cachedSnapshot = this.createSnapshot();
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (!enabled && this.phase !== 'idle') {
      this.interruptActivity(this.config.interruptionRecoverySeconds);
    } else if (enabled && this.phase === 'idle') {
      this.decisionCountdownSeconds = this.sampleDecisionIntervalSeconds();
    }
    this.emitSnapshotIfChanged();
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public pause(): void {
    this.setPaused(true);
  }

  public resume(): void {
    this.setPaused(false);
  }

  public setPaused(paused: boolean): void {
    if (this.paused === paused) {
      return;
    }
    this.paused = paused;
    this.emitSnapshotIfChanged();
  }

  public get isTabHidden(): boolean {
    return this.tabHidden;
  }

  public setTabHidden(hidden: boolean): void {
    if (this.tabHidden === hidden) {
      return;
    }
    this.tabHidden = hidden;
    if (!hidden && this.phase === 'idle') {
      // Gentle settle buffer after returning to a backgrounded tab
      this.decisionCountdownSeconds = Math.max(this.decisionCountdownSeconds, 3.0);
    }
    this.emitSnapshotIfChanged();
  }

  public getFrequencyMultiplier(): number {
    return this.frequencyMultiplier;
  }

  public setFrequencyMultiplier(multiplier: number): void {
    const clamped = clamp(multiplier, 0.25, 3.0);
    if (Math.abs(clamped - this.frequencyMultiplier) < 1e-4) {
      return;
    }
    const ratio = this.frequencyMultiplier / clamped;
    this.frequencyMultiplier = clamped;
    if (this.phase === 'idle') {
      this.decisionCountdownSeconds = Math.max(0.5, this.decisionCountdownSeconds * ratio);
    }
    this.emitSnapshotIfChanged();
  }

  public getActiveActivity(): AutonomousActivityName | null {
    return this.activeActivity;
  }

  public getPhase(): AutonomousActivityPhase {
    return this.phase;
  }

  public getCooldownRemaining(activity: AutonomousActivityName): number {
    return this.cooldowns.get(activity) ?? 0;
  }

  public clearCooldowns(): void {
    for (const name of AUTONOMOUS_ACTIVITY_NAMES) {
      this.cooldowns.set(name, 0);
    }
  }

  public getIdleSeconds(): number {
    return this.idleSeconds;
  }

  /**
   * Manually or programmatically starts a specific autonomous full-body activity.
   * Returns `true` if started; `false` if unknown, on cooldown, or suppressed by context.
   */
  public triggerActivity(
    activity: AutonomousActivityName,
    options: TriggerAutonomousActivityOptions = {},
  ): boolean {
    if (typeof activity !== 'string' || !isKnownAutonomousActivity(activity)) {
      return false;
    }
    if (this.paused || this.tabHidden) {
      return false;
    }
    if (!options.force && this.isContextSuppressed()) {
      return false;
    }

    const cooldown = this.cooldowns.get(activity) ?? 0;
    if (!options.bypassCooldown && cooldown > 0) {
      return false;
    }

    const def = AUTONOMOUS_ACTIVITY_DEFINITIONS[activity];
    this.startActivityInternal(def);
    return true;
  }

  /**
   * Gracefully interrupts any in-flight autonomous activity, smoothly decaying all
   * multi-region offsets from their exact live values back to neutral rest without snapping.
   */
  public interruptActivity(
    releaseSeconds = this.config.interruptionRecoverySeconds,
  ): void {
    if (this.phase === 'idle') {
      this.clearAllOwnedChannels();
      return;
    }

    if (this.ambientEmotionApplied && this.expression) {
      const exprSnap = this.expression.getSnapshot();
      if (exprSnap.priority <= EMOTION_PRIORITY_VALUES.ambient) {
        this.expression.clearEmotion({ transitionSeconds: 0.45 });
      }
      this.ambientEmotionApplied = false;
    }

    // Snapshot the exact live published pose so recovery starts with zero C0 discontinuity
    this.capturedHasLimb = this.lastLiveHasLimb;
    this.capturedLimbWeight = this.lastLiveLimbWeight;
    if (this.lastLiveHasLimb) {
      for (const boneName of UPPER_LIMB_BONE_NAMES) {
        this.capturedLimbMap.get(boneName)!.copy(this.lastLiveLimbMap.get(boneName)!);
      }
    }

    Object.assign(this.capturedTorso, this.lastLiveTorso);
    this.capturedPelvisPos[0] = this.lastLivePelvisPos[0];
    this.capturedPelvisPos[1] = this.lastLivePelvisPos[1];
    this.capturedPelvisPos[2] = this.lastLivePelvisPos[2];
    this.capturedPelvisRot[0] = this.lastLivePelvisRot[0];
    this.capturedPelvisRot[1] = this.lastLivePelvisRot[1];
    this.capturedPelvisRot[2] = this.lastLivePelvisRot[2];
    this.capturedLower.leftHeelLiftRad = this.lastLiveLeftHeel;
    this.capturedLower.rightHeelLiftRad = this.lastLiveRightHeel;
    this.capturedLower.leftKneeSwivelRad = this.lastLiveLeftSwivel;
    this.capturedLower.rightKneeSwivelRad = this.lastLiveRightSwivel;
    this.capturedHead.rollRad = this.lastLiveHeadRoll;
    this.capturedHead.pitchRad = this.lastLiveHeadPitch;

    this.isInterruptedRecovery = true;
    this.phase = 'recovery';
    this.phaseElapsedSeconds = 0;
    this.recoveryDurationSeconds = Math.max(0.18, releaseSeconds);
    this.decisionCountdownSeconds = this.sampleDecisionIntervalSeconds();
    this.emitSnapshotIfChanged();
  }

  /**
   * Notifies the scheduler of direct user interaction (pointer, UI action, or chat message).
   * Resets inactivity, reschedules future autonomous decisions, and gracefully releases
   * any active autonomous activity while preserving breathing, blinking, and gaze.
   */
  public notifyUserInteraction(): void {
    this.idleSeconds = 0;
    this.decisionCountdownSeconds = this.sampleDecisionIntervalSeconds();
    if (this.phase !== 'idle' && !this.isInterruptedRecovery) {
      this.interruptActivity(this.config.interruptionRecoverySeconds);
    } else {
      this.emitSnapshotIfChanged();
    }
  }

  /**
   * Resets both autonomous activities and lower-body standing posture smoothly to neutral.
   */
  public resetToNeutral(): void {
    this.idleSeconds = 0;
    this.decisionCountdownSeconds = this.sampleDecisionIntervalSeconds();
    if (this.phase !== 'idle') {
      this.interruptActivity(0.5);
    } else {
      this.clearAllOwnedChannels();
    }
    this.naturalIdle.returnToNeutral(1.0);
    this.emitSnapshotIfChanged();
  }

  public attach(_vrm: VRM): void {
    // Orchestrator intentionally writes zero VRM bones directly.
  }

  public update(_vrm: VRM, deltaTime: number): void {
    if (this.paused || this.tabHidden || !Number.isFinite(deltaTime) || deltaTime <= 0) {
      return;
    }

    // 1. Advance per-activity cooldowns
    for (const name of AUTONOMOUS_ACTIVITY_NAMES) {
      const rem = this.cooldowns.get(name) ?? 0;
      if (rem > 0) {
        this.cooldowns.set(name, Math.max(0, rem - deltaTime));
      }
    }

    // 2. Context-aware conversation & active-gesture suppression
    const contextSuppressed = this.isContextSuppressed();
    if (contextSuppressed) {
      if (this.attention.isConversationActive || this.speechMouth?.active) {
        this.idleSeconds = 0;
      }
      this.decisionCountdownSeconds = Math.max(
        this.decisionCountdownSeconds,
        this.sampleDecisionIntervalSeconds() * 0.65,
      );
      if (this.phase !== 'idle' && !this.isInterruptedRecovery) {
        this.interruptActivity(0.5);
      }
    } else {
      this.idleSeconds += deltaTime;
    }

    // 3. Autonomous scheduling when idle and permitted
    if (this.phase === 'idle') {
      if (this.enabled && !contextSuppressed) {
        this.decisionCountdownSeconds -= deltaTime;
        if (this.decisionCountdownSeconds <= 0) {
          this.evaluateAutonomousDecision();
        }
      }
      this.emitSnapshotIfChanged();
      return;
    }

    // 4. Advance active autonomous activity envelope (anticipation -> execution -> recovery -> idle)
    this.advanceActivePhase(deltaTime);
    this.emitSnapshotIfChanged();
  }

  public getSnapshot = (): AutonomousActivityStatusSnapshot => {
    return this.cachedSnapshot;
  };

  public subscribe = (listener: AutonomousActivityListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public dispose(): void {
    this.clearAllOwnedChannels();
    this.activeActivity = null;
    this.phase = 'idle';
    this.phaseElapsedSeconds = 0;
    this.isInterruptedRecovery = false;
    this.idleSeconds = 0;
    this.cooldowns.clear();
    this.listeners.clear();
  }

  private isContextSuppressed(): boolean {
    const attentionState = this.attention.getState();
    if (
      this.attention.isConversationActive ||
      attentionState === 'LISTENING' ||
      attentionState === 'SPEAKING'
    ) {
      return true;
    }
    if (this.speechMouth?.active) {
      return true;
    }
    if (this.gesture.getPhase() !== 'idle') {
      return true;
    }
    return false;
  }

  private evaluateAutonomousDecision(): void {
    const effectiveIdle = Math.max(this.idleSeconds, this.attention.getSnapshot().inactivitySeconds);

    // Collect eligible activities for current inactivity duration & off-cooldown status
    const eligible: AutonomousActivityDefinition[] = [];
    for (const name of AUTONOMOUS_ACTIVITY_NAMES) {
      const def = AUTONOMOUS_ACTIVITY_DEFINITIONS[name];
      const remCooldown = this.cooldowns.get(name) ?? 0;
      if (effectiveIdle >= def.minInactivitySeconds && remCooldown <= 0) {
        eligible.push(def);
      }
    }

    if (eligible.length === 0) {
      this.decisionCountdownSeconds = Math.max(1.5, 3.0 / this.frequencyMultiplier);
      return;
    }

    // Intentional stillness window so the character remains naturally calm & unhurried
    if (this.rng() < this.config.stillnessProbability) {
      this.decisionCountdownSeconds = this.sampleStillnessIntervalSeconds();
      return;
    }

    // Anti-repetition filtering: never pick the exact same activity twice in a row when alternatives exist
    const nonRepeating =
      eligible.length > 1
        ? eligible.filter((def) => def.name !== this.lastSelectedActivity)
        : eligible;

    // Context-weighted random pick (gently favors longer-idle stretches once unlocked without starving subtle shifts)
    let totalWeight = 0;
    const weights: number[] = [];
    for (let i = 0; i < nonRepeating.length; i++) {
      const def = nonRepeating[i];
      let w = def.selectionWeight;
      if (effectiveIdle >= INACTIVITY_TIER_THRESHOLDS.longer && def.tier === 'longer') {
        w *= 1.45;
      } else if (effectiveIdle >= INACTIVITY_TIER_THRESHOLDS.moderate && def.tier === 'moderate') {
        w *= 1.2;
      }
      if (def.name === this.secondLastSelectedActivity) {
        w *= 0.35;
      }
      weights.push(w);
      totalWeight += w;
    }

    let pick = this.rng() * totalWeight;
    let chosen = nonRepeating[nonRepeating.length - 1];
    for (let i = 0; i < nonRepeating.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        chosen = nonRepeating[i];
        break;
      }
    }

    this.startActivityInternal(chosen);
  }

  private startActivityInternal(def: AutonomousActivityDefinition): void {
    this.secondLastSelectedActivity = this.lastSelectedActivity;
    this.lastSelectedActivity = def.name;

    this.activeActivity = def.name;
    this.phase = 'anticipation';
    this.phaseElapsedSeconds = 0;
    this.anticipationDurationSeconds = def.anticipationSeconds;
    this.executionDurationSeconds = def.executionSeconds;
    this.recoveryDurationSeconds = def.recoverySeconds;
    this.isInterruptedRecovery = false;
    this.postureAppliedInExecution = false;
    this.ambientEmotionApplied = false;

    this.activeSideSign = this.nextSideSign;
    this.nextSideSign = this.nextSideSign === 1 ? -1 : 1;

    this.cooldowns.set(def.name, def.cooldownSeconds);
    this.evaluateAndPublishCurrentFrame();
    this.emitSnapshotIfChanged();
  }

  private advanceActivePhase(deltaTime: number): void {
    let remainingDt = deltaTime;

    while (remainingDt > 0 && this.phase !== 'idle') {
      if (this.phase === 'anticipation') {
        const needed = this.anticipationDurationSeconds - this.phaseElapsedSeconds;
        if (remainingDt >= needed) {
          remainingDt -= Math.max(0, needed);
          this.phase = 'execution';
          this.phaseElapsedSeconds = 0;
          this.onEnterExecution();
        } else {
          this.phaseElapsedSeconds += remainingDt;
          remainingDt = 0;
        }
        continue;
      }

      if (this.phase === 'execution') {
        const needed = this.executionDurationSeconds - this.phaseElapsedSeconds;
        if (remainingDt >= needed) {
          remainingDt -= Math.max(0, needed);
          this.phase = 'recovery';
          this.phaseElapsedSeconds = 0;
        } else {
          this.phaseElapsedSeconds += remainingDt;
          remainingDt = 0;
        }
        continue;
      }

      if (this.phase === 'recovery') {
        const needed = this.recoveryDurationSeconds - this.phaseElapsedSeconds;
        if (remainingDt >= needed) {
          remainingDt = 0;
          this.completeActivityToIdle();
          return;
        }
        this.phaseElapsedSeconds += remainingDt;
        remainingDt = 0;
      }
    }

    if (this.phase !== 'idle') {
      this.evaluateAndPublishCurrentFrame();
    }
  }

  private onEnterExecution(): void {
    if (!this.activeActivity || !this.expression) {
      return;
    }
    const def = AUTONOMOUS_ACTIVITY_DEFINITIONS[this.activeActivity];
    if (def.ambientEmotion) {
      const accepted = this.expression.setEmotion(
        def.ambientEmotion.emotion,
        def.ambientEmotion.intensity,
        {
          priority: 'ambient',
          transitionSeconds: 0.55,
          holdSeconds: Math.max(0.6, def.executionSeconds * 0.8),
        },
      );
      this.ambientEmotionApplied = accepted;
    }
  }

  private evaluateAndPublishCurrentFrame(): void {
    if (this.phase === 'idle' || !this.activeActivity) {
      this.clearAllOwnedChannels();
      return;
    }

    if (this.isInterruptedRecovery) {
      const u = clamp(this.phaseElapsedSeconds / this.recoveryDurationSeconds, 0, 1);
      const r = 1 - smootherstep01(u);

      if (this.capturedHasLimb && this.capturedLimbWeight * r > 1e-4) {
        this.publishLimbChannel(this.capturedLimbMap, this.capturedLimbWeight * r);
      } else {
        this.publishLimbChannel(null, 0);
      }

      this.scaledTorsoOut.spinePitchRad = this.capturedTorso.spinePitchRad * r;
      this.scaledTorsoOut.spineYawRad = this.capturedTorso.spineYawRad * r;
      this.scaledTorsoOut.spineRollRad = this.capturedTorso.spineRollRad * r;
      this.scaledTorsoOut.chestPitchRad = this.capturedTorso.chestPitchRad * r;
      this.scaledTorsoOut.chestYawRad = this.capturedTorso.chestYawRad * r;
      this.scaledTorsoOut.chestRollRad = this.capturedTorso.chestRollRad * r;
      this.scaledTorsoOut.upperChestPitchRad = this.capturedTorso.upperChestPitchRad * r;
      this.scaledTorsoOut.leftShoulderLiftRad = this.capturedTorso.leftShoulderLiftRad * r;
      this.scaledTorsoOut.rightShoulderLiftRad = this.capturedTorso.rightShoulderLiftRad * r;
      this.scaledTorsoOut.leftShoulderProtractRad = this.capturedTorso.leftShoulderProtractRad * r;
      this.scaledTorsoOut.rightShoulderProtractRad = this.capturedTorso.rightShoulderProtractRad * r;
      this.scaledTorsoOut.breathDepthBoost = this.capturedTorso.breathDepthBoost * r;
      this.publishTorsoChannel(this.scaledTorsoOut);

      this.scaledPelvisPos[0] = this.capturedPelvisPos[0] * r;
      this.scaledPelvisPos[1] = this.capturedPelvisPos[1] * r;
      this.scaledPelvisPos[2] = this.capturedPelvisPos[2] * r;
      this.scaledPelvisRot[0] = this.capturedPelvisRot[0] * r;
      this.scaledPelvisRot[1] = this.capturedPelvisRot[1] * r;
      this.scaledPelvisRot[2] = this.capturedPelvisRot[2] * r;
      this.scaledLowerOut.leftHeelLiftRad = this.capturedLower.leftHeelLiftRad * r;
      this.scaledLowerOut.rightHeelLiftRad = this.capturedLower.rightHeelLiftRad * r;
      this.scaledLowerOut.leftKneeSwivelRad = this.capturedLower.leftKneeSwivelRad * r;
      this.scaledLowerOut.rightKneeSwivelRad = this.capturedLower.rightKneeSwivelRad * r;
      this.scaledLowerOut.suppressPostureTimer = false;
      this.publishLowerChannel(this.scaledLowerOut);

      this.scaledHeadOut.rollRad = this.capturedHead.rollRad * r;
      this.scaledHeadOut.pitchRad = this.capturedHead.pitchRad * r;
      this.publishHeadChannel(this.scaledHeadOut);
      return;
    }

    const duration = this.getCurrentPhaseDuration();
    const u = duration > 0 ? clamp(this.phaseElapsedSeconds / duration, 0, 1) : 1;

    const evaluated = this.evaluator.evaluate(
      this.activeActivity,
      this.phase,
      u,
      this.activeSideSign,
      1.0,
    );

    if (
      evaluated.requestedPosture &&
      this.phase === 'execution' &&
      !this.postureAppliedInExecution
    ) {
      this.postureAppliedInExecution = true;
      this.naturalIdle.setPosture(evaluated.requestedPosture, 2.0);
    }

    this.publishLimbChannel(evaluated.limbPose, evaluated.limbWeight);
    this.publishTorsoChannel(evaluated.torsoOffset);
    this.publishLowerChannel(evaluated.lowerBodyOffset);
    this.publishHeadChannel(evaluated.headOffset);
  }

  private completeActivityToIdle(): void {
    const completed = this.activeActivity;
    if (completed) {
      this.lastCompletedActivity = completed;
    }

    this.activeActivity = null;
    this.phase = 'idle';
    this.phaseElapsedSeconds = 0;
    this.isInterruptedRecovery = false;
    this.postureAppliedInExecution = false;
    this.ambientEmotionApplied = false;

    this.clearAllOwnedChannels();
    this.decisionCountdownSeconds = this.sampleDecisionIntervalSeconds();
  }

  private clearAllOwnedChannels(): void {
    this.publishLimbChannel(null, 0);
    this.breathing.setActivityOffset(null);
    this.naturalIdle.setAutonomousLowerBodyOffset(null);
    this.attention.setActivityHeadOffset(null);

    this.lastLiveTorso.spinePitchRad = 0;
    this.lastLiveTorso.spineYawRad = 0;
    this.lastLiveTorso.spineRollRad = 0;
    this.lastLiveTorso.chestPitchRad = 0;
    this.lastLiveTorso.chestYawRad = 0;
    this.lastLiveTorso.chestRollRad = 0;
    this.lastLiveTorso.upperChestPitchRad = 0;
    this.lastLiveTorso.leftShoulderLiftRad = 0;
    this.lastLiveTorso.rightShoulderLiftRad = 0;
    this.lastLiveTorso.leftShoulderProtractRad = 0;
    this.lastLiveTorso.rightShoulderProtractRad = 0;
    this.lastLiveTorso.breathDepthBoost = 0;

    this.lastLivePelvisPos[0] = 0;
    this.lastLivePelvisPos[1] = 0;
    this.lastLivePelvisPos[2] = 0;
    this.lastLivePelvisRot[0] = 0;
    this.lastLivePelvisRot[1] = 0;
    this.lastLivePelvisRot[2] = 0;
    this.lastLiveLeftHeel = 0;
    this.lastLiveRightHeel = 0;
    this.lastLiveLeftSwivel = 0;
    this.lastLiveRightSwivel = 0;
    this.lastLiveHeadRoll = 0;
    this.lastLiveHeadPitch = 0;
  }

  private publishLimbChannel(
    pose: ReadonlyMap<UpperLimbBoneName, THREE.Quaternion> | null,
    weight: number,
  ): void {
    if (!pose || weight <= 1e-4) {
      this.lastLiveHasLimb = false;
      this.lastLiveLimbWeight = 0;
      this.gesture.setAutonomousLimbPose(null, 0);
      return;
    }

    this.lastLiveHasLimb = true;
    this.lastLiveLimbWeight = weight;
    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const q = pose.get(boneName);
      if (q) {
        this.lastLiveLimbMap.get(boneName)!.copy(q);
      }
    }
    this.gesture.setAutonomousLimbPose(pose, weight);
  }

  private publishTorsoChannel(offset: AutonomousTorsoOffset): void {
    this.lastLiveTorso.spinePitchRad = offset.spinePitchRad ?? 0;
    this.lastLiveTorso.spineYawRad = offset.spineYawRad ?? 0;
    this.lastLiveTorso.spineRollRad = offset.spineRollRad ?? 0;
    this.lastLiveTorso.chestPitchRad = offset.chestPitchRad ?? 0;
    this.lastLiveTorso.chestYawRad = offset.chestYawRad ?? 0;
    this.lastLiveTorso.chestRollRad = offset.chestRollRad ?? 0;
    this.lastLiveTorso.upperChestPitchRad = offset.upperChestPitchRad ?? 0;
    this.lastLiveTorso.leftShoulderLiftRad = offset.leftShoulderLiftRad ?? 0;
    this.lastLiveTorso.rightShoulderLiftRad = offset.rightShoulderLiftRad ?? 0;
    this.lastLiveTorso.leftShoulderProtractRad = offset.leftShoulderProtractRad ?? 0;
    this.lastLiveTorso.rightShoulderProtractRad = offset.rightShoulderProtractRad ?? 0;
    this.lastLiveTorso.breathDepthBoost = offset.breathDepthBoost ?? 0;
    this.breathing.setActivityOffset(offset);
  }

  private publishLowerChannel(offset: AutonomousLowerBodyOffset): void {
    this.lastLivePelvisPos[0] = offset.pelvisTranslation?.[0] ?? 0;
    this.lastLivePelvisPos[1] = offset.pelvisTranslation?.[1] ?? 0;
    this.lastLivePelvisPos[2] = offset.pelvisTranslation?.[2] ?? 0;
    this.lastLivePelvisRot[0] = offset.pelvisRotationEuler?.[0] ?? 0;
    this.lastLivePelvisRot[1] = offset.pelvisRotationEuler?.[1] ?? 0;
    this.lastLivePelvisRot[2] = offset.pelvisRotationEuler?.[2] ?? 0;
    this.lastLiveLeftHeel = offset.leftHeelLiftRad ?? 0;
    this.lastLiveRightHeel = offset.rightHeelLiftRad ?? 0;
    this.lastLiveLeftSwivel = offset.leftKneeSwivelRad ?? 0;
    this.lastLiveRightSwivel = offset.rightKneeSwivelRad ?? 0;
    this.naturalIdle.setAutonomousLowerBodyOffset(offset);
  }

  private publishHeadChannel(accent: GestureHeadAccent): void {
    this.lastLiveHeadRoll = accent.rollRad ?? 0;
    this.lastLiveHeadPitch = accent.pitchRad ?? 0;
    this.attention.setActivityHeadOffset(accent);
  }

  private getCurrentPhaseDuration(): number {
    if (this.phase === 'anticipation') return this.anticipationDurationSeconds;
    if (this.phase === 'execution') return this.executionDurationSeconds;
    if (this.phase === 'recovery') return this.recoveryDurationSeconds;
    return 0;
  }

  private sampleDecisionIntervalSeconds(): number {
    const [lo, hi] = this.config.decisionIntervalRangeSeconds;
    const minVal = Math.min(lo, hi);
    const maxVal = Math.max(lo, hi);
    const raw = minVal + this.rng() * (maxVal - minVal);
    return Math.max(0.5, raw / this.frequencyMultiplier);
  }

  private sampleStillnessIntervalSeconds(): number {
    const [lo, hi] = this.config.stillnessIntervalRangeSeconds;
    const minVal = Math.min(lo, hi);
    const maxVal = Math.max(lo, hi);
    const raw = minVal + this.rng() * (maxVal - minVal);
    return Math.max(0.5, raw / this.frequencyMultiplier);
  }

  private createSnapshot(): AutonomousActivityStatusSnapshot {
    const duration = this.getCurrentPhaseDuration();
    const rawProgress = duration > 0 ? clamp(this.phaseElapsedSeconds / duration, 0, 1) : 0;
    const quantizedProgress = Math.round(rawProgress * 20) / 20;
    const label = this.activeActivity
      ? AUTONOMOUS_ACTIVITY_DEFINITIONS[this.activeActivity].label
      : 'None';

    return {
      enabled: this.enabled,
      paused: this.paused,
      tabHidden: this.tabHidden,
      activeActivity: this.activeActivity,
      activeActivityLabel: label,
      phase: this.phase,
      phaseProgress: this.phase === 'idle' ? 0 : quantizedProgress,
      frequencyMultiplier: Number(this.frequencyMultiplier.toFixed(2)),
      idleSeconds: Math.floor(this.idleSeconds),
      nextDecisionInSeconds: Math.max(0, Math.ceil(this.decisionCountdownSeconds)),
      lastCompletedActivity: this.lastCompletedActivity,
    };
  }

  private emitSnapshotIfChanged(): void {
    const next = this.createSnapshot();
    const prev = this.cachedSnapshot;
    if (
      prev.enabled === next.enabled &&
      prev.paused === next.paused &&
      prev.tabHidden === next.tabHidden &&
      prev.activeActivity === next.activeActivity &&
      prev.phase === next.phase &&
      prev.phaseProgress === next.phaseProgress &&
      prev.frequencyMultiplier === next.frequencyMultiplier &&
      prev.idleSeconds === next.idleSeconds &&
      prev.nextDecisionInSeconds === next.nextDecisionInSeconds &&
      prev.lastCompletedActivity === next.lastCompletedActivity
    ) {
      return;
    }

    this.cachedSnapshot = next;
    for (const listener of this.listeners) {
      listener(this.cachedSnapshot);
    }
  }
}

