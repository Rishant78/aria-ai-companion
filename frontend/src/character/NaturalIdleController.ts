import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { AvatarController } from './types';
import type { PelvicCounterOffset } from './BreathingController';
import {
  POSTURE_ARCHETYPES,
  type LegPoseTarget,
  type PelvicCounterTarget,
  type PostureName,
  getTransitionDurationSeconds,
  quinticEase,
} from './LowerBodyPoseLibrary';

export interface NaturalIdleConfig {
  /** Enables autonomous posture variations over time (default: true). */
  enabled: boolean;
  /** Initial hold range in seconds before the first autonomous shift (default: [8, 14]). */
  initialHoldRangeSeconds: readonly [number, number];
  /** Minimum knee flexion buffer in radians above rest to prevent singularity (default: 0.052 ~ 3.0 deg). */
  kneeSafetyBufferRad: number;
}

export const DEFAULT_NATURAL_IDLE_CONFIG: NaturalIdleConfig = {
  enabled: true,
  initialHoldRangeSeconds: [8.0, 14.0],
  kneeSafetyBufferRad: 0.052,
};

export interface NaturalIdleStatusSnapshot {
  currentPosture: PostureName;
  targetPosture: PostureName;
  isTransitioning: boolean;
  transitionProgress: number;
  enabled: boolean;
  paused: boolean;
}

/**
 * Additive lower-body offset published by `AutonomousActivityScheduler` so
 * `NaturalIdleController` remains the sole writer of `hips` and all 8 leg/foot/toe bones.
 */
export interface AutonomousLowerBodyOffset {
  readonly pelvisTranslation?: readonly [number, number, number];
  readonly pelvisRotationEuler?: readonly [number, number, number];
  readonly leftHeelLiftRad?: number;
  readonly rightHeelLiftRad?: number;
  readonly leftKneeSwivelRad?: number;
  readonly rightKneeSwivelRad?: number;
  /** Suppresses random posture timer progression while a full-body activity is active. */
  readonly suppressPostureTimer?: boolean;
}

function clampRange(value: number | undefined, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(min, Math.min(max, value));
}

function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  const alpha = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * alpha;
}

interface LegChainRestData {
  side: 'left' | 'right';
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  foot: THREE.Object3D;
  toes: THREE.Object3D;
  pHip0: THREE.Vector3;
  pKnee0: THREE.Vector3;
  pAnkle0: THREE.Vector3;
  pToes0: THREE.Vector3;
  L1: number;
  L2: number;
  D0: number;
  uAxis0: THREE.Vector3;
  thetaKnee0: number;
  alphaHip0: number;
  footWorldQuat0: THREE.Quaternion;
  toesLocalQuat0: THREE.Quaternion;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomFromRange(range: readonly [number, number]): number {
  return randomBetween(range[0], range[1]);
}

/**
 * NaturalIdleController
 *
 * Exclusively owns the 9 lower-body humanoid bones:
 * - hips (position + quaternion)
 * - leftUpperLeg, leftLowerLeg, leftFoot, leftToes
 * - rightUpperLeg, rightLowerLeg, rightFoot, rightToes
 *
 * Implements:
 * 1. Analytical 3D two-bone leg IK + 3-DOF ankle world-orientation lock.
 * 2. Coupled pelvic vertical ceiling constraint preventing support-leg overreach.
 * 3. Toe-pivot heel peel for natural unweighted contrapposto rest.
 * 4. Autonomous quintic transitions across posture archetypes.
 * 5. Continuous multi-frequency micro-sway.
 * 6. Additive PelvicCounterOffset publication to BreathingController.
 */
export class NaturalIdleController implements AvatarController {
  public readonly id = 'lowerBody';

  private config: NaturalIdleConfig;
  private vrm: VRM | null = null;
  private enabled = true;
  private paused = false;

  // Posture state
  private currentPosture: PostureName = 'neutral_stand';
  private targetPosture: PostureName = 'neutral_stand';
  private transitionProgress = 1.0;
  private transitionDurationSeconds = 1.6;
  private holdTimerSeconds = 10.0;
  private isInitialHold = true;
  private isExplicitPosture = false;
  private microSwayElapsedSeconds = 0.0;

  // Live blended posture parameters for snap-free interruptions
  private fromPoseParams: {
    pelvisTranslation: [number, number, number];
    pelvisRotationEuler: [number, number, number];
    pelvicCounter: PelvicCounterTarget;
    leftLeg: LegPoseTarget;
    rightLeg: LegPoseTarget;
  } = {
    pelvisTranslation: [0, 0, 0],
    pelvisRotationEuler: [0, 0, 0],
    pelvicCounter: {
      spineRollRad: 0,
      spinePitchRad: 0,
      spineYawRad: 0,
      chestRollRad: 0,
      chestPitchRad: 0,
      chestYawRad: 0,
    },
    leftLeg: { heelLiftRad: 0, kneeSwivelRad: 0 },
    rightLeg: { heelLiftRad: 0, kneeSwivelRad: 0 },
  };

