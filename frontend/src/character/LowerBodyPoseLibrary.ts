import * as THREE from 'three';

export const POSTURE_NAMES = [
  'neutral_stand',
  'weight_left',
  'weight_right',
  'relaxed_settle',
] as const;

export type PostureName = (typeof POSTURE_NAMES)[number];

export interface LegPoseTarget {
  /** Optional heel lift angle in radians (pivots foot around planted ball-of-foot/toes). */
  readonly heelLiftRad: number;
  /** Subtle internal/external knee pole swivel in radians. */
  readonly kneeSwivelRad: number;
}

export interface PelvicCounterTarget {
  readonly spineRollRad: number;
  readonly spinePitchRad: number;
  readonly spineYawRad: number;
  readonly chestRollRad: number;
  readonly chestPitchRad: number;
  readonly chestYawRad: number;
}

export interface PostureArchetype {
  readonly name: PostureName;
  /** Pelvis target translation offset from normalized rest position in meters [ΔX, ΔY, ΔZ]. */
  readonly pelvisTranslation: readonly [number, number, number];
  /** Pelvis target rotation in radians [pitch, yaw, roll] in Euler('YXZ'). */
  readonly pelvisRotationEuler: readonly [number, number, number];
  /** Additive pelvic counter-balance offset passed to BreathingController. */
  readonly pelvicCounter: PelvicCounterTarget;
  /** Left leg parameters (support or relaxed). */
  readonly leftLeg: LegPoseTarget;
  /** Right leg parameters (support or relaxed). */
  readonly rightLeg: LegPoseTarget;
  /** Base hold time range [minSeconds, maxSeconds] for this posture. */
  readonly holdRangeSeconds: readonly [number, number];
}

const DEG2RAD = Math.PI / 180;

/**
 * Validated standing posture archetypes calibrated specifically for companion.vrm
 * normalized humanoid skeleton and grounded sole geometry.
 */
export const POSTURE_ARCHETYPES: Record<PostureName, PostureArchetype> = {
  /**
   * Balanced symmetrical standing posture with soft knees (5.3 deg flexion above rest)
   * to guarantee safety from the arccos(-1) hyperextension singularity.
   */
  neutral_stand: {
    name: 'neutral_stand',
    pelvisTranslation: [0.0, -0.002, 0.0],
    pelvisRotationEuler: [0.0, 0.0, 0.0],
    pelvicCounter: {
      spineRollRad: 0.0,
      spinePitchRad: 0.0,
      spineYawRad: 0.0,
      chestRollRad: 0.0,
      chestPitchRad: 0.0,
      chestYawRad: 0.0,
    },
    leftLeg: { heelLiftRad: 0.0, kneeSwivelRad: 0.0 },
    rightLeg: { heelLiftRad: 0.0, kneeSwivelRad: 0.0 },
    holdRangeSeconds: [14.0, 24.0],
  },

  /**
   * Classical contrapposto stance with 80-85% weight bearing on the left leg.
   * Hips shift +3.8cm left and roll +4.5 deg (elevating left hip socket, dropping right).
   * Spine & chest counter-roll -3.0 deg total (leaving +1.5 deg net thoracic tilt: ~5mm shoulder delta).
   * Right unweighted leg relaxes with knee flexion, -4.5 deg inward drape, and ~13.4mm heel lift (7.0 deg).
   */
  weight_left: {
    name: 'weight_left',
    pelvisTranslation: [0.038, -0.012, 0.004],
    pelvisRotationEuler: [1.2 * DEG2RAD, -2.5 * DEG2RAD, 4.5 * DEG2RAD],
    pelvicCounter: {
      spineRollRad: -2.2 * DEG2RAD,
      spinePitchRad: -0.6 * DEG2RAD,
      spineYawRad: 1.5 * DEG2RAD,
      chestRollRad: -0.8 * DEG2RAD,
      chestPitchRad: 0.0,
      chestYawRad: 0.8 * DEG2RAD,
    },
    leftLeg: {
      heelLiftRad: 0.0,
      kneeSwivelRad: -1.5 * DEG2RAD,
    },
    rightLeg: {
      heelLiftRad: 7.0 * DEG2RAD,
      kneeSwivelRad: -4.5 * DEG2RAD,
    },
    holdRangeSeconds: [18.0, 30.0],
  },

  /**
   * Sagittal mirror of weight_left: weight bearing on the right leg.
   * Hips shift -3.8cm right and roll -4.5 deg (elevating right hip socket, dropping left).
   * Spine & chest counter-roll +3.0 deg total (leaving -1.5 deg net thoracic tilt: ~5mm shoulder delta).
   * Left unweighted leg relaxes with knee flexion, +4.5 deg inward drape, and ~13.4mm heel lift (7.0 deg).
   */
  weight_right: {
    name: 'weight_right',
    pelvisTranslation: [-0.038, -0.012, 0.004],
    pelvisRotationEuler: [1.2 * DEG2RAD, 2.5 * DEG2RAD, -4.5 * DEG2RAD],
    pelvicCounter: {
      spineRollRad: 2.2 * DEG2RAD,
      spinePitchRad: -0.6 * DEG2RAD,
      spineYawRad: -1.5 * DEG2RAD,
      chestRollRad: 0.8 * DEG2RAD,
      chestPitchRad: 0.0,
      chestYawRad: -0.8 * DEG2RAD,
    },
    leftLeg: {
      heelLiftRad: 7.0 * DEG2RAD,
      kneeSwivelRad: 4.5 * DEG2RAD,
    },
    rightLeg: {
      heelLiftRad: 0.0,
      kneeSwivelRad: 1.5 * DEG2RAD,
    },
    holdRangeSeconds: [18.0, 30.0],
  },

  /**
   * Casual grounded relaxed settle with distinct bilateral knee softening.
   * 16mm pelvic drop, subtle posterior hip shift, 2.5 deg lumbar pitch, and outward knee ease.
   */
  relaxed_settle: {
    name: 'relaxed_settle',
    pelvisTranslation: [0.004, -0.016, -0.008],
    pelvisRotationEuler: [2.5 * DEG2RAD, 0.0, 0.0],
    pelvicCounter: {
      spineRollRad: 0.0,
      spinePitchRad: -1.2 * DEG2RAD,
      spineYawRad: 0.0,
      chestRollRad: 0.0,
      chestPitchRad: 0.0,
      chestYawRad: 0.0,
    },
    leftLeg: { heelLiftRad: 0.0, kneeSwivelRad: -3.0 * DEG2RAD },
    rightLeg: { heelLiftRad: 0.0, kneeSwivelRad: 3.0 * DEG2RAD },
    holdRangeSeconds: [16.0, 26.0],
  },
};

/**
 * C2-continuous quintic smoother (zero velocity and zero acceleration at both endpoints).
 * S(t) = 6t^5 - 15t^4 + 10t^3.
 */
export function quinticEase(t: number): number {
  const clamped = THREE.MathUtils.clamp(t, 0.0, 1.0);
  return clamped * clamped * clamped * (clamped * (clamped * 6.0 - 15.0) + 10.0);
}

/**
 * Calculates transition duration based on whether we are moving to/from neutral
 * or performing a full lateral crossover between weight_left and weight_right.
 */
export function getTransitionDurationSeconds(
  fromPosture: PostureName,
  toPosture: PostureName,
): number {
  if (fromPosture === toPosture) {
    return 1.4;
  }
  const isCrossover =
    (fromPosture === 'weight_left' && toPosture === 'weight_right') ||
    (fromPosture === 'weight_right' && toPosture === 'weight_left');
  if (isCrossover) {
    return 2.2;
  }
  return 1.6;
}

