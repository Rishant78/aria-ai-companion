import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { AvatarController } from './types';

const TAU = Math.PI * 2;

export interface BreathingConfig {
  /** Base resting respiration frequency in cycles per second (default: 0.22 Hz, ~4.5s per breath). */
  baseFrequencyHz: number;
  /** Fractional rhythm rate modulation for organic variation without loop seams (default: 0.12). */
  rateVariation: number;
  /** Fractional breath depth modulation across cycles (default: 0.14). */
  depthVariation: number;
  /** Primary chest inhalation pitch amplitude in radians (default: 0.015, ~0.86 deg). */
  chestPitchRad: number;
  /** Upper-chest secondary inhalation pitch amplitude in radians (default: 0.011, ~0.63 deg). */
  upperChestPitchRad: number;
  /** Subtle lower-spine breathing base amplitude in radians (default: 0.005). */
  spineBreathPitchRad: number;
  /** Bilateral clavicle/shoulder vertical rise amplitude in radians (default: 0.011, ~0.63 deg). */
  shoulderLiftRad: number;
  /** Subtle lateral posture weight-shift roll amplitude on spine in radians (default: 0.0085). */
  postureSwayRollRad: number;
  /** Subtle posture torso yaw drift amplitude on spine in radians (default: 0.0075). */
  postureSwayYawRad: number;
}

export const DEFAULT_BREATHING_CONFIG: BreathingConfig = {
  baseFrequencyHz: 0.22,
  rateVariation: 0.12,
  depthVariation: 0.14,
  chestPitchRad: 0.015,
  upperChestPitchRad: 0.011,
  spineBreathPitchRad: 0.005,
  shoulderLiftRad: 0.011,
  postureSwayRollRad: 0.0085,
  postureSwayYawRad: 0.0075,
};

/**
 * Additive upper-body posture & clavicle offset published by GestureController
 * so BreathingController remains the sole writer of torso and shoulder bones.
 */
export interface UpperBodyGestureOffset {
  /** Additive spine forward/backward pitch in radians (+ = gentle forward lean, - = open chest). */
  readonly spinePitchRad?: number;
  /** Additive spine yaw twist in radians (+ = left, - = right). */
  readonly spineYawRad?: number;
  /** Additive spine lateral roll in radians. */
  readonly spineRollRad?: number;
  /** Additive chest forward/backward pitch in radians. */
  readonly chestPitchRad?: number;
  /** Additive left clavicle upward shrug lift in radians (+ = upward lift). */
  readonly leftShoulderLiftRad?: number;
  /** Additive right clavicle upward shrug lift in radians (+ = upward lift). */
  readonly rightShoulderLiftRad?: number;
}

/**
 * Additive lower-body pelvic counter-balance offset published by NaturalIdleController
 * so BreathingController remains the sole writer of torso and shoulder bones.
 */
export interface PelvicCounterOffset {
  readonly spineRollRad?: number;
  readonly spinePitchRad?: number;
  readonly spineYawRad?: number;
  readonly chestRollRad?: number;
  readonly chestPitchRad?: number;
  readonly chestYawRad?: number;
}

/**
 * Additive autonomous full-body activity torso & clavicle offset published by
 * `AutonomousActivityScheduler` so `BreathingController` remains the sole writer
 * of `spine`, `chest`, `upperChest`, `leftShoulder`, and `rightShoulder`.
 */
export interface AutonomousTorsoOffset {
  readonly spinePitchRad?: number;
  readonly spineYawRad?: number;
  readonly spineRollRad?: number;
  readonly chestPitchRad?: number;
  readonly chestYawRad?: number;
  readonly chestRollRad?: number;
  readonly upperChestPitchRad?: number;
  readonly leftShoulderLiftRad?: number;
  readonly rightShoulderLiftRad?: number;
  /** Forward clavicle roll (+ = forward protraction, - = backward retraction). */
  readonly leftShoulderProtractRad?: number;
  /** Forward clavicle roll (+ = forward protraction, - = backward retraction). */
  readonly rightShoulderProtractRad?: number;
  /** Additive respiration depth boost (0..0.6) for deep stretch/settle breaths. */
  readonly breathDepthBoost?: number;
}

function clampAbs(value: number | undefined, limit: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-limit, Math.min(limit, value));
}

