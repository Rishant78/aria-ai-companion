import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { GestureHeadAccent } from './AttentionController';
import type { UpperBodyGestureOffset } from './BreathingController';
import {
  CALIBRATED_LIMB_POSES,
  UPPER_LIMB_BONE_NAMES,
  buildLimbPoseQuaternionMap,
} from './HandPoseLibrary';
import type { UpperLimbBoneName } from './HandPoseLibrary';
import type { AvatarController } from './types';

export const GESTURE_NAMES = [
  'none',
  'wave',
  'open_hand_greeting',
  'explaining',
  'thinking',
  'shrug',
  'laughing',
  'shy_hands_together',
  'reassuring',
] as const;

export type GestureName = (typeof GESTURE_NAMES)[number];
export type ActiveGestureName = Exclude<GestureName, 'none'>;

export const ACTIVE_GESTURE_NAMES: readonly ActiveGestureName[] = [
  'wave',
  'open_hand_greeting',
  'explaining',
  'thinking',
  'shrug',
  'laughing',
  'shy_hands_together',
  'reassuring',
];

export type GesturePriorityTier =
  | 'autonomous'
  | 'conversational'
  | 'emotional'
  | 'explicit';

export const GESTURE_PRIORITY_VALUES: Readonly<Record<GesturePriorityTier, number>> = {
  autonomous: 10,
  conversational: 40,
  emotional: 60,
  explicit: 80,
};

export type GesturePriorityInput = GesturePriorityTier | number;

export type GesturePhase = 'idle' | 'attack' | 'sustain' | 'release';

export interface PlayGestureOptions {
  /** Priority tier or numeric priority (default: 'emotional' = 60). */
  priority?: GesturePriorityInput;
  /** Gesture amplitude in `[0.0, 1.0]` (default: 1.0). Clamped safely. */
  intensity?: number;
  /** Optional total gesture duration override in seconds (> 0). */
  durationSeconds?: number;
  /** Optional sustain phase duration override in seconds (>= 0). */
  sustainSeconds?: number;
  /** Optional attack/release blend duration override in seconds (> 0). */
  transitionSeconds?: number;
  /** When true, ignores active per-gesture cooldown (default: false). */
  bypassCooldown?: boolean;
}

export interface StopGestureOptions {
  /** Optional smooth release duration in seconds (defaults to active gesture release time). */
  transitionSeconds?: number;
  /** When true, resets immediately to the natural resting pose without release blending. */
  immediate?: boolean;
}

export interface GestureDefinition {
  readonly name: ActiveGestureName;
  readonly label: string;
  readonly attackSeconds: number;
  readonly sustainSeconds: number;
  readonly releaseSeconds: number;
  readonly cooldownSeconds: number;
  readonly upperBodyOffset: UpperBodyGestureOffset;
  readonly headAccent: GestureHeadAccent;
}

export const GESTURE_DEFINITIONS: Readonly<Record<ActiveGestureName, GestureDefinition>> = {
  wave: {
    name: 'wave',
    label: 'Wave',
    attackSeconds: 0.38,
    sustainSeconds: 1.55,
    releaseSeconds: 0.44,
    cooldownSeconds: 4.0,
    upperBodyOffset: {
      spinePitchRad: -0.012,
      spineRollRad: 0.018,
      rightShoulderLiftRad: 0.038,
    },
    headAccent: {
      rollRad: -0.068,
      pitchRad: -0.012,
    },
  },
  open_hand_greeting: {
    name: 'open_hand_greeting',
    label: 'Greeting',
    attackSeconds: 0.38,
    sustainSeconds: 1.25,
    releaseSeconds: 0.44,
    cooldownSeconds: 3.5,
    upperBodyOffset: {
      spinePitchRad: 0.016,
      spineYawRad: 0.024,
      rightShoulderLiftRad: 0.022,
    },
    headAccent: {
      rollRad: -0.058,
      pitchRad: 0.018,
    },
  },
  explaining: {
    name: 'explaining',
    label: 'Explain',
    attackSeconds: 0.36,
    sustainSeconds: 1.85,
    releaseSeconds: 0.44,
    cooldownSeconds: 3.0,
    upperBodyOffset: {
      spinePitchRad: 0.018,
      chestPitchRad: 0.012,
      leftShoulderLiftRad: 0.016,
      rightShoulderLiftRad: 0.020,
    },
    headAccent: {
      rollRad: 0.046,
      pitchRad: 0.014,
    },
  },
  thinking: {
    name: 'thinking',
    label: 'Think',
    attackSeconds: 0.42,
    sustainSeconds: 1.9,
    releaseSeconds: 0.46,
    cooldownSeconds: 4.5,
    upperBodyOffset: {
      spinePitchRad: 0.014,
      spineYawRad: -0.022,
      rightShoulderLiftRad: 0.026,
    },
    headAccent: {
      rollRad: 0.118,
      pitchRad: 0.022,
    },
  },
  shrug: {
    name: 'shrug',
    label: 'Shrug',
    attackSeconds: 0.34,
    sustainSeconds: 0.95,
    releaseSeconds: 0.44,
    cooldownSeconds: 4.0,
    upperBodyOffset: {
      spinePitchRad: -0.018,
      chestPitchRad: -0.016,
      leftShoulderLiftRad: 0.105,
      rightShoulderLiftRad: 0.118,
    },
    headAccent: {
      rollRad: -0.096,
      pitchRad: -0.014,
    },
  },
  laughing: {
    name: 'laughing',
    label: 'Laugh',
    attackSeconds: 0.34,
    sustainSeconds: 1.45,
    releaseSeconds: 0.44,
    cooldownSeconds: 4.0,
    upperBodyOffset: {
      spinePitchRad: 0.020,
      chestPitchRad: 0.018,
      leftShoulderLiftRad: 0.024,
      rightShoulderLiftRad: 0.032,
    },
    headAccent: {
      rollRad: -0.056,
      pitchRad: 0.026,
    },
  },
  shy_hands_together: {
    name: 'shy_hands_together',
    label: 'Shy',
    attackSeconds: 0.44,
    sustainSeconds: 1.85,
    releaseSeconds: 0.48,
    cooldownSeconds: 4.5,
    upperBodyOffset: {
      spinePitchRad: 0.026,
      spineRollRad: -0.016,
      leftShoulderLiftRad: 0.032,
      rightShoulderLiftRad: 0.036,
    },
    headAccent: {
      rollRad: 0.105,
      pitchRad: 0.046,
    },
  },
  reassuring: {
    name: 'reassuring',
    label: 'Reassure',
    attackSeconds: 0.42,
    sustainSeconds: 1.65,
    releaseSeconds: 0.48,
    cooldownSeconds: 3.8,
    upperBodyOffset: {
      spinePitchRad: 0.022,
      chestPitchRad: 0.014,
      rightShoulderLiftRad: 0.020,
    },
    headAccent: {
      rollRad: -0.078,
      pitchRad: 0.022,
    },
  },
};