  private currentPoseParams: {
    pelvisTranslation: [number, number, number];
    pelvisRotationEuler: [number, number, number];
    pelvicCounter: PelvicCounterTarget;
    leftLeg: LegPoseTarget;
    rightLeg: LegPoseTarget;
  } = {
    pelvisTranslation: [0, 0, 0],
    pelvisRotationEuler: [0, 0, 0],
    pelvicCounter: {
      spineRollRad: 0,
      spinePitchRad: 0,
      spineYawRad: 0,
      chestRollRad: 0,
      chestPitchRad: 0,
      chestYawRad: 0,
    },
    leftLeg: { heelLiftRad: 0, kneeSwivelRad: 0 },
    rightLeg: { heelLiftRad: 0, kneeSwivelRad: 0 },
  };

  // Callback to BreathingController
  private onPelvicOffset?: (offset: PelvicCounterOffset) => void;

  public setPelvicOffsetHandler(
    handler: ((offset: PelvicCounterOffset) => void) | undefined,
  ): void {
    this.onPelvicOffset = handler;
  }

  // Listeners for React state sync
  private readonly listeners = new Set<() => void>();
  private cachedSnapshot: NaturalIdleStatusSnapshot;

  // Rest transforms captured on attach
  private hipsNode: THREE.Object3D | null = null;
  private readonly hipsRestPos = new THREE.Vector3();
  private readonly hipsRestQuat = new THREE.Quaternion();
  private leftLeg: LegChainRestData | null = null;
  private rightLeg: LegChainRestData | null = null;

  // Reusable scratch objects (zero per-frame heap allocations)
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpVecC = new THREE.Vector3();
  private readonly tmpQuatA = new THREE.Quaternion();
  private readonly tmpEulerA = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly vX = new THREE.Vector3(1, 0, 0);

  // Dedicated IK scratch objects to prevent any variable aliasing
  private readonly ikTargetAnkle = new THREE.Vector3();
  private readonly ikTargetFootQuat = new THREE.Quaternion();
  private readonly ikTargetToesQuat = new THREE.Quaternion();
  private readonly ikHipPos = new THREE.Vector3();
  private readonly ikVecToAnkle = new THREE.Vector3();
  private readonly ikUAxis = new THREE.Vector3();
  private readonly ikQSwing = new THREE.Quaternion();
  private readonly ikQTwist = new THREE.Quaternion();
  private readonly ikQPitch = new THREE.Quaternion();
  private readonly ikQUpperWorld = new THREE.Quaternion();
  private readonly ikQHipsWorldInv = new THREE.Quaternion();
  private readonly ikQLowerWorldInv = new THREE.Quaternion();
  private readonly ikQHeelPitch = new THREE.Quaternion();
  private readonly ikQToesCounter = new THREE.Quaternion();

  // Smoothly damped additive autonomous activity lower-body offsets (zero per-frame allocations)
  private targetAutoDX = 0;
  private targetAutoDY = 0;
  private targetAutoDZ = 0;
  private targetAutoPitch = 0;
  private targetAutoYaw = 0;
  private targetAutoRoll = 0;
  private targetAutoLeftHeel = 0;
  private targetAutoRightHeel = 0;
  private targetAutoLeftSwivel = 0;
  private targetAutoRightSwivel = 0;
  private suppressAutonomousPostureTimer = false;

  private currentAutoDX = 0;
  private currentAutoDY = 0;
  private currentAutoDZ = 0;
  private currentAutoPitch = 0;
  private currentAutoYaw = 0;
  private currentAutoRoll = 0;
  private currentAutoLeftHeel = 0;
  private currentAutoRightHeel = 0;
  private currentAutoLeftSwivel = 0;
  private currentAutoRightSwivel = 0;

  constructor(config: Partial<NaturalIdleConfig> = {}) {
    this.config = { ...DEFAULT_NATURAL_IDLE_CONFIG, ...config };
    this.enabled = this.config.enabled;
    this.holdTimerSeconds = randomFromRange(this.config.initialHoldRangeSeconds);
    this.cachedSnapshot = this.buildSnapshot();
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled && this.currentPosture !== 'neutral_stand') {
      this.transitionTo('neutral_stand', 2.2);
    }
    this.notifySnapshot();
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.notifySnapshot();
  }