function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  const alpha = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * alpha;
}

/**
 * Continuous deltaTime-driven breathing and subtle torso posture controller.
 *
 * Exclusively owns normalized torso/clavicle bones (`spine`, `chest`, `upperChest`,
 * `leftShoulder`, `rightShoulder`) relative to captured rest quaternions so there is
 * zero cumulative drift and zero conflict with GazeController (`neck` / `head`).
 */
export class BreathingController implements AvatarController {
  public readonly id = 'breathing';

  private config: BreathingConfig;
  private enabled = true;
  private postureEnabled = true;
  private paused = false;

  private vrm: VRM | null = null;

  // Bounded phase accumulators in [0, 2*PI) — never grow unbounded or reset visibly
  private breathPhase = 0;
  private rhythmModPhase = 0.8;
  private depthModPhase = 2.1;
  private postureRollPhaseA = 0.4;
  private postureRollPhaseB = 1.9;
  private postureYawPhase = 3.2;

  // Smooth amplitude envelopes (0..1) so toggling on/off never snaps bones
  private breathBlend = 1;
  private postureBlend = 1;

  // Target & smoothly damped additive gesture offsets (torso & clavicle shrugs)
  private targetGestureSpinePitch = 0;
  private targetGestureSpineYaw = 0;
  private targetGestureSpineRoll = 0;
  private targetGestureChestPitch = 0;
  private targetGestureLeftShoulder = 0;
  private targetGestureRightShoulder = 0;

  private currentGestureSpinePitch = 0;
  private currentGestureSpineYaw = 0;
  private currentGestureSpineRoll = 0;
  private currentGestureChestPitch = 0;
  private currentGestureLeftShoulder = 0;
  private currentGestureRightShoulder = 0;

  // Target & smoothly damped additive pelvic counter-balance offsets (from NaturalIdleController)
  private targetPelvicSpineRoll = 0;
  private targetPelvicSpinePitch = 0;
  private targetPelvicSpineYaw = 0;
  private targetPelvicChestRoll = 0;
  private targetPelvicChestPitch = 0;
  private targetPelvicChestYaw = 0;

  private currentPelvicSpineRoll = 0;
  private currentPelvicSpinePitch = 0;
  private currentPelvicSpineYaw = 0;
  private currentPelvicChestRoll = 0;
  private currentPelvicChestPitch = 0;
  private currentPelvicChestYaw = 0;

  // Target & smoothly damped additive autonomous activity offsets (from AutonomousActivityScheduler)
  private targetActivitySpinePitch = 0;
  private targetActivitySpineYaw = 0;
  private targetActivitySpineRoll = 0;
  private targetActivityChestPitch = 0;
  private targetActivityChestYaw = 0;
  private targetActivityChestRoll = 0;
  private targetActivityUpperChestPitch = 0;
  private targetActivityLeftShoulderLift = 0;
  private targetActivityRightShoulderLift = 0;
  private targetActivityLeftShoulderProtract = 0;
  private targetActivityRightShoulderProtract = 0;
  private targetActivityBreathDepthBoost = 0;

  private currentActivitySpinePitch = 0;
  private currentActivitySpineYaw = 0;
  private currentActivitySpineRoll = 0;
  private currentActivityChestPitch = 0;
  private currentActivityChestYaw = 0;
  private currentActivityChestRoll = 0;
  private currentActivityUpperChestPitch = 0;
  private currentActivityLeftShoulderLift = 0;
  private currentActivityRightShoulderLift = 0;
  private currentActivityLeftShoulderProtract = 0;
  private currentActivityRightShoulderProtract = 0;
  private currentActivityBreathDepthBoost = 0;

  // Immutable rest quaternions captured on attach()
  private readonly spineRestQuat = new THREE.Quaternion();
  private readonly chestRestQuat = new THREE.Quaternion();
  private readonly upperChestRestQuat = new THREE.Quaternion();
  private readonly leftShoulderRestQuat = new THREE.Quaternion();
  private readonly rightShoulderRestQuat = new THREE.Quaternion();