export interface GestureStatusSnapshot {
  readonly activeGesture: GestureName;
  readonly phase: GesturePhase;
  readonly intensity: number;
  readonly priority: number;
  readonly isPaused: boolean;
}

export type GestureListener = (snapshot: GestureStatusSnapshot) => void;

export interface GestureControllerOptions {
  /**
   * Optional callback forwarding additive torso & clavicle shrug offsets to
   * `BreathingController` (the sole writer of spine/chest/shoulder bones).
   */
  onUpperBodyOffset?: (offset: UpperBodyGestureOffset | null) => void;
  /**
   * Optional callback forwarding subtle head tilts/dips to `AttentionController`
   * (so `GazeController` remains the sole writer of neck/head bones).
   */
  onHeadAccent?: (accent: GestureHeadAccent | null) => void;
  /**
   * Maximum angular speed (rad/s) allowed on `leftUpperArm` / `rightUpperArm`
   * to protect underdamped overshirt sleeve SpringBones (`dragForce: 0.05`). Default: 5.6.
   */
  maxUpperArmSpeedRadPerSec?: number;
  /**
   * Maximum angular speed (rad/s) allowed on distal forearm, wrist, and finger joints. Default: 9.6.
   */
  maxDistalSpeedRadPerSec?: number;
}

const TAU = Math.PI * 2;
const IDENTITY_QUAT = new THREE.Quaternion(0, 0, 0, 1);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

function resolvePriority(priority: GesturePriorityInput | undefined): number {
  if (priority === undefined) {
    return GESTURE_PRIORITY_VALUES.emotional;
  }
  if (typeof priority === 'number') {
    return Number.isFinite(priority) ? priority : GESTURE_PRIORITY_VALUES.emotional;
  }
  return GESTURE_PRIORITY_VALUES[priority] ?? GESTURE_PRIORITY_VALUES.emotional;
}

function isKnownActiveGesture(name: string): name is ActiveGestureName {
  return (ACTIVE_GESTURE_NAMES as readonly string[]).includes(name);
}

/**
 * Procedural upper-body `GestureController` owning all 36 appendicular upper-limb
 * VRM 1.0 humanoid bones (`6` arm/forearm/wrist + `30` individual finger bones).
 *
 * Architectural guarantees:
 * - Zero bone overlap with `BreathingController` (torso/clavicles) or `GazeController` (neck/head).
 * - Replaces static `applyNaturalRestArms` when attached with a continuous relaxed pose + individual finger curls.
 * - Purely `deltaTime`-driven (`attack` -> `sustain` -> `release` -> `idle`) with seamless live-quaternion
 *   mid-gesture interruption, priorities, per-gesture cooldowns, velocity bounding, and zero drift.
 */
export class GestureController implements AvatarController {
  public readonly id = 'gesture';

  private onUpperBodyOffset?: (offset: UpperBodyGestureOffset | null) => void;
  private onHeadAccent?: (accent: GestureHeadAccent | null) => void;
  private readonly maxUpperArmSpeedRadPerSec: number;
  private readonly maxDistalSpeedRadPerSec: number;