  public getSnapshot = (): NaturalIdleStatusSnapshot => {
    return this.cachedSnapshot;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private buildSnapshot(): NaturalIdleStatusSnapshot {
    return {
      currentPosture: this.currentPosture,
      targetPosture: this.targetPosture,
      isTransitioning: this.transitionProgress < 1.0,
      transitionProgress: this.transitionProgress,
      enabled: this.enabled,
      paused: this.paused,
    };
  }

  private notifySnapshot(): void {
    this.cachedSnapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Programmatic posture transition request (used by Dev HUD and attention cues).
   */
  public setPosture(name: PostureName, durationSeconds?: number): void {
    this.isExplicitPosture = name !== 'neutral_stand';
    this.transitionTo(
      name,
      durationSeconds ?? getTransitionDurationSeconds(this.currentPosture, name),
    );
  }

  /**
   * Cues from user presence or camera interaction:
   * Extends posture hold time without interrupting explicitly selected postures.
   */
  public onUserInteraction(): void {
    this.holdTimerSeconds = Math.max(this.holdTimerSeconds, 16.0);
    // Camera orbit/pan or background presence should NEVER cancel an explicitly selected posture.
    // Only return to neutral if the current posture was an autonomous background shift.
    if (!this.isExplicitPosture && this.currentPosture !== 'neutral_stand' && this.transitionProgress >= 1.0) {
      this.transitionTo('neutral_stand', 2.0);
    }
  }

  /**
   * Cues from conversational speaking/listening states.
   */
  public setConversationMode(mode: 'NONE' | 'LISTENING' | 'SPEAKING'): void {
    if (mode !== 'NONE' && this.currentPosture !== 'neutral_stand') {
      this.isExplicitPosture = false;
      this.transitionTo('neutral_stand', 1.8);
    }
  }

  /**
   * Explicit conversational reset (e.g. from Interact button or user text message).
   */
  public returnToNeutral(durationSeconds = 1.6): void {
    this.isExplicitPosture = false;
    this.setAutonomousLowerBodyOffset(null);
    this.transitionTo('neutral_stand', durationSeconds);
  }

  /**
   * Sets or clears additive lower-body offsets requested by `AutonomousActivityScheduler`
   * (e.g. gentle knee bends, calf raises, lateral side-stretch hip anchors).
   */
  public setAutonomousLowerBodyOffset(offset: AutonomousLowerBodyOffset | null): void {
    if (!offset) {
      this.targetAutoDX = 0;
      this.targetAutoDY = 0;
      this.targetAutoDZ = 0;
      this.targetAutoPitch = 0;
      this.targetAutoYaw = 0;
      this.targetAutoRoll = 0;
      this.targetAutoLeftHeel = 0;
      this.targetAutoRightHeel = 0;
      this.targetAutoLeftSwivel = 0;
      this.targetAutoRightSwivel = 0;
      this.suppressAutonomousPostureTimer = false;
      return;
    }

    const pos = offset.pelvisTranslation;
    const rot = offset.pelvisRotationEuler;

    this.targetAutoDX = clampRange(pos?.[0], -0.048, 0.048);
    this.targetAutoDY = clampRange(pos?.[1], -0.035, 0.060);
    this.targetAutoDZ = clampRange(pos?.[2], -0.030, 0.030);

    this.targetAutoPitch = clampRange(rot?.[0], -0.1, 0.1);
    this.targetAutoYaw = clampRange(rot?.[1], -0.1, 0.1);
    this.targetAutoRoll = clampRange(rot?.[2], -0.1, 0.1);

    this.targetAutoLeftHeel = clampRange(offset.leftHeelLiftRad, 0, 0.55);
    this.targetAutoRightHeel = clampRange(offset.rightHeelLiftRad, 0, 0.55);
    this.targetAutoLeftSwivel = clampRange(offset.leftKneeSwivelRad, -0.15, 0.15);
    this.targetAutoRightSwivel = clampRange(offset.rightKneeSwivelRad, -0.15, 0.15);
    this.suppressAutonomousPostureTimer = Boolean(offset.suppressPostureTimer);
  }

  private transitionTo(toPosture: PostureName, durationSeconds: number): void {
    if (this.targetPosture === toPosture && this.transitionProgress < 1.0) {
      return;
    }
    // Snap-free interruption: capture the exact live blended pose as the starting point
    this.fromPoseParams = {
      pelvisTranslation: [...this.currentPoseParams.pelvisTranslation],
      pelvisRotationEuler: [...this.currentPoseParams.pelvisRotationEuler],
      pelvicCounter: { ...this.currentPoseParams.pelvicCounter },
      leftLeg: { ...this.currentPoseParams.leftLeg },
      rightLeg: { ...this.currentPoseParams.rightLeg },
    };
    this.targetPosture = toPosture;
    this.transitionDurationSeconds = Math.max(0.05, durationSeconds);
    this.transitionProgress = 0.0;
    this.notifySnapshot();
  }

  public attach(vrm: VRM): void {
    this.vrm = vrm;

    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (!hips) {
      return;
    }
    this.hipsNode = hips;
    this.hipsRestPos.copy(hips.position);
    this.hipsRestQuat.copy(hips.quaternion);

    vrm.scene.updateMatrixWorld(true);

    this.leftLeg = this.captureLegRestData('left');
    this.rightLeg = this.captureLegRestData('right');

    const neutral = POSTURE_ARCHETYPES.neutral_stand;
    this.fromPoseParams = {
      pelvisTranslation: [...neutral.pelvisTranslation],
      pelvisRotationEuler: [...neutral.pelvisRotationEuler],
      pelvicCounter: { ...neutral.pelvicCounter },
      leftLeg: { ...neutral.leftLeg },
      rightLeg: { ...neutral.rightLeg },
    };
    this.currentPoseParams = {
      pelvisTranslation: [...neutral.pelvisTranslation],
      pelvisRotationEuler: [...neutral.pelvisRotationEuler],
      pelvicCounter: { ...neutral.pelvicCounter },
      leftLeg: { ...neutral.leftLeg },
      rightLeg: { ...neutral.rightLeg },
    };

    this.currentPosture = 'neutral_stand';
    this.targetPosture = 'neutral_stand';
    this.transitionProgress = 1.0;
    this.holdTimerSeconds = randomFromRange(this.config.initialHoldRangeSeconds);
    this.isInitialHold = true;
    this.isExplicitPosture = false;
    this.microSwayElapsedSeconds = 0.0;
    this.notifySnapshot();
  }

  private captureLegRestData(side: 'left' | 'right'): LegChainRestData | null {
    if (!this.vrm) return null;
    const upper = this.vrm.humanoid.getNormalizedBoneNode(`${side}UpperLeg`);
    const lower = this.vrm.humanoid.getNormalizedBoneNode(`${side}LowerLeg`);
    const foot = this.vrm.humanoid.getNormalizedBoneNode(`${side}Foot`);
    const toes = this.vrm.humanoid.getNormalizedBoneNode(`${side}Toes`);

    if (!upper || !lower || !foot || !toes) {
      return null;
    }

    upper.updateWorldMatrix(true, false);
    lower.updateWorldMatrix(true, false);
    foot.updateWorldMatrix(true, false);
    toes.updateWorldMatrix(true, false);

    const pHip0 = new THREE.Vector3().setFromMatrixPosition(upper.matrixWorld);
    const pKnee0 = new THREE.Vector3().setFromMatrixPosition(lower.matrixWorld);
    const pAnkle0 = new THREE.Vector3().setFromMatrixPosition(foot.matrixWorld);
    const pToes0 = new THREE.Vector3().setFromMatrixPosition(toes.matrixWorld);

    const vFemur0 = pKnee0.clone().sub(pHip0);
    const vShin0 = pAnkle0.clone().sub(pKnee0);
    const L1 = vFemur0.length();
    const L2 = vShin0.length();
    const D0 = pAnkle0.distanceTo(pHip0);
    const uAxis0 = pAnkle0.clone().sub(pHip0).normalize();

    const cosKnee0 = THREE.MathUtils.clamp(
      (L1 * L1 + L2 * L2 - D0 * D0) / (2 * L1 * L2),
      -1,
      1,
    );
    const thetaKnee0 = Math.PI - Math.acos(cosKnee0);

    const cosHip0 = THREE.MathUtils.clamp(
      (L1 * L1 + D0 * D0 - L2 * L2) / (2 * L1 * D0),
      -1,
      1,
    );
    const alphaHip0 = Math.acos(cosHip0);

    const footWorldQuat0 = new THREE.Quaternion();
    foot.getWorldQuaternion(footWorldQuat0);

    return {
      side,
      upper,
      lower,
      foot,
      toes,
      pHip0,
      pKnee0,
      pAnkle0,
      pToes0,
      L1,
      L2,
      D0,
      uAxis0,
      thetaKnee0,
      alphaHip0,
      footWorldQuat0,
      toesLocalQuat0: toes.quaternion.clone(),
    };
  }

  public update(_vrm: VRM, deltaTime: number): void {
    if (this.paused || deltaTime <= 0 || !this.hipsNode || !this.leftLeg || !this.rightLeg) {
      return;
    }

    // 1. Advance posture transition progress or hold timer
    if (this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(
        1.0,
        this.transitionProgress + deltaTime / this.transitionDurationSeconds,
      );
      if (this.transitionProgress >= 1.0) {
        this.currentPosture = this.targetPosture;
        const currentArch = POSTURE_ARCHETYPES[this.currentPosture];
        this.holdTimerSeconds = randomFromRange(
          this.isInitialHold ? this.config.initialHoldRangeSeconds : currentArch.holdRangeSeconds,
        );
        this.isInitialHold = false;
        this.notifySnapshot();
      }
    } else if (this.enabled && !this.suppressAutonomousPostureTimer) {
      this.holdTimerSeconds -= deltaTime;
      if (this.holdTimerSeconds <= 0) {
        this.pickNextAutonomousPosture();
      }
    }

    // 2. Evaluate blended posture targets using quintic easing
    const blendWeight = quinticEase(this.transitionProgress);
    const fromPose = this.fromPoseParams;
    const toArch = POSTURE_ARCHETYPES[this.targetPosture];

    // Micro-sway (Lissajous frequencies) superposed gently on pelvis
    this.microSwayElapsedSeconds += deltaTime;
    const swayT = this.microSwayElapsedSeconds;
    // Scale micro-sway down during large transitions
    const swayAmplitude = (1.0 - 0.7 * Math.sin(Math.PI * this.transitionProgress)) * 0.001;
    const microSwayX =
      (1.8 * Math.sin(2 * Math.PI * 0.053 * swayT) +
        0.9 * Math.sin(2 * Math.PI * 0.089 * swayT)) *
      swayAmplitude;
    const microSwayZ =
      (1.2 * Math.cos(2 * Math.PI * 0.037 * swayT) +
        0.6 * Math.cos(2 * Math.PI * 0.071 * swayT)) *
      swayAmplitude;

    // Interpolate live parameters and cache them
    this.currentPoseParams.pelvisTranslation[0] = THREE.MathUtils.lerp(
      fromPose.pelvisTranslation[0],
      toArch.pelvisTranslation[0],
      blendWeight,
    );
    this.currentPoseParams.pelvisTranslation[1] = THREE.MathUtils.lerp(
      fromPose.pelvisTranslation[1],
      toArch.pelvisTranslation[1],
      blendWeight,
    );
    this.currentPoseParams.pelvisTranslation[2] = THREE.MathUtils.lerp(
      fromPose.pelvisTranslation[2],
      toArch.pelvisTranslation[2],
      blendWeight,
    );

    this.currentPoseParams.pelvisRotationEuler[0] = THREE.MathUtils.lerp(
      fromPose.pelvisRotationEuler[0],
      toArch.pelvisRotationEuler[0],
      blendWeight,
    );
    this.currentPoseParams.pelvisRotationEuler[1] = THREE.MathUtils.lerp(
      fromPose.pelvisRotationEuler[1],
      toArch.pelvisRotationEuler[1],
      blendWeight,
    );
    this.currentPoseParams.pelvisRotationEuler[2] = THREE.MathUtils.lerp(
      fromPose.pelvisRotationEuler[2],
      toArch.pelvisRotationEuler[2],
      blendWeight,
    );

    this.currentPoseParams.leftLeg = {
      heelLiftRad: THREE.MathUtils.lerp(
        fromPose.leftLeg.heelLiftRad,
        toArch.leftLeg.heelLiftRad,
        blendWeight,
      ),
      kneeSwivelRad: THREE.MathUtils.lerp(
        fromPose.leftLeg.kneeSwivelRad,
        toArch.leftLeg.kneeSwivelRad,
        blendWeight,
      ),
    };

    this.currentPoseParams.rightLeg = {
      heelLiftRad: THREE.MathUtils.lerp(
        fromPose.rightLeg.heelLiftRad,
        toArch.rightLeg.heelLiftRad,
        blendWeight,
      ),
      kneeSwivelRad: THREE.MathUtils.lerp(
        fromPose.rightLeg.kneeSwivelRad,
        toArch.rightLeg.kneeSwivelRad,
        blendWeight,
      ),
    };

    this.currentPoseParams.pelvicCounter = {
      spineRollRad: THREE.MathUtils.lerp(
        fromPose.pelvicCounter.spineRollRad,
        toArch.pelvicCounter.spineRollRad,
        blendWeight,
      ),
      spinePitchRad: THREE.MathUtils.lerp(
        fromPose.pelvicCounter.spinePitchRad,
        toArch.pelvicCounter.spinePitchRad,
        blendWeight,
      ),
      spineYawRad: THREE.MathUtils.lerp(
        fromPose.pelvicCounter.spineYawRad,
        toArch.pelvicCounter.spineYawRad,
        blendWeight,
      ),
      chestRollRad: THREE.MathUtils.lerp(
        fromPose.pelvicCounter.chestRollRad,
        toArch.pelvicCounter.chestRollRad,
        blendWeight,
      ),
      chestPitchRad: THREE.MathUtils.lerp(
        fromPose.pelvicCounter.chestPitchRad,
        toArch.pelvicCounter.chestPitchRad,
        blendWeight,
      ),
      chestYawRad: THREE.MathUtils.lerp(
        fromPose.pelvicCounter.chestYawRad,
        toArch.pelvicCounter.chestYawRad,
        blendWeight,
      ),
    };

    // Smoothly damp additive autonomous activity lower-body offsets
    const autoLambda = 7.2;
    this.currentAutoDX = dampScalar(this.currentAutoDX, this.targetAutoDX, autoLambda, deltaTime);
    this.currentAutoDY = dampScalar(this.currentAutoDY, this.targetAutoDY, autoLambda, deltaTime);
    this.currentAutoDZ = dampScalar(this.currentAutoDZ, this.targetAutoDZ, autoLambda, deltaTime);
    this.currentAutoPitch = dampScalar(
      this.currentAutoPitch,
      this.targetAutoPitch,
      autoLambda,
      deltaTime,
    );
    this.currentAutoYaw = dampScalar(this.currentAutoYaw, this.targetAutoYaw, autoLambda, deltaTime);
    this.currentAutoRoll = dampScalar(
      this.currentAutoRoll,
      this.targetAutoRoll,
      autoLambda,
      deltaTime,
    );
    this.currentAutoLeftHeel = dampScalar(
      this.currentAutoLeftHeel,
      this.targetAutoLeftHeel,
      autoLambda,
      deltaTime,
    );
    this.currentAutoRightHeel = dampScalar(
      this.currentAutoRightHeel,
      this.targetAutoRightHeel,
      autoLambda,
      deltaTime,
    );
    this.currentAutoLeftSwivel = dampScalar(
      this.currentAutoLeftSwivel,
      this.targetAutoLeftSwivel,
      autoLambda,
      deltaTime,
    );
    this.currentAutoRightSwivel = dampScalar(
      this.currentAutoRightSwivel,
      this.targetAutoRightSwivel,
      autoLambda,
      deltaTime,
    );

    const targetDX = this.currentPoseParams.pelvisTranslation[0] + microSwayX + this.currentAutoDX;
    const targetDY = this.currentPoseParams.pelvisTranslation[1] + this.currentAutoDY;
    const targetDZ = this.currentPoseParams.pelvisTranslation[2] + microSwayZ + this.currentAutoDZ;

    const targetPitch = this.currentPoseParams.pelvisRotationEuler[0] + this.currentAutoPitch;
    const targetYaw = this.currentPoseParams.pelvisRotationEuler[1] + this.currentAutoYaw;
    const targetRoll = this.currentPoseParams.pelvisRotationEuler[2] + this.currentAutoRoll;

    const leftHeelLift = Math.max(
      0,
      this.currentPoseParams.leftLeg.heelLiftRad + this.currentAutoLeftHeel,
    );
    const leftSwivel = this.currentPoseParams.leftLeg.kneeSwivelRad + this.currentAutoLeftSwivel;
    const rightHeelLift = Math.max(
      0,
      this.currentPoseParams.rightLeg.heelLiftRad + this.currentAutoRightHeel,
    );
    const rightSwivel = this.currentPoseParams.rightLeg.kneeSwivelRad + this.currentAutoRightSwivel;

    // 3. Apply Pelvic Counter-Balance Offset to BreathingController
    if (this.onPelvicOffset) {
      this.onPelvicOffset(this.currentPoseParams.pelvicCounter);
    }

    // 4. Set Pelvis Orientation and calculate ceiling-constrained Pelvis Y
    this.tmpEulerA.set(targetPitch, targetYaw, targetRoll, 'YXZ');
    this.hipsNode.quaternion
      .copy(this.hipsRestQuat)
      .multiply(this.tmpQuatA.setFromEuler(this.tmpEulerA))
      .normalize();

    // Compute coupled vertical ceiling to prevent support-leg overreach
    const safeHipsY = this.computeCoupledHipsYCeiling(
      targetDX,
      targetDY,
      targetDZ,
      this.hipsNode.quaternion,
      this.leftLeg,
      this.rightLeg,
      leftHeelLift,
      rightHeelLift,
    );

    this.hipsNode.position.set(
      this.hipsRestPos.x + targetDX,
      safeHipsY,
      this.hipsRestPos.z + targetDZ,
    );

    // Settle hips matrix world before solving leg chains
    this.hipsNode.updateWorldMatrix(true, false);

    // 5. Solve Analytical 3D Leg IK & 3-DOF Ankle World Lock for both legs
    this.solveLegIK(this.leftLeg, leftHeelLift, leftSwivel);
    this.solveLegIK(this.rightLeg, rightHeelLift, rightSwivel);
  }

  /**
   * Computes the mathematical ceiling on hips.position.y to ensure that under any pelvic roll,
   * neither leg is stretched beyond D_max (which would cause knee pop or floor penetration).
   */
  private computeCoupledHipsYCeiling(
    dx: number,
    desiredDy: number,
    dz: number,
    qHips: THREE.Quaternion,
    leftLeg: LegChainRestData,
    rightLeg: LegChainRestData,
    leftHeelLift: number,
    rightHeelLift: number,
  ): number {
    const minFlexionLeft = leftLeg.thetaKnee0 + this.config.kneeSafetyBufferRad;
    const D_max_left = Math.sqrt(
      leftLeg.L1 * leftLeg.L1 +
        leftLeg.L2 * leftLeg.L2 -
        2 * leftLeg.L1 * leftLeg.L2 * Math.cos(Math.PI - minFlexionLeft),
    );

    const minFlexionRight = rightLeg.thetaKnee0 + this.config.kneeSafetyBufferRad;
    const D_max_right = Math.sqrt(
      rightLeg.L1 * rightLeg.L1 +
        rightLeg.L2 * rightLeg.L2 -
        2 * rightLeg.L1 * rightLeg.L2 * Math.cos(Math.PI - minFlexionRight),
    );

    // Target ankle Y coordinates (accounting for heel lift)
    const targetAnkleY_left = this.getTargetAnkleY(leftLeg, leftHeelLift);
    const targetAnkleY_right = this.getTargetAnkleY(rightLeg, rightHeelLift);

    // Relative socket offset in hips local space rotated by qHips
    const rLeft = this.tmpVecA.copy(leftLeg.upper.position).applyQuaternion(qHips);
    const rRight = this.tmpVecB.copy(rightLeg.upper.position).applyQuaternion(qHips);

    const currentHipX_left = this.hipsRestPos.x + dx + rLeft.x;
    const currentHipZ_left = this.hipsRestPos.z + dz + rLeft.z;
    const dXZ_left_sq =
      (currentHipX_left - leftLeg.pAnkle0.x) ** 2 +
      (currentHipZ_left - leftLeg.pAnkle0.z) ** 2;

    const currentHipX_right = this.hipsRestPos.x + dx + rRight.x;
    const currentHipZ_right = this.hipsRestPos.z + dz + rRight.z;
    const dXZ_right_sq =
      (currentHipX_right - rightLeg.pAnkle0.x) ** 2 +
      (currentHipZ_right - rightLeg.pAnkle0.z) ** 2;

    const ceilingLeft =
      targetAnkleY_left -
      rLeft.y +
      Math.sqrt(Math.max(0, D_max_left * D_max_left - dXZ_left_sq));

    const ceilingRight =
      targetAnkleY_right -
      rRight.y +
      Math.sqrt(Math.max(0, D_max_right * D_max_right - dXZ_right_sq));

    const yCeiling = Math.min(ceilingLeft, ceilingRight);
    return Math.min(this.hipsRestPos.y + desiredDy, yCeiling);
  }

  private getTargetAnkleY(leg: LegChainRestData, heelLiftRad: number): number {
    if (heelLiftRad <= 1e-5) {
      return leg.pAnkle0.y;
    }
    this.ikQHeelPitch.setFromAxisAngle(this.vX, heelLiftRad);
    const offset = this.tmpVecC.copy(leg.pAnkle0).sub(leg.pToes0).applyQuaternion(this.ikQHeelPitch);
    return leg.pToes0.y + offset.y;
  }

  /**
   * Exact Closed-Form 3D Leg IK & 3-DOF Ankle World Lock
   */
  private solveLegIK(
    leg: LegChainRestData,
    heelLiftRad: number,
    kneeSwivelRad: number,
  ): void {
    if (!this.hipsNode) return;

    // 1. Determine target ankle world position, target foot world quat, and target toes quat
    this.ikTargetAnkle.copy(leg.pAnkle0);
    this.ikTargetFootQuat.copy(leg.footWorldQuat0);
    this.ikTargetToesQuat.copy(leg.toesLocalQuat0);

    if (heelLiftRad > 1e-5) {
      this.ikQHeelPitch.setFromAxisAngle(this.vX, heelLiftRad);
      this.ikTargetAnkle.sub(leg.pToes0).applyQuaternion(this.ikQHeelPitch).add(leg.pToes0);
      this.ikTargetFootQuat.premultiply(this.ikQHeelPitch);

      this.ikQToesCounter.setFromAxisAngle(this.vX, -heelLiftRad);
      this.ikTargetToesQuat.multiply(this.ikQToesCounter);
    }

    // 2. Read transformed hip socket position in avatar root/world space
    leg.upper.updateWorldMatrix(true, false);
    this.ikHipPos.setFromMatrixPosition(leg.upper.matrixWorld);

    // Vector from transformed hip socket to target ankle
    this.ikVecToAnkle.copy(this.ikTargetAnkle).sub(this.ikHipPos);
    const rawD = this.ikVecToAnkle.length();

    // Clamp D to safe anatomical reach to prevent hyperextension or arccos singularity
    const minFlexion = leg.thetaKnee0 + this.config.kneeSafetyBufferRad;
    const maxFlexion = THREE.MathUtils.degToRad(40.0);

    const D_max = Math.sqrt(
      leg.L1 * leg.L1 +
        leg.L2 * leg.L2 -
        2 * leg.L1 * leg.L2 * Math.cos(Math.PI - minFlexion),
    );
    const D_min = Math.sqrt(
      leg.L1 * leg.L1 +
        leg.L2 * leg.L2 -
        2 * leg.L1 * leg.L2 * Math.cos(Math.PI - maxFlexion),
    );

    const D = THREE.MathUtils.clamp(rawD, D_min, D_max);

    // 3. Law of Cosines for interior knee deflection and hip pitch deflection
    const cosInterior = THREE.MathUtils.clamp(
      (leg.L1 * leg.L1 + leg.L2 * leg.L2 - D * D) / (2 * leg.L1 * leg.L2),
      -1,
      1,
    );
    const thetaKnee = Math.PI - Math.acos(cosInterior);
    const deltaKnee = Math.max(0, thetaKnee - leg.thetaKnee0);

    const cosHip = THREE.MathUtils.clamp(
      (leg.L1 * leg.L1 + D * D - leg.L2 * leg.L2) / (2 * leg.L1 * D),
      -1,
      1,
    );
    const alphaHip = Math.acos(cosHip);
    const deltaAlphaHip = alphaHip - leg.alphaHip0;

    // 4. LowerLeg 1-DOF hinge (+X = backward knee flexion)
    leg.lower.quaternion.setFromAxisAngle(this.vX, deltaKnee);

    // 5. UpperLeg 3-stage world rotation:
    // a) Pitch femur forward (-X) by deltaAlphaHip so local hip->ankle chord length becomes D
    this.ikQPitch.setFromAxisAngle(this.vX, -deltaAlphaHip);
    // b) Swing rest chord axis uAxis0 onto current chord axis uAxis
    this.ikUAxis.copy(this.ikVecToAnkle).normalize();
    this.ikQSwing.setFromUnitVectors(leg.uAxis0, this.ikUAxis);
    // c) Twist around uAxis by kneeSwivelRad
    this.ikQTwist.setFromAxisAngle(this.ikUAxis, kneeSwivelRad);

    this.ikQUpperWorld.copy(this.ikQTwist).multiply(this.ikQSwing).multiply(this.ikQPitch);

    // Convert upperLeg world rotation to hips local space
    this.hipsNode.getWorldQuaternion(this.ikQHipsWorldInv).invert();
    leg.upper.quaternion.copy(this.ikQHipsWorldInv).multiply(this.ikQUpperWorld);

    // 6. Ankle 3-DOF world-leveling orientation lock:
    // q_foot_local = q_lower_world^{-1} * targetFootWorldQuat
    leg.upper.updateWorldMatrix(true, false);
    leg.lower.updateWorldMatrix(true, false);

    leg.lower.getWorldQuaternion(this.ikQLowerWorldInv).invert();
    leg.foot.quaternion.copy(this.ikQLowerWorldInv).multiply(this.ikTargetFootQuat);

    // 7. Toes local rotation (counter-dorsiflexion so toes stay grounded during heel peel)
    leg.toes.quaternion.copy(this.ikTargetToesQuat);
  }

  private pickNextAutonomousPosture(): void {
    const candidates: PostureName[] = [
      'neutral_stand',
      'weight_left',
      'weight_right',
      'relaxed_settle',
    ].filter((p) => p !== this.currentPosture) as PostureName[];

    // If we just had a weight_left or weight_right, prefer transitioning through neutral or relaxed
    let next: PostureName;
    if (this.currentPosture === 'weight_left' || this.currentPosture === 'weight_right') {
      const preferred: PostureName[] = ['neutral_stand', 'relaxed_settle'];
      next = preferred[Math.floor(Math.random() * preferred.length)];
    } else {
      next = candidates[Math.floor(Math.random() * candidates.length)];
    }

    this.isExplicitPosture = false;
    this.transitionTo(next, getTransitionDurationSeconds(this.currentPosture, next));
  }

  public dispose(): void {
    this.setAutonomousLowerBodyOffset(null);
    this.currentAutoDX = 0;
    this.currentAutoDY = 0;
    this.currentAutoDZ = 0;
    this.currentAutoPitch = 0;
    this.currentAutoYaw = 0;
    this.currentAutoRoll = 0;
    this.currentAutoLeftHeel = 0;
    this.currentAutoRightHeel = 0;
    this.currentAutoLeftSwivel = 0;
    this.currentAutoRightSwivel = 0;

    if (this.hipsNode) {
      this.hipsNode.position.copy(this.hipsRestPos);
      this.hipsNode.quaternion.copy(this.hipsRestQuat);
    }

    if (this.leftLeg) {
      this.leftLeg.upper.quaternion.identity();
      this.leftLeg.lower.quaternion.identity();
      this.leftLeg.foot.quaternion.copy(this.leftLeg.footWorldQuat0);
      this.leftLeg.toes.quaternion.copy(this.leftLeg.toesLocalQuat0);
    }

    if (this.rightLeg) {
      this.rightLeg.upper.quaternion.identity();
      this.rightLeg.lower.quaternion.identity();
      this.rightLeg.foot.quaternion.copy(this.rightLeg.footWorldQuat0);
      this.rightLeg.toes.quaternion.copy(this.rightLeg.toesLocalQuat0);
    }

    if (this.onPelvicOffset) {
      this.onPelvicOffset({
        spineRollRad: 0,
        spinePitchRad: 0,
        spineYawRad: 0,
        chestRollRad: 0,
        chestPitchRad: 0,
        chestYawRad: 0,
      });
      this.onPelvicOffset = undefined;
    }

    this.listeners.clear();
    this.vrm = null;
    this.hipsNode = null;
    this.leftLeg = null;
    this.rightLeg = null;
  }
}