  // Reusable scratch math objects (zero per-frame heap allocations)
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(initialConfig: Partial<BreathingConfig> = {}) {
    this.config = {
      ...DEFAULT_BREATHING_CONFIG,
      ...initialConfig,
    };
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public get isPostureEnabled(): boolean {
    return this.postureEnabled;
  }

  public setPostureEnabled(enabled: boolean): void {
    this.postureEnabled = enabled;
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public updateConfig(patch: Partial<BreathingConfig>): void {
    this.config = {
      ...this.config,
      ...patch,
    };
  }

  /**
   * Sets or clears the additive upper-body/clavicle offset requested by GestureController.
   * Smoothly damped inside `update(vrm, deltaTime)` so bone transitions never snap.
   */
  public setGestureOffset(offset: UpperBodyGestureOffset | null): void {
    if (!offset) {
      this.targetGestureSpinePitch = 0;
      this.targetGestureSpineYaw = 0;
      this.targetGestureSpineRoll = 0;
      this.targetGestureChestPitch = 0;
      this.targetGestureLeftShoulder = 0;
      this.targetGestureRightShoulder = 0;
      return;
    }

    this.targetGestureSpinePitch = clampAbs(offset.spinePitchRad, 0.08);
    this.targetGestureSpineYaw = clampAbs(offset.spineYawRad, 0.12);
    this.targetGestureSpineRoll = clampAbs(offset.spineRollRad, 0.08);
    this.targetGestureChestPitch = clampAbs(offset.chestPitchRad, 0.09);
    this.targetGestureLeftShoulder = clampAbs(offset.leftShoulderLiftRad, 0.16);
    this.targetGestureRightShoulder = clampAbs(offset.rightShoulderLiftRad, 0.16);
  }

  public getDampedGestureOffset(): Required<UpperBodyGestureOffset> {
    return {
      spinePitchRad: this.currentGestureSpinePitch,
      spineYawRad: this.currentGestureSpineYaw,
      spineRollRad: this.currentGestureSpineRoll,
      chestPitchRad: this.currentGestureChestPitch,
      leftShoulderLiftRad: this.currentGestureLeftShoulder,
      rightShoulderLiftRad: this.currentGestureRightShoulder,
    };
  }

  public setPelvicOffset(offset: PelvicCounterOffset | null): void {
    if (!offset) {
      this.targetPelvicSpineRoll = 0;
      this.targetPelvicSpinePitch = 0;
      this.targetPelvicSpineYaw = 0;
      this.targetPelvicChestRoll = 0;
      this.targetPelvicChestPitch = 0;
      this.targetPelvicChestYaw = 0;
      return;
    }

    this.targetPelvicSpineRoll = clampAbs(offset.spineRollRad, 0.08);
    this.targetPelvicSpinePitch = clampAbs(offset.spinePitchRad, 0.08);
    this.targetPelvicSpineYaw = clampAbs(offset.spineYawRad, 0.08);
    this.targetPelvicChestRoll = clampAbs(offset.chestRollRad, 0.06);
    this.targetPelvicChestPitch = clampAbs(offset.chestPitchRad, 0.06);
    this.targetPelvicChestYaw = clampAbs(offset.chestYawRad, 0.06);
  }

  public getDampedPelvicOffset(): Required<PelvicCounterOffset> {
    return {
      spineRollRad: this.currentPelvicSpineRoll,
      spinePitchRad: this.currentPelvicSpinePitch,
      spineYawRad: this.currentPelvicSpineYaw,
      chestRollRad: this.currentPelvicChestRoll,
      chestPitchRad: this.currentPelvicChestPitch,
      chestYawRad: this.currentPelvicChestYaw,
    };
  }

  /**
   * Sets or clears the additive torso & clavicle offset requested by
   * `AutonomousActivityScheduler` (single-writer ownership preserved).
   */
  public setActivityOffset(offset: AutonomousTorsoOffset | null): void {
    if (!offset) {
      this.targetActivitySpinePitch = 0;
      this.targetActivitySpineYaw = 0;
      this.targetActivitySpineRoll = 0;
      this.targetActivityChestPitch = 0;
      this.targetActivityChestYaw = 0;
      this.targetActivityChestRoll = 0;
      this.targetActivityUpperChestPitch = 0;
      this.targetActivityLeftShoulderLift = 0;
      this.targetActivityRightShoulderLift = 0;
      this.targetActivityLeftShoulderProtract = 0;
      this.targetActivityRightShoulderProtract = 0;
      this.targetActivityBreathDepthBoost = 0;
      return;
    }

    this.targetActivitySpinePitch = clampAbs(offset.spinePitchRad, 0.14);
    this.targetActivitySpineYaw = clampAbs(offset.spineYawRad, 0.14);
    this.targetActivitySpineRoll = clampAbs(offset.spineRollRad, 0.14);
    this.targetActivityChestPitch = clampAbs(offset.chestPitchRad, 0.14);
    this.targetActivityChestYaw = clampAbs(offset.chestYawRad, 0.12);
    this.targetActivityChestRoll = clampAbs(offset.chestRollRad, 0.12);
    this.targetActivityUpperChestPitch = clampAbs(offset.upperChestPitchRad, 0.09);
    this.targetActivityLeftShoulderLift = clampAbs(offset.leftShoulderLiftRad, 0.22);
    this.targetActivityRightShoulderLift = clampAbs(offset.rightShoulderLiftRad, 0.22);
    this.targetActivityLeftShoulderProtract = clampAbs(offset.leftShoulderProtractRad, 0.16);
    this.targetActivityRightShoulderProtract = clampAbs(offset.rightShoulderProtractRad, 0.16);
    const rawBoost =
      typeof offset.breathDepthBoost === 'number' && Number.isFinite(offset.breathDepthBoost)
        ? offset.breathDepthBoost
        : 0;
    this.targetActivityBreathDepthBoost = Math.max(0, Math.min(0.65, rawBoost));
  }

  public getDampedActivityOffset(): Required<AutonomousTorsoOffset> {
    return {
      spinePitchRad: this.currentActivitySpinePitch,
      spineYawRad: this.currentActivitySpineYaw,
      spineRollRad: this.currentActivitySpineRoll,
      chestPitchRad: this.currentActivityChestPitch,
      chestYawRad: this.currentActivityChestYaw,
      chestRollRad: this.currentActivityChestRoll,
      upperChestPitchRad: this.currentActivityUpperChestPitch,
      leftShoulderLiftRad: this.currentActivityLeftShoulderLift,
      rightShoulderLiftRad: this.currentActivityRightShoulderLift,
      leftShoulderProtractRad: this.currentActivityLeftShoulderProtract,
      rightShoulderProtractRad: this.currentActivityRightShoulderProtract,
      breathDepthBoost: this.currentActivityBreathDepthBoost,
    };
  }

  public attach(vrm: VRM): void {
    this.vrm = vrm;

    const spine = vrm.humanoid.getNormalizedBoneNode('spine');
    const chest = vrm.humanoid.getNormalizedBoneNode('chest');
    const upperChest = vrm.humanoid.getNormalizedBoneNode('upperChest');
    const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder');
    const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder');

    this.spineRestQuat.copy(spine ? spine.quaternion : this.tmpQuat.identity());
    this.chestRestQuat.copy(chest ? chest.quaternion : this.tmpQuat.identity());
    this.upperChestRestQuat.copy(upperChest ? upperChest.quaternion : this.tmpQuat.identity());
    this.leftShoulderRestQuat.copy(leftShoulder ? leftShoulder.quaternion : this.tmpQuat.identity());
    this.rightShoulderRestQuat.copy(rightShoulder ? rightShoulder.quaternion : this.tmpQuat.identity());

    this.breathBlend = this.enabled ? 1 : 0;
    this.postureBlend = this.postureEnabled ? 1 : 0;
  }

  public update(vrm: VRM, deltaTime: number): void {
    if (this.paused || deltaTime <= 0) {
      return;
    }

    // Smoothly blend breathing & posture envelopes when toggled on/off
    this.breathBlend = dampScalar(this.breathBlend, this.enabled ? 1 : 0, 4.2, deltaTime);
    this.postureBlend = dampScalar(this.postureBlend, this.postureEnabled ? 1 : 0, 3.2, deltaTime);

    // Smoothly damp additive gesture posture & clavicle offsets
    const gestureLambda = 7.2;
    this.currentGestureSpinePitch = dampScalar(
      this.currentGestureSpinePitch,
      this.targetGestureSpinePitch,
      gestureLambda,
      deltaTime,
    );
    this.currentGestureSpineYaw = dampScalar(
      this.currentGestureSpineYaw,
      this.targetGestureSpineYaw,
      gestureLambda,
      deltaTime,
    );
    this.currentGestureSpineRoll = dampScalar(
      this.currentGestureSpineRoll,
      this.targetGestureSpineRoll,
      gestureLambda,
      deltaTime,
    );
    this.currentGestureChestPitch = dampScalar(
      this.currentGestureChestPitch,
      this.targetGestureChestPitch,
      gestureLambda,
      deltaTime,
    );
    this.currentGestureLeftShoulder = dampScalar(
      this.currentGestureLeftShoulder,
      this.targetGestureLeftShoulder,
      gestureLambda,
      deltaTime,
    );
    this.currentGestureRightShoulder = dampScalar(
      this.currentGestureRightShoulder,
      this.targetGestureRightShoulder,
      gestureLambda,
      deltaTime,
    );

    // Smoothly damp additive pelvic counter-balance offsets from NaturalIdleController
    const pelvicLambda = 6.0;
    this.currentPelvicSpineRoll = dampScalar(
      this.currentPelvicSpineRoll,
      this.targetPelvicSpineRoll,
      pelvicLambda,
      deltaTime,
    );
    this.currentPelvicSpinePitch = dampScalar(
      this.currentPelvicSpinePitch,
      this.targetPelvicSpinePitch,
      pelvicLambda,
      deltaTime,
    );
    this.currentPelvicSpineYaw = dampScalar(
      this.currentPelvicSpineYaw,
      this.targetPelvicSpineYaw,
      pelvicLambda,
      deltaTime,
    );
    this.currentPelvicChestRoll = dampScalar(
      this.currentPelvicChestRoll,
      this.targetPelvicChestRoll,
      pelvicLambda,
      deltaTime,
    );
    this.currentPelvicChestPitch = dampScalar(
      this.currentPelvicChestPitch,
      this.targetPelvicChestPitch,
      pelvicLambda,
      deltaTime,
    );
    this.currentPelvicChestYaw = dampScalar(
      this.currentPelvicChestYaw,
      this.targetPelvicChestYaw,
      pelvicLambda,
      deltaTime,
    );

    // Smoothly damp additive autonomous activity torso & clavicle offsets
    const activityLambda = 6.8;
    this.currentActivitySpinePitch = dampScalar(
      this.currentActivitySpinePitch,
      this.targetActivitySpinePitch,
      activityLambda,
      deltaTime,
    );
    this.currentActivitySpineYaw = dampScalar(
      this.currentActivitySpineYaw,
      this.targetActivitySpineYaw,
      activityLambda,
      deltaTime,
    );
    this.currentActivitySpineRoll = dampScalar(
      this.currentActivitySpineRoll,
      this.targetActivitySpineRoll,
      activityLambda,
      deltaTime,
    );
    this.currentActivityChestPitch = dampScalar(
      this.currentActivityChestPitch,
      this.targetActivityChestPitch,
      activityLambda,
      deltaTime,
    );
    this.currentActivityChestYaw = dampScalar(
      this.currentActivityChestYaw,
      this.targetActivityChestYaw,
      activityLambda,
      deltaTime,
    );
    this.currentActivityChestRoll = dampScalar(
      this.currentActivityChestRoll,
      this.targetActivityChestRoll,
      activityLambda,
      deltaTime,
    );
    this.currentActivityUpperChestPitch = dampScalar(
      this.currentActivityUpperChestPitch,
      this.targetActivityUpperChestPitch,
      activityLambda,
      deltaTime,
    );
    this.currentActivityLeftShoulderLift = dampScalar(
      this.currentActivityLeftShoulderLift,
      this.targetActivityLeftShoulderLift,
      activityLambda,
      deltaTime,
    );
    this.currentActivityRightShoulderLift = dampScalar(
      this.currentActivityRightShoulderLift,
      this.targetActivityRightShoulderLift,
      activityLambda,
      deltaTime,
    );
    this.currentActivityLeftShoulderProtract = dampScalar(
      this.currentActivityLeftShoulderProtract,
      this.targetActivityLeftShoulderProtract,
      activityLambda,
      deltaTime,
    );
    this.currentActivityRightShoulderProtract = dampScalar(
      this.currentActivityRightShoulderProtract,
      this.targetActivityRightShoulderProtract,
      activityLambda,
      deltaTime,
    );
    this.currentActivityBreathDepthBoost = dampScalar(
      this.currentActivityBreathDepthBoost,
      this.targetActivityBreathDepthBoost,
      activityLambda,
      deltaTime,
    );

    // Advance slow non-commensurate modulators (irrational ratios prevent loop seams)
    this.rhythmModPhase = (this.rhythmModPhase + TAU * 0.037 * deltaTime) % TAU;
    this.depthModPhase = (this.depthModPhase + TAU * 0.029 * deltaTime) % TAU;

    const instantaneousFreqHz =
      this.config.baseFrequencyHz * (1 + this.config.rateVariation * Math.sin(this.rhythmModPhase));
    this.breathPhase = (this.breathPhase + TAU * instantaneousFreqHz * deltaTime) % TAU;

    // Asymmetric physiological breath wave: smooth inhale crest, slightly longer relaxed exhale
    const rawCycle = 0.5 - 0.5 * Math.cos(this.breathPhase); // [0, 1]
    const shapedInhale = Math.pow(rawCycle, 1.18); // [0, 1]
    const centeredWave = shapedInhale - 0.45; // gently centered around relaxed rest
    const depthScale =
      1 +
      this.config.depthVariation * Math.sin(this.depthModPhase) +
      this.currentActivityBreathDepthBoost;
    const breathSignal = centeredWave * depthScale * this.breathBlend;

    // Slow wandering upper-body posture sway (two incommensurate frequencies)
    this.postureRollPhaseA = (this.postureRollPhaseA + TAU * 0.067 * deltaTime) % TAU;
    this.postureRollPhaseB = (this.postureRollPhaseB + TAU * 0.041 * deltaTime) % TAU;
    this.postureYawPhase = (this.postureYawPhase + TAU * 0.053 * deltaTime) % TAU;

    // Attenuate synthetic spine-only posture sway when lower-body weight shifting is active
    // so sway originates physically from the pelvis rather than competing oscillators.
    const hasPelvicOffset =
      Math.abs(this.currentPelvicSpineRoll) > 1e-4 ||
      Math.abs(this.targetPelvicSpineRoll) > 1e-4 ||
      Math.abs(this.currentPelvicSpineYaw) > 1e-4 ||
      Math.abs(this.currentActivitySpineRoll) > 1e-4;
    const swayScale = hasPelvicOffset ? 0.3 : 1.0;

    const swayRoll =
      (0.65 * Math.sin(this.postureRollPhaseA) + 0.35 * Math.sin(this.postureRollPhaseB)) *
      this.config.postureSwayRollRad *
      this.postureBlend;
    const swayYaw =
      Math.sin(this.postureYawPhase) * this.config.postureSwayYawRad * this.postureBlend;

    const spine = vrm.humanoid.getNormalizedBoneNode('spine');
    const chest = vrm.humanoid.getNormalizedBoneNode('chest');
    const upperChest = vrm.humanoid.getNormalizedBoneNode('upperChest');
    const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder');
    const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder');

    // Note on VRM 1.0 normalized Euler('YXZ'):
    // -X pitches chest upward/backward (inhale expansion); +Z lifts +X leftShoulder, -Z lifts -X rightShoulder.
    if (spine) {
      this.tmpEuler.set(
        -breathSignal * this.config.spineBreathPitchRad +
          this.currentGestureSpinePitch +
          this.currentPelvicSpinePitch +
          this.currentActivitySpinePitch,
        swayYaw * 0.65 * swayScale +
          this.currentGestureSpineYaw * 0.65 +
          this.currentPelvicSpineYaw +
          this.currentActivitySpineYaw,
        swayRoll * swayScale +
          this.currentGestureSpineRoll +
          this.currentPelvicSpineRoll +
          this.currentActivitySpineRoll,
        'YXZ',
      );
      this.tmpQuat.setFromEuler(this.tmpEuler);
      spine.quaternion.copy(this.spineRestQuat).multiply(this.tmpQuat).normalize();
    }

    if (chest) {
      this.tmpEuler.set(
        -breathSignal * this.config.chestPitchRad +
          this.currentGestureChestPitch +
          this.currentPelvicChestPitch +
          this.currentActivityChestPitch,
        swayYaw * 0.35 * swayScale +
          this.currentGestureSpineYaw * 0.35 +
          this.currentPelvicChestYaw +
          this.currentActivityChestYaw,
        -swayRoll * 0.32 * swayScale -
          this.currentGestureSpineRoll * 0.25 +
          this.currentPelvicChestRoll +
          this.currentActivityChestRoll,
        'YXZ',
      );
      this.tmpQuat.setFromEuler(this.tmpEuler);
      chest.quaternion.copy(this.chestRestQuat).multiply(this.tmpQuat).normalize();
    }

    if (upperChest) {
      this.tmpEuler.set(
        -breathSignal * this.config.upperChestPitchRad + this.currentActivityUpperChestPitch,
        0,
        0,
        'YXZ',
      );
      this.tmpQuat.setFromEuler(this.tmpEuler);
      upperChest.quaternion.copy(this.upperChestRestQuat).multiply(this.tmpQuat).normalize();
    }

    // Slight phase lag (~0.22 rad) on shoulders so ribcage leads clavicle lift naturally
    const shoulderWave =
      (Math.pow(0.5 - 0.5 * Math.cos(this.breathPhase - 0.22), 1.18) - 0.45) *
      depthScale *
      this.breathBlend;
    const shoulderLift = shoulderWave * this.config.shoulderLiftRad;

    if (leftShoulder) {
      this.tmpEuler.set(
        0,
        -this.currentActivityLeftShoulderProtract,
        shoulderLift + this.currentGestureLeftShoulder + this.currentActivityLeftShoulderLift,
        'YXZ',
      );
      this.tmpQuat.setFromEuler(this.tmpEuler);
      leftShoulder.quaternion.copy(this.leftShoulderRestQuat).multiply(this.tmpQuat).normalize();
    }

    if (rightShoulder) {
      this.tmpEuler.set(
        0,
        this.currentActivityRightShoulderProtract,
        -(shoulderLift + this.currentGestureRightShoulder + this.currentActivityRightShoulderLift),
        'YXZ',
      );
      this.tmpQuat.setFromEuler(this.tmpEuler);
      rightShoulder.quaternion.copy(this.rightShoulderRestQuat).multiply(this.tmpQuat).normalize();
    }
  }

  public dispose(): void {
    this.setGestureOffset(null);
    this.setPelvicOffset(null);
    this.setActivityOffset(null);
    this.currentGestureSpinePitch = 0;
    this.currentGestureSpineYaw = 0;
    this.currentGestureSpineRoll = 0;
    this.currentGestureChestPitch = 0;
    this.currentGestureLeftShoulder = 0;
    this.currentGestureRightShoulder = 0;

    this.currentPelvicSpineRoll = 0;
    this.currentPelvicSpinePitch = 0;
    this.currentPelvicSpineYaw = 0;
    this.currentPelvicChestRoll = 0;
    this.currentPelvicChestPitch = 0;
    this.currentPelvicChestYaw = 0;

    this.currentActivitySpinePitch = 0;
    this.currentActivitySpineYaw = 0;
    this.currentActivitySpineRoll = 0;
    this.currentActivityChestPitch = 0;
    this.currentActivityChestYaw = 0;
    this.currentActivityChestRoll = 0;
    this.currentActivityUpperChestPitch = 0;
    this.currentActivityLeftShoulderLift = 0;
    this.currentActivityRightShoulderLift = 0;
    this.currentActivityLeftShoulderProtract = 0;
    this.currentActivityRightShoulderProtract = 0;
    this.currentActivityBreathDepthBoost = 0;

    if (this.vrm) {
      const spine = this.vrm.humanoid.getNormalizedBoneNode('spine');
      const chest = this.vrm.humanoid.getNormalizedBoneNode('chest');
      const upperChest = this.vrm.humanoid.getNormalizedBoneNode('upperChest');
      const leftShoulder = this.vrm.humanoid.getNormalizedBoneNode('leftShoulder');
      const rightShoulder = this.vrm.humanoid.getNormalizedBoneNode('rightShoulder');

      if (spine) spine.quaternion.copy(this.spineRestQuat);
      if (chest) chest.quaternion.copy(this.chestRestQuat);
      if (upperChest) upperChest.quaternion.copy(this.upperChestRestQuat);
      if (leftShoulder) leftShoulder.quaternion.copy(this.leftShoulderRestQuat);
      if (rightShoulder) rightShoulder.quaternion.copy(this.rightShoulderRestQuat);

      this.vrm = null;
    }
  }
}