  private vrm: VRM | null = null;
  private paused = false;
  private attachedBoneCount = 0;

  // Precomputed immutable unit-quaternion pose tables (zero per-frame allocations)
  private readonly restPoseQuats: Map<UpperLimbBoneName, THREE.Quaternion>;
  private readonly gestureBaseQuats: Map<
    ActiveGestureName,
    Map<UpperLimbBoneName, THREE.Quaternion>
  >;

  // Live per-bone quaternion state for seamless interruption & velocity bounding
  private readonly currentQuats = new Map<UpperLimbBoneName, THREE.Quaternion>();
  private readonly startQuats = new Map<UpperLimbBoneName, THREE.Quaternion>();
  private readonly desiredQuats = new Map<UpperLimbBoneName, THREE.Quaternion>();

  // Autonomous activity upper-limb target channel (active only when phase === 'idle'; zero allocations)
  private readonly autonomousTargetQuats = new Map<UpperLimbBoneName, THREE.Quaternion>();
  private autonomousLimbWeight = 0;
  private hasAutonomousLimbPose = false;

  // Scratch math objects
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpQuatA = new THREE.Quaternion();
  private readonly tmpQuatB = new THREE.Quaternion();

  // Active gesture state machine
  private activeGesture: GestureName = 'none';
  private phase: GesturePhase = 'idle';
  private activeIntensity = 0;
  private activePriority = 0;

  private phaseElapsedSeconds = 0;
  private attackDurationSeconds = 0.38;
  private sustainDurationSeconds = 1.5;
  private releaseDurationSeconds = 0.44;
  private sustainModPhase = 0;

  // Per-gesture cooldown timers (seconds remaining)
  private readonly cooldowns = new Map<ActiveGestureName, number>();

  // Subscribers & referentially stable snapshot for React useSyncExternalStore
  private readonly listeners = new Set<GestureListener>();
  private cachedSnapshot: GestureStatusSnapshot;

  constructor(options: GestureControllerOptions = {}) {
    this.onUpperBodyOffset = options.onUpperBodyOffset;
    this.onHeadAccent = options.onHeadAccent;
    this.maxUpperArmSpeedRadPerSec = options.maxUpperArmSpeedRadPerSec ?? 5.6;
    this.maxDistalSpeedRadPerSec = options.maxDistalSpeedRadPerSec ?? 9.6;

    this.restPoseQuats = buildLimbPoseQuaternionMap(CALIBRATED_LIMB_POSES.rest);
    this.gestureBaseQuats = new Map();
    for (const gestureName of ACTIVE_GESTURE_NAMES) {
      this.gestureBaseQuats.set(
        gestureName,
        buildLimbPoseQuaternionMap(CALIBRATED_LIMB_POSES[gestureName]),
      );
      this.cooldowns.set(gestureName, 0);
    }

    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
      this.currentQuats.set(boneName, restQ.clone());
      this.startQuats.set(boneName, restQ.clone());
      this.desiredQuats.set(boneName, restQ.clone());
      this.autonomousTargetQuats.set(boneName, restQ.clone());
    }

    this.cachedSnapshot = this.createSnapshot();
  }

  public setUpperBodyOffsetHandler(
    handler: ((offset: UpperBodyGestureOffset | null) => void) | undefined,
  ): void {
    this.onUpperBodyOffset = handler;
  }

  public setHeadAccentHandler(
    handler: ((accent: GestureHeadAccent | null) => void) | undefined,
  ): void {
    this.onHeadAccent = handler;
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

  public getActiveGesture(): GestureName {
    return this.activeGesture;
  }

  public getPhase(): GesturePhase {
    return this.phase;
  }

  public getIntensity(): number {
    return this.activeIntensity;
  }

  /**
   * Adjusts the intensity of an in-flight gesture smoothly in `[0.0, 1.0]`
   * without restarting its attack/sustain phase timer.
   */
  public setIntensity(intensity: number): void {
    const clamped = clamp01(intensity);
    if (this.phase !== 'attack' && this.phase !== 'sustain') {
      return;
    }
    if (clamped <= 0) {
      this.stopGesture();
      return;
    }
    if (this.activeIntensity === clamped) {
      return;
    }
    this.activeIntensity = clamped;
    if (isKnownActiveGesture(this.activeGesture)) {
      this.publishCoordinatedAccents(
        this.activeGesture,
        clamped,
        this.phase === 'sustain' ? this.phaseElapsedSeconds : 0,
      );
    }
    this.emitSnapshotIfChanged();
  }

  public getActivePriority(): number {
    return this.activePriority;
  }

  public getAttachedBoneCount(): number {
    return this.attachedBoneCount;
  }

  public getOwnedBoneNames(): readonly UpperLimbBoneName[] {
    return UPPER_LIMB_BONE_NAMES;
  }

  public getCooldownRemaining(gesture: ActiveGestureName): number {
    return this.cooldowns.get(gesture) ?? 0;
  }

  public clearCooldowns(): void {
    for (const gesture of ACTIVE_GESTURE_NAMES) {
      this.cooldowns.set(gesture, 0);
    }
  }

  /**
   * Returns a defensive copy of the current live normalized quaternion for an owned bone.
   */
  public getBoneQuaternion(
    boneName: UpperLimbBoneName,
    target = new THREE.Quaternion(),
  ): THREE.Quaternion {
    const q = this.currentQuats.get(boneName) ?? IDENTITY_QUAT;
    return target.copy(q);
  }

  /**
   * Returns a defensive copy of the canonical resting quaternion for an owned bone.
   */
  public getRestBoneQuaternion(
    boneName: UpperLimbBoneName,
    target = new THREE.Quaternion(),
  ): THREE.Quaternion {
    const q = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
    return target.copy(q);
  }

  /**
   * Sets or clears a background autonomous activity upper-limb target pose
   * (used by `AutonomousActivityScheduler` so `GestureController` remains the sole
   * writer of all 36 arm, wrist, and finger bones).
   *
   * Subordinate to conversational/emotional/explicit gestures: ignored whenever
   * `phase !== 'idle'`, and seamlessly blended from live `currentQuats` if a
   * conversational gesture starts mid-activity.
   */
  public setAutonomousLimbPose(
    pose: ReadonlyMap<UpperLimbBoneName, THREE.Quaternion> | null,
    weight = 1.0,
  ): void {
    const clampedWeight = clamp01(weight);
    if (!pose || clampedWeight <= 0) {
      this.hasAutonomousLimbPose = false;
      this.autonomousLimbWeight = 0;
      return;
    }

    this.hasAutonomousLimbPose = true;
    this.autonomousLimbWeight = clampedWeight;

    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
      const targetQ = pose.get(boneName) ?? restQ;
      this.autonomousTargetQuats.get(boneName)!.copy(targetQ).normalize();
    }
  }

  public getAutonomousLimbWeight(): number {
    return this.autonomousLimbWeight;
  }

  /**
   * Returns true when all 36 owned upper-limb bones have settled within `toleranceRad`
   * of their canonical resting quaternions.
   */
  public areLimbsAtRest(toleranceRad = 1e-3): boolean {
    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const currentQ = this.currentQuats.get(boneName)!;
      const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
      const dot = Math.min(1, Math.abs(currentQ.dot(restQ)));
      if (2 * Math.acos(dot) > toleranceRad) {
        return false;
      }
    }
    return true;
  }

  /**
   * Triggers an upper-body gesture with priority checking, per-gesture cooldowns,
   * clamped `[0, 1]` intensity, configurable duration, and seamless retargeting
   * from the live pose if interrupting an in-flight gesture.
   *
   * @returns `true` if accepted; `false` if unknown, on cooldown, or blocked by higher priority.
   */
  public playGesture(
    gesture: GestureName,
    options: PlayGestureOptions = {},
  ): boolean {
    if (gesture === 'none') {
      this.stopGesture({
        transitionSeconds: options.transitionSeconds,
      });
      return true;
    }

    if (typeof gesture !== 'string' || !isKnownActiveGesture(gesture)) {
      return false;
    }

    const incomingPriority = resolvePriority(options.priority);

    // Block lower-priority requests while an active gesture is in attack or sustain
    if (
      (this.phase === 'attack' || this.phase === 'sustain') &&
      incomingPriority < this.activePriority
    ) {
      return false;
    }

    // Enforce per-gesture cooldown unless explicitly bypassed
    const remainingCooldown = this.cooldowns.get(gesture) ?? 0;
    if (!options.bypassCooldown && remainingCooldown > 0) {
      return false;
    }

    const clampedIntensity =
      options.intensity === undefined ? 1.0 : clamp01(options.intensity);
    if (clampedIntensity <= 0) {
      this.stopGesture({ transitionSeconds: options.transitionSeconds });
      return true;
    }

    const def = GESTURE_DEFINITIONS[gesture];

    let attackSec =
      options.transitionSeconds !== undefined &&
      Number.isFinite(options.transitionSeconds)
        ? Math.max(0.04, options.transitionSeconds)
        : def.attackSeconds;
    let sustainSec =
      options.sustainSeconds !== undefined && Number.isFinite(options.sustainSeconds)
        ? Math.max(0, options.sustainSeconds)
        : def.sustainSeconds;
    let releaseSec =
      options.transitionSeconds !== undefined &&
      Number.isFinite(options.transitionSeconds)
        ? Math.max(0.04, options.transitionSeconds)
        : def.releaseSeconds;

    if (
      options.durationSeconds !== undefined &&
      Number.isFinite(options.durationSeconds) &&
      options.durationSeconds > 0
    ) {
      const total = options.durationSeconds;
      if (total >= attackSec + releaseSec) {
        sustainSec = total - attackSec - releaseSec;
      } else {
        attackSec = Math.max(0.02, total * 0.38);
        sustainSec = Math.max(0, total * 0.24);
        releaseSec = Math.max(0.02, total * 0.38);
      }
    }

    // Snapshot current live quaternions so mid-gesture interruption has zero snapping
    this.snapshotLivePoseAsStart();

    this.activeGesture = gesture;
    this.phase = 'attack';
    this.activeIntensity = clampedIntensity;
    this.activePriority = incomingPriority;
    this.phaseElapsedSeconds = 0;
    this.attackDurationSeconds = attackSec;
    this.sustainDurationSeconds = sustainSec;
    this.releaseDurationSeconds = releaseSec;
    this.sustainModPhase = 0;

    this.cooldowns.set(gesture, def.cooldownSeconds);

    this.publishCoordinatedAccents(gesture, clampedIntensity, 0);
    this.emitSnapshotIfChanged();
    return true;
  }

  /**
   * Smoothly stops any active gesture (regardless of priority) and transitions
   * from the current live pose back to the natural relaxed resting pose.
   */
  public stopGesture(options: StopGestureOptions = {}): void {
    if (options.immediate) {
      for (const boneName of UPPER_LIMB_BONE_NAMES) {
        const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
        this.currentQuats.get(boneName)!.copy(restQ);
        this.startQuats.get(boneName)!.copy(restQ);
        this.desiredQuats.get(boneName)!.copy(restQ);
      }
      this.activeGesture = 'none';
      this.phase = 'idle';
      this.activeIntensity = 0;
      this.activePriority = 0;
      this.phaseElapsedSeconds = 0;
      this.sustainModPhase = 0;
      this.hasAutonomousLimbPose = false;
      this.autonomousLimbWeight = 0;
      this.onUpperBodyOffset?.(null);
      this.onHeadAccent?.(null);
      if (this.vrm) {
        this.applyQuaternionsToVrm(this.vrm);
      }
      this.emitSnapshotIfChanged();
      return;
    }

    if (this.phase === 'idle') {
      this.onUpperBodyOffset?.(null);
      this.onHeadAccent?.(null);
      return;
    }

    this.snapshotLivePoseAsStart();
    const releaseSec =
      options.transitionSeconds !== undefined &&
      Number.isFinite(options.transitionSeconds)
        ? Math.max(0.04, options.transitionSeconds)
        : this.releaseDurationSeconds;

    this.activeGesture = 'none';
    this.phase = 'release';
    this.activeIntensity = 0;
    this.activePriority = 0;
    this.phaseElapsedSeconds = 0;
    this.releaseDurationSeconds = releaseSec;
    this.sustainModPhase = 0;

    this.onUpperBodyOffset?.(null);
    this.onHeadAccent?.(null);
    this.emitSnapshotIfChanged();
  }

  public attach(vrm: VRM): void {
    this.vrm = vrm;
    this.attachedBoneCount = this.countAvailableOwnedBones(vrm);
    this.applyQuaternionsToVrm(vrm);
  }

  public update(vrm: VRM, deltaTime: number, elapsedTime?: number): void;
  public update(deltaTime: number): void;
  public update(vrmOrDelta: VRM | number, maybeDeltaTime?: number): void {
    let targetVrm: VRM | null;
    let deltaTime: number;

    if (typeof vrmOrDelta === 'number') {
      targetVrm = this.vrm;
      deltaTime = vrmOrDelta;
    } else {
      targetVrm = vrmOrDelta;
      deltaTime = maybeDeltaTime ?? 0;
      if (this.vrm !== targetVrm) {
        this.attach(targetVrm);
      }
    }

    if (this.paused || !Number.isFinite(deltaTime) || deltaTime <= 0) {
      return;
    }

    // 1. Advance per-gesture cooldown timers
    for (const gesture of ACTIVE_GESTURE_NAMES) {
      const rem = this.cooldowns.get(gesture) ?? 0;
      if (rem > 0) {
        this.cooldowns.set(gesture, Math.max(0, rem - deltaTime));
      }
    }

    // 2. Advance envelope phases (attack -> sustain -> release -> idle)
    this.advanceEnvelope(deltaTime);

    // 3. Step current bone quaternions toward desired targets with strict velocity bounds
    //    and explicit unit renormalization (zero cumulative drift)
    this.stepVelocityBoundedQuaternions(deltaTime);

    // Complete release -> idle transition once both release duration and velocity-bounded settling finish
    if (
      this.phase === 'release' &&
      this.phaseElapsedSeconds >= this.releaseDurationSeconds &&
      this.areAllBonesAtRest()
    ) {
      this.phase = 'idle';
      this.phaseElapsedSeconds = 0;
      this.emitSnapshotIfChanged();
    }

    if (targetVrm) {
      this.applyQuaternionsToVrm(targetVrm);
    }
  }

  public getSnapshot = (): GestureStatusSnapshot => {
    return this.cachedSnapshot;
  };

  public subscribe = (listener: GestureListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public dispose(): void {
    this.onUpperBodyOffset?.(null);
    this.onHeadAccent?.(null);
    this.onUpperBodyOffset = undefined;
    this.onHeadAccent = undefined;

    if (this.vrm) {
      for (const boneName of UPPER_LIMB_BONE_NAMES) {
        const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
        this.currentQuats.get(boneName)!.copy(restQ);
      }
      this.applyQuaternionsToVrm(this.vrm);
      this.vrm = null;
    }

    this.attachedBoneCount = 0;
    this.activeGesture = 'none';
    this.phase = 'idle';
    this.activeIntensity = 0;
    this.activePriority = 0;
    this.phaseElapsedSeconds = 0;
    this.sustainModPhase = 0;
    this.hasAutonomousLimbPose = false;
    this.autonomousLimbWeight = 0;
    this.cooldowns.clear();
    this.listeners.clear();
  }

  private advanceEnvelope(deltaTime: number): void {
    let remainingDt = deltaTime;

    while (remainingDt > 0 && this.phase !== 'idle') {
      if (this.phase === 'attack') {
        const needed = this.attackDurationSeconds - this.phaseElapsedSeconds;
        if (remainingDt >= needed) {
          remainingDt -= Math.max(0, needed);
          this.phaseElapsedSeconds = 0;
          this.sustainModPhase = 0;
          this.phase = 'sustain';
          if (isKnownActiveGesture(this.activeGesture)) {
            this.computeSustainDesiredPose(this.activeGesture, this.activeIntensity, 0, 0);
            this.publishCoordinatedAccents(this.activeGesture, this.activeIntensity, 0);
          }
          this.emitSnapshotIfChanged();
        } else {
          this.phaseElapsedSeconds += remainingDt;
          remainingDt = 0;
          const u = smoothstep01(this.phaseElapsedSeconds / this.attackDurationSeconds);
          if (isKnownActiveGesture(this.activeGesture)) {
            this.computeAttackDesiredPose(this.activeGesture, this.activeIntensity, u);
            this.publishCoordinatedAccents(this.activeGesture, this.activeIntensity, 0);
          }
        }
        continue;
      }

      if (this.phase === 'sustain') {
        const needed = this.sustainDurationSeconds - this.phaseElapsedSeconds;
        if (remainingDt >= needed) {
          remainingDt -= Math.max(0, needed);
          // Refresh cooldown from completion of sustain so rapid post-gesture spam is gated
          if (isKnownActiveGesture(this.activeGesture)) {
            const def = GESTURE_DEFINITIONS[this.activeGesture];
            this.cooldowns.set(
              this.activeGesture,
              Math.max(this.cooldowns.get(this.activeGesture) ?? 0, def.cooldownSeconds),
            );
          }
          this.snapshotDesiredOrLiveForRelease();
          this.activeGesture = 'none';
          this.phase = 'release';
          this.activeIntensity = 0;
          this.activePriority = 0;
          this.phaseElapsedSeconds = 0;
          this.sustainModPhase = 0;
          this.onUpperBodyOffset?.(null);
          this.onHeadAccent?.(null);
          this.emitSnapshotIfChanged();
        } else {
          this.phaseElapsedSeconds += remainingDt;
          this.sustainModPhase = (this.sustainModPhase + TAU * remainingDt) % (TAU * 60);
          remainingDt = 0;
          if (isKnownActiveGesture(this.activeGesture)) {
            const sustainProgress =
              this.sustainDurationSeconds > 0
                ? clamp01(this.phaseElapsedSeconds / this.sustainDurationSeconds)
                : 1;
            this.computeSustainDesiredPose(
              this.activeGesture,
              this.activeIntensity,
              this.phaseElapsedSeconds,
              sustainProgress,
            );
            this.publishCoordinatedAccents(
              this.activeGesture,
              this.activeIntensity,
              this.phaseElapsedSeconds,
            );
          }
        }
        continue;
      }

      if (this.phase === 'release') {
        const needed = this.releaseDurationSeconds - this.phaseElapsedSeconds;
        if (remainingDt >= needed) {
          remainingDt = 0;
          this.phaseElapsedSeconds = this.releaseDurationSeconds;
          for (const boneName of UPPER_LIMB_BONE_NAMES) {
            const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
            this.desiredQuats.get(boneName)!.copy(restQ);
          }
        } else {
          this.phaseElapsedSeconds += remainingDt;
          remainingDt = 0;
          const u = smoothstep01(this.phaseElapsedSeconds / this.releaseDurationSeconds);
          for (const boneName of UPPER_LIMB_BONE_NAMES) {
            const startQ = this.startQuats.get(boneName) ?? IDENTITY_QUAT;
            const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
            this.desiredQuats.get(boneName)!.copy(startQ).slerp(restQ, u).normalize();
          }
        }
      }
    }

    if (this.phase === 'idle') {
      if (this.hasAutonomousLimbPose && this.autonomousLimbWeight > 1e-5) {
        for (const boneName of UPPER_LIMB_BONE_NAMES) {
          const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
          const autoQ = this.autonomousTargetQuats.get(boneName) ?? restQ;
          this.desiredQuats
            .get(boneName)!
            .copy(restQ)
            .slerp(autoQ, this.autonomousLimbWeight)
            .normalize();
        }
      } else {
        for (const boneName of UPPER_LIMB_BONE_NAMES) {
          const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
          this.desiredQuats.get(boneName)!.copy(restQ);
        }
      }
    }
  }

  private computeAttackDesiredPose(
    gesture: ActiveGestureName,
    intensity: number,
    easedProgress: number,
  ): void {
    const targetMap = this.gestureBaseQuats.get(gesture);
    if (!targetMap) {
      return;
    }

    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const startQ = this.startQuats.get(boneName) ?? IDENTITY_QUAT;
      const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
      const fullGestureQ = targetMap.get(boneName) ?? restQ;

      // Scale gesture pose relative to natural resting pose by clamped intensity
      this.tmpQuatA.copy(restQ).slerp(fullGestureQ, intensity);
      this.desiredQuats
        .get(boneName)!
        .copy(startQ)
        .slerp(this.tmpQuatA, easedProgress)
        .normalize();
    }
  }

  private computeSustainDesiredPose(
    gesture: ActiveGestureName,
    intensity: number,
    sustainElapsed: number,
    sustainProgress: number,
  ): void {
    const targetMap = this.gestureBaseQuats.get(gesture);
    if (!targetMap) {
      return;
    }

    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
      const fullGestureQ = targetMap.get(boneName) ?? restQ;
      this.desiredQuats.get(boneName)!.copy(restQ).slerp(fullGestureQ, intensity).normalize();
    }

    // Smooth bell window (0 at start & end of sustain) guarantees C1 continuity at boundaries
    const window = Math.sin(Math.PI * clamp01(sustainProgress));
    const amp = intensity * window;
    if (amp <= 1e-5) {
      return;
    }

    switch (gesture) {
      case 'wave': {
        // Overlapping forearm + wrist wave oscillation (~2.3 Hz) along local Y (lateral side-to-side)
        const waveA = Math.sin(TAU * 2.3 * sustainElapsed) * 0.13 * amp;
        const waveB = Math.sin(TAU * 2.3 * sustainElapsed - 0.35) * 0.17 * amp;
        this.applyLocalAddon('rightLowerArm', 0, waveA * 0.45, 0);
        this.applyLocalAddon('rightHand', 0, waveB, 0);
        break;
      }

      case 'open_hand_greeting': {
        const lift = 0.045 * amp;
        this.applyLocalAddon('rightLowerArm', 0, lift, 0);
        this.applyLocalAddon('rightHand', 0, 0, -lift * 0.6);
        break;
      }

      case 'explaining': {
        // Out-of-phase bilateral conversational hand cadence (~1.25 Hz)
        const leftWave = Math.sin(TAU * 1.25 * sustainElapsed) * 0.075 * amp;
        const rightWave = Math.sin(TAU * 1.25 * sustainElapsed + 1.15) * 0.088 * amp;
        this.applyLocalAddon('leftLowerArm', leftWave * 0.5, -leftWave * 0.6, 0);
        this.applyLocalAddon('leftHand', 0, 0, -leftWave * 0.8);
        this.applyLocalAddon('rightLowerArm', rightWave * 0.5, rightWave * 0.6, 0);
        this.applyLocalAddon('rightHand', 0, 0, rightWave * 0.8);
        break;
      }

      case 'thinking': {
        // Subtle contemplative index-finger / wrist micro-tap near chin
        const tap = Math.sin(TAU * 0.95 * sustainElapsed) * 0.032 * amp;
        this.applyLocalAddon('rightHand', tap * 0.5, 0, tap);
        this.applyLocalAddon('rightIndexProximal', 0, 0, tap * 1.2);
        break;
      }

      case 'shrug': {
        const crest = 0.04 * amp;
        this.applyLocalAddon('leftLowerArm', -crest, 0, 0);
        this.applyLocalAddon('rightLowerArm', -crest, 0, 0);
        break;
      }

      case 'laughing': {
        const decay = Math.exp(-0.85 * sustainElapsed);
        const chuckle = Math.sin(TAU * 3.3 * sustainElapsed) * 0.036 * amp * decay;
        this.applyLocalAddon('rightLowerArm', 0, chuckle, 0);
        this.applyLocalAddon('rightHand', chuckle * 0.6, 0, 0);
        break;
      }

      case 'shy_hands_together': {
        // Gentle bashful wrist/thumb micro-rock while keeping hands safely separated
        const rock = Math.sin(TAU * 0.85 * sustainElapsed) * 0.028 * amp;
        this.applyLocalAddon('leftHand', rock, 0, 0);
        this.applyLocalAddon('rightHand', -rock, 0, 0);
        break;
      }

      case 'reassuring': {
        // Soft calming downward settle on open left hand while right hand rests warmly near heart
        const calmPress = 0.065 * amp;
        this.applyLocalAddon('leftLowerArm', 0, calmPress * 0.6, 0);
        this.applyLocalAddon('leftHand', 0, 0, calmPress * 0.5);
        break;
      }
    }
  }

  private applyLocalAddon(
    boneName: UpperLimbBoneName,
    rx: number,
    ry: number,
    rz: number,
  ): void {
    const q = this.desiredQuats.get(boneName);
    if (!q) {
      return;
    }
    this.tmpEuler.set(rx, ry, rz, 'YXZ');
    this.tmpQuatB.setFromEuler(this.tmpEuler);
    q.multiply(this.tmpQuatB).normalize();
  }

  private publishCoordinatedAccents(
    gesture: ActiveGestureName,
    intensity: number,
    sustainElapsed: number,
  ): void {
    const def = GESTURE_DEFINITIONS[gesture];

    let extraChestBounce = 0;
    let extraShoulderBounce = 0;
    let extraHeadNod = 0;

    if (gesture === 'laughing' && sustainElapsed > 0) {
      const taper = Math.exp(-0.9 * sustainElapsed);
      const wave = Math.sin(TAU * 3.3 * sustainElapsed) * taper;
      extraChestBounce = 0.022 * wave;
      extraShoulderBounce = 0.024 * Math.max(0, wave);
      extraHeadNod = 0.020 * wave;
    }

    this.onUpperBodyOffset?.({
      spinePitchRad: (def.upperBodyOffset.spinePitchRad ?? 0) * intensity,
      spineYawRad: (def.upperBodyOffset.spineYawRad ?? 0) * intensity,
      spineRollRad: (def.upperBodyOffset.spineRollRad ?? 0) * intensity,
      chestPitchRad:
        ((def.upperBodyOffset.chestPitchRad ?? 0) + extraChestBounce) * intensity,
      leftShoulderLiftRad:
        ((def.upperBodyOffset.leftShoulderLiftRad ?? 0) + extraShoulderBounce) *
        intensity,
      rightShoulderLiftRad:
        ((def.upperBodyOffset.rightShoulderLiftRad ?? 0) + extraShoulderBounce) *
        intensity,
    });

    this.onHeadAccent?.({
      rollRad: (def.headAccent.rollRad ?? 0) * intensity,
      pitchRad: ((def.headAccent.pitchRad ?? 0) + extraHeadNod) * intensity,
    });
  }

  private stepVelocityBoundedQuaternions(deltaTime: number): void {
    const maxUpperStep = this.maxUpperArmSpeedRadPerSec * deltaTime;
    const maxDistalStep = this.maxDistalSpeedRadPerSec * deltaTime;

    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const currentQ = this.currentQuats.get(boneName)!;
      const desiredQ = this.desiredQuats.get(boneName)!;

      const isUpperArm =
        boneName === 'leftUpperArm' || boneName === 'rightUpperArm';
      const maxStepRad = isUpperArm ? maxUpperStep : maxDistalStep;

      const dot = Math.min(1, Math.abs(currentQ.dot(desiredQ)));
      const angleDiff = 2 * Math.acos(dot);

      if (angleDiff <= 1e-6) {
        currentQ.copy(desiredQ);
      } else if (angleDiff <= maxStepRad) {
        currentQ.copy(desiredQ).normalize();
      } else {
        currentQ.rotateTowards(desiredQ, maxStepRad).normalize();
      }
    }
  }

  private snapshotLivePoseAsStart(): void {
    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      this.startQuats.get(boneName)!.copy(this.currentQuats.get(boneName)!);
    }
  }

  private snapshotDesiredOrLiveForRelease(): void {
    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      this.startQuats.get(boneName)!.copy(this.currentQuats.get(boneName)!);
    }
  }

  private areAllBonesAtRest(): boolean {
    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const currentQ = this.currentQuats.get(boneName)!;
      const restQ = this.restPoseQuats.get(boneName) ?? IDENTITY_QUAT;
      const dot = Math.min(1, Math.abs(currentQ.dot(restQ)));
      if (2 * Math.acos(dot) > 1e-5) {
        return false;
      }
    }
    return true;
  }

  private countAvailableOwnedBones(vrm: VRM): number {
    const humanoid = vrm.humanoid;
    if (!humanoid) {
      return 0;
    }
    let count = 0;
    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      if (humanoid.getNormalizedBoneNode(boneName)) {
        count += 1;
      }
    }
    return count;
  }

  private applyQuaternionsToVrm(vrm: VRM): void {
    const humanoid = vrm.humanoid;
    if (!humanoid) {
      return;
    }

    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const node = humanoid.getNormalizedBoneNode(boneName);
      if (!node) {
        continue;
      }
      const q = this.currentQuats.get(boneName);
      if (q) {
        node.quaternion.copy(q);
      }
    }
  }

  private createSnapshot(): GestureStatusSnapshot {
    return {
      activeGesture: this.activeGesture,
      phase: this.phase,
      intensity: this.activeIntensity,
      priority: this.activePriority,
      isPaused: this.paused,
    };
  }

  private emitSnapshotIfChanged(): void {
    const prev = this.cachedSnapshot;
    if (
      prev.activeGesture === this.activeGesture &&
      prev.phase === this.phase &&
      prev.intensity === this.activeIntensity &&
      prev.priority === this.activePriority &&
      prev.isPaused === this.paused
    ) {
      return;
    }

    this.cachedSnapshot = this.createSnapshot();
    for (const listener of this.listeners) {
      listener(this.cachedSnapshot);
    }
  }
}
