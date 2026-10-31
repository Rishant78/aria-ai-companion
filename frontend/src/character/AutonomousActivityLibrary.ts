import * as THREE from 'three';
import type { GestureHeadAccent } from './AttentionController';
import type { AutonomousTorsoOffset } from './BreathingController';
import type { EmotionName } from './ExpressionController';
import {
  CALIBRATED_LIMB_POSES,
  CANONICAL_FINGER_JOINT_NAMES,
  UPPER_LIMB_BONE_NAMES,
  eulerTupleToQuaternion,
  mirrorLeftQuaternionToRight,
} from './HandPoseLibrary';
import type {
  CanonicalFingerJointName,
  CanonicalHandShape,
  EulerYXZTuple,
  UpperLimbBoneName,
} from './HandPoseLibrary';
import type { AutonomousLowerBodyOffset } from './NaturalIdleController';
import type { PostureName } from './LowerBodyPoseLibrary';

const TAU = Math.PI * 2;

export const AUTONOMOUS_ACTIVITY_NAMES = [
  'relaxed_posture_settle',
  'weight_shift_browse',
  'shoulder_rolls',
  'calf_raise',
  'gentle_side_stretch',
  'overhead_stretch',
] as const;

export type AutonomousActivityName = (typeof AUTONOMOUS_ACTIVITY_NAMES)[number];

export type InactivityTier = 'short' | 'moderate' | 'longer';

export const INACTIVITY_TIER_THRESHOLDS = {
  short: 3,
  moderate: 11,
  longer: 25,
} as const;

export type AutonomousActivityPhase = 'idle' | 'anticipation' | 'execution' | 'recovery';

export interface AutonomousActivityDefinition {
  readonly name: AutonomousActivityName;
  readonly label: string;
  readonly tier: InactivityTier;
  /** Minimum user inactivity (seconds) before autonomous scheduler considers this activity. */
  readonly minInactivitySeconds: number;
  readonly anticipationSeconds: number;
  readonly executionSeconds: number;
  readonly recoverySeconds: number;
  /** Per-activity cooldown in seconds after completion or interruption. */
  readonly cooldownSeconds: number;
  /** Relative selection weight within eligible pool. */
  readonly selectionWeight: number;
  /** Optional ambient facial emotion accent (applied at low `'ambient'` priority). */
  readonly ambientEmotion?: {
    readonly emotion: EmotionName;
    readonly intensity: number;
  };
}

export const AUTONOMOUS_ACTIVITY_DEFINITIONS: Readonly<
  Record<AutonomousActivityName, AutonomousActivityDefinition>
> = {
  relaxed_posture_settle: {
    name: 'relaxed_posture_settle',
    label: 'Relax Settle',
    tier: 'short',
    minInactivitySeconds: INACTIVITY_TIER_THRESHOLDS.short,
    anticipationSeconds: 0.8,
    executionSeconds: 2.6,
    recoverySeconds: 1.2,
    cooldownSeconds: 22,
    selectionWeight: 1.25,
    ambientEmotion: { emotion: 'relaxed', intensity: 0.28 },
  },
  weight_shift_browse: {
    name: 'weight_shift_browse',
    label: 'Weight Shift',
    tier: 'short',
    minInactivitySeconds: INACTIVITY_TIER_THRESHOLDS.short,
    anticipationSeconds: 0.75,
    executionSeconds: 2.8,
    recoverySeconds: 1.2,
    cooldownSeconds: 24,
    selectionWeight: 1.2,
  },
  shoulder_rolls: {
    name: 'shoulder_rolls',
    label: 'Shoulder Roll',
    tier: 'moderate',
    minInactivitySeconds: INACTIVITY_TIER_THRESHOLDS.moderate,
    anticipationSeconds: 0.65,
    executionSeconds: 2.9,
    recoverySeconds: 1.05,
    cooldownSeconds: 34,
    selectionWeight: 1.0,
    ambientEmotion: { emotion: 'relaxed', intensity: 0.32 },
  },
  calf_raise: {
    name: 'calf_raise',
    label: 'Calf Raise',
    tier: 'moderate',
    minInactivitySeconds: INACTIVITY_TIER_THRESHOLDS.moderate,
    anticipationSeconds: 0.75,
    executionSeconds: 2.6,
    recoverySeconds: 1.15,
    cooldownSeconds: 36,
    selectionWeight: 1.0,
  },
  gentle_side_stretch: {
    name: 'gentle_side_stretch',
    label: 'Side Stretch',
    tier: 'longer',
    minInactivitySeconds: INACTIVITY_TIER_THRESHOLDS.longer,
    anticipationSeconds: 0.85,
    executionSeconds: 3.0,
    recoverySeconds: 1.35,
    cooldownSeconds: 50,
    selectionWeight: 0.9,
    ambientEmotion: { emotion: 'relaxed', intensity: 0.42 },
  },
  overhead_stretch: {
    name: 'overhead_stretch',
    label: 'Overhead Stretch',
    tier: 'longer',
    minInactivitySeconds: INACTIVITY_TIER_THRESHOLDS.longer,
    anticipationSeconds: 0.95,
    executionSeconds: 3.15,
    recoverySeconds: 1.45,
    cooldownSeconds: 58,
    selectionWeight: 0.85,
    ambientEmotion: { emotion: 'relaxed', intensity: 0.48 },
  },
};

const LEFT_FINGER_BONE_BY_CANONICAL: Readonly<Record<CanonicalFingerJointName, UpperLimbBoneName>> = {
  thumbMetacarpal: 'leftThumbMetacarpal',
  thumbProximal: 'leftThumbProximal',
  thumbDistal: 'leftThumbDistal',
  indexProximal: 'leftIndexProximal',
  indexIntermediate: 'leftIndexIntermediate',
  indexDistal: 'leftIndexDistal',
  middleProximal: 'leftMiddleProximal',
  middleIntermediate: 'leftMiddleIntermediate',
  middleDistal: 'leftMiddleDistal',
  ringProximal: 'leftRingProximal',
  ringIntermediate: 'leftRingIntermediate',
  ringDistal: 'leftRingDistal',
  littleProximal: 'leftLittleProximal',
  littleIntermediate: 'leftLittleIntermediate',
  littleDistal: 'leftLittleDistal',
};

const RIGHT_FINGER_BONE_BY_CANONICAL: Readonly<Record<CanonicalFingerJointName, UpperLimbBoneName>> = {
  thumbMetacarpal: 'rightThumbMetacarpal',
  thumbProximal: 'rightThumbProximal',
  thumbDistal: 'rightThumbDistal',
  indexProximal: 'rightIndexProximal',
  indexIntermediate: 'rightIndexIntermediate',
  indexDistal: 'rightIndexDistal',
  middleProximal: 'rightMiddleProximal',
  middleIntermediate: 'rightMiddleIntermediate',
  middleDistal: 'rightMiddleDistal',
  ringProximal: 'rightRingProximal',
  ringIntermediate: 'rightRingIntermediate',
  ringDistal: 'rightRingDistal',
  littleProximal: 'rightLittleProximal',
  littleIntermediate: 'rightLittleIntermediate',
  littleDistal: 'rightLittleDistal',
};

// Natural open-stretch finger fan (soft phalanx micro-curve — never rigid plank digits)
const OPEN_STRETCH_HAND_SHAPE: CanonicalHandShape = {
  thumbMetacarpal: [-0.04, 0.11, 0.05],
  thumbProximal: [0.02, -0.06, -0.09],
  thumbDistal: [0.01, -0.04, -0.07],
  indexProximal: [0.0, -0.07, -0.08],
  indexIntermediate: [0.0, 0.0, -0.11],
  indexDistal: [0.0, 0.0, -0.07],
  middleProximal: [0.0, -0.01, -0.10],
  middleIntermediate: [0.0, 0.0, -0.13],
  middleDistal: [0.0, 0.0, -0.08],
  ringProximal: [-0.01, 0.04, -0.14],
  ringIntermediate: [0.0, 0.0, -0.18],
  ringDistal: [0.0, 0.0, -0.11],
  littleProximal: [-0.02, 0.09, -0.19],
  littleIntermediate: [0.0, 0.0, -0.23],
  littleDistal: [0.0, 0.0, -0.15],
};

// Softly curled relaxed hands for preparatory/resting balance motions
const SOFT_REST_HAND_SHAPE: CanonicalHandShape = {
  thumbMetacarpal: [0.08, -0.14, -0.16],
  thumbProximal: [0.04, -0.12, -0.18],
  thumbDistal: [0.02, -0.08, -0.15],
  indexProximal: [0.0, -0.04, -0.20],
  indexIntermediate: [0.0, 0.0, -0.25],
  indexDistal: [0.0, 0.0, -0.16],
  middleProximal: [0.0, -0.01, -0.27],
  middleIntermediate: [0.0, 0.0, -0.33],
  middleDistal: [0.0, 0.0, -0.21],
  ringProximal: [-0.01, 0.03, -0.35],
  ringIntermediate: [0.0, 0.0, -0.41],
  ringDistal: [0.0, 0.0, -0.27],
  littleProximal: [-0.02, 0.06, -0.43],
  littleIntermediate: [0.0, 0.0, -0.48],
  littleDistal: [0.0, 0.0, -0.32],
};

interface ActivityArmPoseSpec {
  readonly leftUpperArm: EulerYXZTuple;
  readonly leftLowerArm: EulerYXZTuple;
  readonly leftHand: EulerYXZTuple;
  readonly leftFingers: CanonicalHandShape;
  readonly rightCanonicalUpperArm: EulerYXZTuple;
  readonly rightCanonicalLowerArm: EulerYXZTuple;
  readonly rightCanonicalHand: EulerYXZTuple;
  readonly rightCanonicalFingers: CanonicalHandShape;
}

function buildActivityLimbPoseMap(spec: ActivityArmPoseSpec): Map<UpperLimbBoneName, THREE.Quaternion> {
  const map = new Map<UpperLimbBoneName, THREE.Quaternion>();

  map.set('leftUpperArm', eulerTupleToQuaternion(spec.leftUpperArm));
  map.set('leftLowerArm', eulerTupleToQuaternion(spec.leftLowerArm));
  map.set('leftHand', eulerTupleToQuaternion(spec.leftHand));

  map.set('rightUpperArm', mirrorLeftQuaternionToRight(eulerTupleToQuaternion(spec.rightCanonicalUpperArm)));
  map.set('rightLowerArm', mirrorLeftQuaternionToRight(eulerTupleToQuaternion(spec.rightCanonicalLowerArm)));
  map.set('rightHand', mirrorLeftQuaternionToRight(eulerTupleToQuaternion(spec.rightCanonicalHand)));

  for (const joint of CANONICAL_FINGER_JOINT_NAMES) {
    map.set(LEFT_FINGER_BONE_BY_CANONICAL[joint], eulerTupleToQuaternion(spec.leftFingers[joint]));
    map.set(
      RIGHT_FINGER_BONE_BY_CANONICAL[joint],
      mirrorLeftQuaternionToRight(eulerTupleToQuaternion(spec.rightCanonicalFingers[joint])),
    );
  }

  return map;
}

/**
 * FK-verified immutable 36-bone limb pose tables calibrated on `companion.vrm`
 * (`head` clearance >= 0.41m, `chest` clearance >= +0.22m on front arcs, zero self-intersection).
 */
const ACTIVITY_LIMB_POSE_TABLES = {
  rest: buildActivityLimbPoseMap({
    leftUpperArm: CALIBRATED_LIMB_POSES.rest.left.upperArm,
    leftLowerArm: CALIBRATED_LIMB_POSES.rest.left.lowerArm,
    leftHand: CALIBRATED_LIMB_POSES.rest.left.hand,
    leftFingers: SOFT_REST_HAND_SHAPE,
    rightCanonicalUpperArm: CALIBRATED_LIMB_POSES.rest.rightCanonical.upperArm,
    rightCanonicalLowerArm: CALIBRATED_LIMB_POSES.rest.rightCanonical.lowerArm,
    rightCanonicalHand: CALIBRATED_LIMB_POSES.rest.rightCanonical.hand,
    rightCanonicalFingers: SOFT_REST_HAND_SHAPE,
  }),

  relaxedSettle: buildActivityLimbPoseMap({
    leftUpperArm: [0.06, -0.03, -1.19],
    leftLowerArm: [-0.10, -0.15, 0.0],
    leftHand: [-0.04, 0.03, -0.04],
    leftFingers: SOFT_REST_HAND_SHAPE,
    rightCanonicalUpperArm: [0.07, -0.04, -1.18],
    rightCanonicalLowerArm: [-0.11, -0.17, 0.0],
    rightCanonicalHand: [-0.05, 0.04, -0.04],
    rightCanonicalFingers: SOFT_REST_HAND_SHAPE,
  }),

  weightShiftLeft: buildActivityLimbPoseMap({
    leftUpperArm: [0.05, -0.08, -1.11],
    leftLowerArm: [-0.16, -0.27, 0.0],
    leftHand: [-0.08, 0.05, -0.04],
    leftFingers: SOFT_REST_HAND_SHAPE,
    rightCanonicalUpperArm: [0.07, -0.03, -1.19],
    rightCanonicalLowerArm: [-0.10, -0.16, 0.0],
    rightCanonicalHand: [-0.05, 0.04, -0.05],
    rightCanonicalFingers: SOFT_REST_HAND_SHAPE,
  }),

  weightShiftRight: buildActivityLimbPoseMap({
    leftUpperArm: [0.07, -0.03, -1.19],
    leftLowerArm: [-0.10, -0.16, 0.0],
    leftHand: [-0.05, 0.04, -0.05],
    leftFingers: SOFT_REST_HAND_SHAPE,
    rightCanonicalUpperArm: [0.05, -0.08, -1.11],
    rightCanonicalLowerArm: [-0.16, -0.27, 0.0],
    rightCanonicalHand: [-0.08, 0.05, -0.04],
    rightCanonicalFingers: SOFT_REST_HAND_SHAPE,
  }),

  shoulderRollDrape: buildActivityLimbPoseMap({
    leftUpperArm: [0.10, 0.08, -1.12],
    leftLowerArm: [-0.16, -0.26, 0.0],
    leftHand: [-0.08, 0.05, -0.06],
    leftFingers: SOFT_REST_HAND_SHAPE,
    rightCanonicalUpperArm: [0.10, 0.08, -1.11],
    rightCanonicalLowerArm: [-0.16, -0.28, 0.0],
    rightCanonicalHand: [-0.08, 0.05, -0.06],
    rightCanonicalFingers: SOFT_REST_HAND_SHAPE,
  }),

  calfBalance: buildActivityLimbPoseMap({
    leftUpperArm: [0.02, -0.08, -1.03],
    leftLowerArm: [-0.18, -0.28, 0.0],
    leftHand: [-0.10, 0.06, 0.08],
    leftFingers: OPEN_STRETCH_HAND_SHAPE,
    rightCanonicalUpperArm: [0.03, -0.09, -1.02],
    rightCanonicalLowerArm: [-0.18, -0.30, 0.0],
    rightCanonicalHand: [-0.10, 0.06, 0.08],
    rightCanonicalFingers: OPEN_STRETCH_HAND_SHAPE,
  }),

  overheadPrep: buildActivityLimbPoseMap({
    leftUpperArm: [-0.08, -0.34, -0.92],
    leftLowerArm: [-0.55, -1.35, 0.0],
    leftHand: [-0.28, -0.25, -0.10],
    leftFingers: SOFT_REST_HAND_SHAPE,
    rightCanonicalUpperArm: [-0.10, -0.36, -0.90],
    rightCanonicalLowerArm: [-0.58, -1.32, 0.0],
    rightCanonicalHand: [-0.28, -0.24, -0.10],
    rightCanonicalFingers: SOFT_REST_HAND_SHAPE,
  }),

  overheadWideMid: buildActivityLimbPoseMap({
    leftUpperArm: [-0.12, -0.26, -0.12],
    leftLowerArm: [0.05, -0.58, 0.0],
    leftHand: [0.02, 0.04, 0.10],
    leftFingers: OPEN_STRETCH_HAND_SHAPE,
    rightCanonicalUpperArm: [-0.12, -0.25, -0.14],
    rightCanonicalLowerArm: [0.05, -0.56, 0.0],
    rightCanonicalHand: [0.02, 0.04, 0.10],
    rightCanonicalFingers: OPEN_STRETCH_HAND_SHAPE,
  }),

  overheadPeak: buildActivityLimbPoseMap({
    leftUpperArm: [-0.18, -0.22, 0.54],
    leftLowerArm: [0.22, -0.44, 0.0],
    leftHand: [0.06, 0.05, 0.14],
    leftFingers: OPEN_STRETCH_HAND_SHAPE,
    rightCanonicalUpperArm: [-0.18, -0.20, 0.52],
    rightCanonicalLowerArm: [0.20, -0.42, 0.0],
    rightCanonicalHand: [0.06, 0.05, 0.14],
    rightCanonicalFingers: OPEN_STRETCH_HAND_SHAPE,
  }),

  sideStretchLeftPrep: buildActivityLimbPoseMap({
    leftUpperArm: [-0.08, -0.30, -0.28],
    leftLowerArm: [-0.08, -0.78, 0.0],
    leftHand: [-0.06, -0.05, 0.06],
    leftFingers: OPEN_STRETCH_HAND_SHAPE,
    rightCanonicalUpperArm: [0.06, -0.04, -1.20],
    rightCanonicalLowerArm: [-0.10, -0.18, 0.0],
    rightCanonicalHand: [-0.05, 0.04, -0.05],
    rightCanonicalFingers: SOFT_REST_HAND_SHAPE,
  }),

  sideStretchLeftPeak: buildActivityLimbPoseMap({
    leftUpperArm: [-0.10, -0.16, 0.72],
    leftLowerArm: [0.14, -0.62, 0.0],
    leftHand: [0.05, 0.04, 0.18],
    leftFingers: OPEN_STRETCH_HAND_SHAPE,
    rightCanonicalUpperArm: [0.06, -0.04, -1.20],
    rightCanonicalLowerArm: [-0.10, -0.18, 0.0],
    rightCanonicalHand: [-0.05, 0.04, -0.05],
    rightCanonicalFingers: SOFT_REST_HAND_SHAPE,
  }),

  sideStretchRightPrep: buildActivityLimbPoseMap({
    leftUpperArm: [0.06, -0.04, -1.20],
    leftLowerArm: [-0.10, -0.18, 0.0],
    leftHand: [-0.05, 0.04, -0.05],
    leftFingers: SOFT_REST_HAND_SHAPE,
    rightCanonicalUpperArm: [-0.08, -0.30, -0.28],
    rightCanonicalLowerArm: [-0.08, -0.78, 0.0],
    rightCanonicalHand: [-0.06, -0.05, 0.06],
    rightCanonicalFingers: OPEN_STRETCH_HAND_SHAPE,
  }),

  sideStretchRightPeak: buildActivityLimbPoseMap({
    leftUpperArm: [0.06, -0.04, -1.20],
    leftLowerArm: [-0.10, -0.18, 0.0],
    leftHand: [-0.05, 0.04, -0.05],
    leftFingers: SOFT_REST_HAND_SHAPE,
    rightCanonicalUpperArm: [-0.10, -0.16, 0.72],
    rightCanonicalLowerArm: [0.14, -0.62, 0.0],
    rightCanonicalHand: [0.05, 0.04, 0.18],
    rightCanonicalFingers: OPEN_STRETCH_HAND_SHAPE,
  }),
} as const;

export interface EvaluatedActivityFrame {
  readonly limbPose: ReadonlyMap<UpperLimbBoneName, THREE.Quaternion> | null;
  readonly limbWeight: number;
  readonly torsoOffset: AutonomousTorsoOffset;
  readonly lowerBodyOffset: AutonomousLowerBodyOffset;
  readonly headOffset: GestureHeadAccent;
  readonly requestedPosture: PostureName | null;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function smoothstep01(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

function smootherstep01(t: number): number {
  const u = clamp01(t);
  return u * u * u * (u * (u * 6 - 15) + 10);
}

/**
 * Stateful, zero-allocation biomechanical evaluator for autonomous full-body activities.
 * Reuses pre-allocated output structs and quaternion buffers every frame.
 */
export class AutonomousActivityEvaluator {
  private readonly blendedLimbMap = new Map<UpperLimbBoneName, THREE.Quaternion>();

  private readonly pelvisPos: [number, number, number] = [0, 0, 0];
  private readonly pelvisRot: [number, number, number] = [0, 0, 0];

  private readonly torsoOut: {
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

  private readonly lowerOut: {
    pelvisTranslation: [number, number, number];
    pelvisRotationEuler: [number, number, number];
    leftHeelLiftRad: number;
    rightHeelLiftRad: number;
    leftKneeSwivelRad: number;
    rightKneeSwivelRad: number;
    suppressPostureTimer: boolean;
  };

  private readonly headOut: {
    rollRad: number;
    pitchRad: number;
  } = {
    rollRad: 0,
    pitchRad: 0,
  };

  private readonly frameResult: {
    limbPose: ReadonlyMap<UpperLimbBoneName, THREE.Quaternion> | null;
    limbWeight: number;
    torsoOffset: AutonomousTorsoOffset;
    lowerBodyOffset: AutonomousLowerBodyOffset;
    headOffset: GestureHeadAccent;
    requestedPosture: PostureName | null;
  };

  constructor() {
    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const restQ = ACTIVITY_LIMB_POSE_TABLES.rest.get(boneName)!;
      this.blendedLimbMap.set(boneName, restQ.clone());
    }

    this.lowerOut = {
      pelvisTranslation: this.pelvisPos,
      pelvisRotationEuler: this.pelvisRot,
      leftHeelLiftRad: 0,
      rightHeelLiftRad: 0,
      leftKneeSwivelRad: 0,
      rightKneeSwivelRad: 0,
      suppressPostureTimer: true,
    };

    this.frameResult = {
      limbPose: null,
      limbWeight: 0,
      torsoOffset: this.torsoOut,
      lowerBodyOffset: this.lowerOut,
      headOffset: this.headOut,
      requestedPosture: null,
    };
  }

  private resetOutputs(): void {
    this.pelvisPos[0] = 0;
    this.pelvisPos[1] = 0;
    this.pelvisPos[2] = 0;
    this.pelvisRot[0] = 0;
    this.pelvisRot[1] = 0;
    this.pelvisRot[2] = 0;

    this.torsoOut.spinePitchRad = 0;
    this.torsoOut.spineYawRad = 0;
    this.torsoOut.spineRollRad = 0;
    this.torsoOut.chestPitchRad = 0;
    this.torsoOut.chestYawRad = 0;
    this.torsoOut.chestRollRad = 0;
    this.torsoOut.upperChestPitchRad = 0;
    this.torsoOut.leftShoulderLiftRad = 0;
    this.torsoOut.rightShoulderLiftRad = 0;
    this.torsoOut.leftShoulderProtractRad = 0;
    this.torsoOut.rightShoulderProtractRad = 0;
    this.torsoOut.breathDepthBoost = 0;

    this.lowerOut.leftHeelLiftRad = 0;
    this.lowerOut.rightHeelLiftRad = 0;
    this.lowerOut.leftKneeSwivelRad = 0;
    this.lowerOut.rightKneeSwivelRad = 0;
    this.lowerOut.suppressPostureTimer = true;

    this.headOut.rollRad = 0;
    this.headOut.pitchRad = 0;

    this.frameResult.limbPose = null;
    this.frameResult.limbWeight = 0;
    this.frameResult.requestedPosture = null;
  }

  private blendLimbTables(
    tableA: ReadonlyMap<UpperLimbBoneName, THREE.Quaternion>,
    tableB: ReadonlyMap<UpperLimbBoneName, THREE.Quaternion>,
    alpha: number,
  ): ReadonlyMap<UpperLimbBoneName, THREE.Quaternion> {
    const t = clamp01(alpha);
    for (const boneName of UPPER_LIMB_BONE_NAMES) {
      const qA = tableA.get(boneName)!;
      const qB = tableB.get(boneName)!;
      this.blendedLimbMap.get(boneName)!.copy(qA).slerp(qB, t).normalize();
    }
    return this.blendedLimbMap;
  }

  /**
   * Evaluates biomechanical multi-region pose targets for the given activity, phase,
   * normalized phase progress `u ∈ [0, 1]`, lateral side sign (`+1` left, `-1` right),
   * and envelope attenuation `envelopeScale ∈ [0, 1]` (used for graceful mid-phase interruption).
   */
  public evaluate(
    activity: AutonomousActivityName,
    phase: Exclude<AutonomousActivityPhase, 'idle'>,
    phaseProgress: number,
    sideSign: 1 | -1,
    envelopeScale = 1.0,
  ): EvaluatedActivityFrame {
    this.resetOutputs();
    const u = clamp01(phaseProgress);
    const scale = clamp01(envelopeScale);

    switch (activity) {
      case 'relaxed_posture_settle': {
        if (phase === 'anticipation') {
          const e = smootherstep01(u) * scale;
          // Clear inhalation and chest expansion before letting go
          this.torsoOut.chestPitchRad = -0.042 * e;
          this.torsoOut.upperChestPitchRad = -0.024 * e;
          this.torsoOut.leftShoulderLiftRad = 0.038 * e;
          this.torsoOut.rightShoulderLiftRad = 0.038 * e;
          this.torsoOut.breathDepthBoost = 0.48 * e;
          this.headOut.pitchRad = -0.022 * e;
          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.relaxedSettle;
          this.frameResult.limbWeight = 0.35 * e;
        } else if (phase === 'execution') {
          // Clear physical exhalation and settling into relaxed slouch
          const settleBell = smootherstep01(Math.min(1, u / 0.35)) * scale;
          this.pelvisPos[0] = 0.012 * sideSign * settleBell;
          this.pelvisPos[1] = -0.026 * settleBell; // -26mm pelvis drop
          this.pelvisPos[2] = 0.014 * settleBell; // +14mm back
          this.pelvisRot[0] = 0.028 * settleBell; // forward pelvic tilt
          this.pelvisRot[2] = 0.024 * sideSign * settleBell; // asymmetric hip lean
          this.lowerOut.rightHeelLiftRad = 0.040 * settleBell;

          this.torsoOut.spinePitchRad = 0.042 * settleBell;
          this.torsoOut.chestPitchRad = 0.032 * settleBell;
          this.torsoOut.upperChestPitchRad = 0.020 * settleBell;
          this.torsoOut.leftShoulderLiftRad = -0.068 * settleBell; // -68 mrad shoulder drop
          this.torsoOut.rightShoulderLiftRad = -0.068 * settleBell;
          this.torsoOut.leftShoulderProtractRad = 0.038 * settleBell; // gentle inward shoulder round
          this.torsoOut.rightShoulderProtractRad = 0.038 * settleBell;
          this.torsoOut.breathDepthBoost = 0.35 * (1 - 0.6 * u) * scale;

          this.headOut.pitchRad = 0.045 * settleBell; // comfortable head ease forward
          this.headOut.rollRad = 0.060 * sideSign * settleBell; // natural head tilt

          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.relaxedSettle;
          this.frameResult.limbWeight = 0.92 * settleBell;
        } else {
          const r = (1 - smootherstep01(u)) * scale;
          this.pelvisPos[0] = 0.012 * sideSign * r;
          this.pelvisPos[1] = -0.026 * r;
          this.pelvisPos[2] = 0.014 * r;
          this.pelvisRot[0] = 0.028 * r;
          this.pelvisRot[2] = 0.024 * sideSign * r;
          this.torsoOut.spinePitchRad = 0.042 * r;
          this.torsoOut.leftShoulderLiftRad = -0.068 * r;
          this.torsoOut.rightShoulderLiftRad = -0.068 * r;
          this.headOut.pitchRad = 0.045 * r;
          this.headOut.rollRad = 0.060 * sideSign * r;
          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.relaxedSettle;
          this.frameResult.limbWeight = 0.92 * r;
        }
        break;
      }

      case 'weight_shift_browse': {
        const limbTable =
          sideSign > 0
            ? ACTIVITY_LIMB_POSE_TABLES.weightShiftLeft
            : ACTIVITY_LIMB_POSE_TABLES.weightShiftRight;
        if (phase === 'anticipation') {
          const e = smootherstep01(u) * scale;
          this.pelvisPos[0] = 0.014 * sideSign * e;
          this.pelvisPos[1] = -0.006 * e;
          this.torsoOut.spineRollRad = -0.018 * sideSign * e;
          this.headOut.rollRad = 0.046 * sideSign * e;
          this.frameResult.limbPose = limbTable;
          this.frameResult.limbWeight = 0.40 * e;
        } else if (phase === 'execution') {
          // Visibly settle weight onto support leg with clear contrapposto
          const shiftCurve =
            u < 0.35
              ? smootherstep01(u / 0.35)
              : u < 0.72
                ? 1.0
                : 1.0 - 0.25 * smootherstep01((u - 0.72) / 0.28);
          const env = shiftCurve * scale;
          const browseSway = Math.sin(Math.PI * u) * scale;

          // Direct pronounced lateral hip displacement (±42mm)
          this.pelvisPos[0] = 0.042 * sideSign * env;
          this.pelvisPos[1] = -0.012 * env; // natural slight dip on support leg
          this.pelvisRot[2] = 0.052 * sideSign * env; // +3.0 deg hip hike on support side

          // Unweighted trailing foot heel relaxes with slight lift
          if (sideSign > 0) {
            this.lowerOut.rightHeelLiftRad = 0.095 * env;
          } else {
            this.lowerOut.leftHeelLiftRad = 0.095 * env;
          }

          // Corresponding torso and shoulder counterbalance (contrapposto)
          this.torsoOut.spineRollRad = -0.048 * sideSign * env;
          this.torsoOut.chestRollRad = -0.034 * sideSign * env;
          this.torsoOut.spineYawRad = 0.032 * sideSign * browseSway;
          this.torsoOut.chestYawRad = 0.022 * sideSign * browseSway;
          this.torsoOut.leftShoulderLiftRad = -0.028 * sideSign * env;
          this.torsoOut.rightShoulderLiftRad = 0.028 * sideSign * env;

          this.headOut.rollRad = 0.080 * sideSign * env;
          this.headOut.pitchRad = -0.018 * browseSway;

          this.frameResult.limbPose = limbTable;
          this.frameResult.limbWeight = 0.88 * env;
        } else {
          const r = (1 - smootherstep01(u)) * scale;
          this.pelvisPos[0] = 0.042 * sideSign * r;
          this.pelvisPos[1] = -0.012 * r;
          this.pelvisRot[2] = 0.052 * sideSign * r;
          this.torsoOut.spineRollRad = -0.048 * sideSign * r;
          this.torsoOut.chestRollRad = -0.034 * sideSign * r;
          this.headOut.rollRad = 0.080 * sideSign * r;
          this.frameResult.limbPose = limbTable;
          this.frameResult.limbWeight = 0.88 * r;
        }
        break;
      }

      case 'shoulder_rolls': {
        if (phase === 'anticipation') {
          const e = smootherstep01(u) * scale;
          this.torsoOut.spinePitchRad = 0.014 * e;
          this.torsoOut.leftShoulderProtractRad = 0.065 * e;
          this.torsoOut.rightShoulderProtractRad = 0.065 * e;
          this.torsoOut.leftShoulderLiftRad = 0.032 * e;
          this.torsoOut.rightShoulderLiftRad = 0.032 * e;
          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.shoulderRollDrape;
          this.frameResult.limbWeight = 0.45 * e;
        } else if (phase === 'execution') {
          // Two smooth backward circular clavicle rolls (forward -> up -> back -> down)
          const bell = Math.sin(Math.PI * clamp01(u > 0.12 && u < 0.88 ? 0.5 : u < 0.5 ? u / 0.24 : (1 - u) / 0.24));
          const env = (0.35 + 0.65 * bell) * scale;
          const theta = TAU * 2.0 * u;
          const thetaR = theta - 0.16; // subtle organic left/right phase lead so rolls aren't robotic
          const liftL = (0.055 + 0.085 * Math.sin(theta)) * env;
          const liftR = (0.055 + 0.085 * Math.sin(thetaR)) * env;
          const protractL = 0.095 * Math.cos(theta) * env;
          const protractR = 0.095 * Math.cos(thetaR) * env;

          this.torsoOut.leftShoulderLiftRad = liftL;
          this.torsoOut.rightShoulderLiftRad = liftR;
          this.torsoOut.leftShoulderProtractRad = protractL;
          this.torsoOut.rightShoulderProtractRad = protractR;
          this.torsoOut.chestPitchRad = -0.028 * Math.max(0, -Math.cos(theta)) * env;
          this.torsoOut.spinePitchRad = -0.014 * Math.sin(Math.PI * u) * scale;
          this.torsoOut.breathDepthBoost = 0.25 * Math.sin(Math.PI * u) * scale;
          this.headOut.pitchRad = -0.022 * Math.sin(Math.PI * u) * scale;
          this.headOut.rollRad = 0.040 * Math.sin(TAU * u) * scale;

          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.shoulderRollDrape;
          this.frameResult.limbWeight = 0.78 * Math.sin(Math.PI * u) * scale + 0.15 * scale;
        } else {
          const r = (1 - smootherstep01(u)) * scale;
          this.torsoOut.leftShoulderLiftRad = -0.016 * Math.sin(Math.PI * u) * scale;
          this.torsoOut.rightShoulderLiftRad = -0.016 * Math.sin(Math.PI * u) * scale;
          this.headOut.pitchRad = -0.012 * r;
          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.shoulderRollDrape;
          this.frameResult.limbWeight = 0.35 * r;
        }
        break;
      }

      case 'calf_raise': {
        if (phase === 'anticipation') {
          // Preparatory smooth forward balance adjustment onto metatarsals
          const e = smootherstep01(u) * scale;
          this.pelvisPos[1] = 0.005 * e;
          this.pelvisPos[2] = 0.012 * e;
          this.torsoOut.chestPitchRad = -0.016 * e;
          this.torsoOut.breathDepthBoost = 0.22 * e;
          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.calfBalance;
          this.frameResult.limbWeight = 0.40 * e;
        } else if (phase === 'execution') {
          // Smooth rise onto toes (0..0.40), stable poised hold (0.40..0.68), controlled descent (0.68..1.0)
          const riseCurve =
            u < 0.40
              ? smootherstep01(u / 0.40)
              : u < 0.68
                ? 1.0
                : 1.0 - smootherstep01((u - 0.68) / 0.32);
          const env = riseCurve * scale;

          // Prominent vertical rise (+52mm) with forward mass balance (+24mm) over metatarsals
          this.pelvisPos[1] = 0.052 * env;
          this.pelvisPos[2] = 0.024 * env;

          // Noticeable ankle plantarflexion (0.48 rad = 27.5 deg; heels visibly elevate ~55mm)
          this.lowerOut.leftHeelLiftRad = 0.480 * env;
          this.lowerOut.rightHeelLiftRad = 0.480 * env;

          // Stable extended knees, tall lengthened posture, chest lift and shoulder stabilization
          this.torsoOut.spinePitchRad = -0.024 * env;
          this.torsoOut.chestPitchRad = -0.038 * env;
          this.torsoOut.leftShoulderLiftRad = 0.034 * env;
          this.torsoOut.rightShoulderLiftRad = 0.034 * env;
          this.torsoOut.breathDepthBoost = 0.38 * env;
          this.headOut.pitchRad = -0.032 * env;

          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.calfBalance;
          this.frameResult.limbWeight = (0.35 + 0.60 * riseCurve) * scale;
        } else {
          // Gentle, controlled return to grounded flat-foot rest without bouncing
          const r = (1 - smootherstep01(u)) * scale;
          this.pelvisPos[1] = 0.012 * r;
          this.pelvisPos[2] = 0.006 * r;
          this.torsoOut.spinePitchRad = -0.008 * r;
          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.calfBalance;
          this.frameResult.limbWeight = 0.35 * r;
        }
        break;
      }

      case 'gentle_side_stretch': {
        const prepTable =
          sideSign > 0
            ? ACTIVITY_LIMB_POSE_TABLES.sideStretchLeftPrep
            : ACTIVITY_LIMB_POSE_TABLES.sideStretchRightPrep;
        const peakTable =
          sideSign > 0
            ? ACTIVITY_LIMB_POSE_TABLES.sideStretchLeftPeak
            : ACTIVITY_LIMB_POSE_TABLES.sideStretchRightPeak;

        if (phase === 'anticipation') {
          const e = smootherstep01(u) * scale;
          this.pelvisPos[0] = 0.012 * sideSign * e;
          this.pelvisPos[1] = -0.004 * e;
          this.torsoOut.spineRollRad = 0.024 * sideSign * e;
          this.torsoOut.chestPitchRad = -0.015 * e;
          this.torsoOut.breathDepthBoost = 0.28 * e;
          if (sideSign > 0) {
            this.torsoOut.leftShoulderLiftRad = 0.045 * e;
          } else {
            this.torsoOut.rightShoulderLiftRad = 0.045 * e;
          }
          this.frameResult.limbPose = prepTable;
          this.frameResult.limbWeight = 0.85 * e;
        } else if (phase === 'execution') {
          const reach =
            u < 0.32
              ? smootherstep01(u / 0.32)
              : u < 0.76
                ? 1.0 + 0.04 * Math.sin(TAU * (u - 0.32))
                : 1.0 - 0.25 * smootherstep01((u - 0.76) / 0.24);
          const env = clamp01(reach) * scale;

          // C-curve lateral arc: hips anchor toward stretching side (+X for left stretch),
          // ribcage & arm curve smoothly toward opposite side (+rz bends toward -X right).
          this.pelvisPos[0] = 0.024 * sideSign * env;
          this.pelvisPos[1] = -0.006 * env;
          this.pelvisRot[2] = 0.036 * sideSign * env;
          if (sideSign > 0) {
            this.lowerOut.rightHeelLiftRad = 0.055 * env;
          } else {
            this.lowerOut.leftHeelLiftRad = 0.055 * env;
          }

          this.torsoOut.spineRollRad = 0.082 * sideSign * env;
          this.torsoOut.chestRollRad = 0.066 * sideSign * env;
          this.torsoOut.spinePitchRad = -0.015 * env;
          this.torsoOut.chestPitchRad = -0.018 * env;
          this.torsoOut.spineYawRad = -0.020 * sideSign * env;
          this.torsoOut.breathDepthBoost = 0.38 * env;

          if (sideSign > 0) {
            this.torsoOut.leftShoulderLiftRad = 0.105 * env;
            this.torsoOut.rightShoulderLiftRad = -0.020 * env;
          } else {
            this.torsoOut.rightShoulderLiftRad = 0.105 * env;
            this.torsoOut.leftShoulderLiftRad = -0.020 * env;
          }

          this.headOut.rollRad = -0.086 * sideSign * env;
          this.headOut.pitchRad = -0.020 * env;

          this.frameResult.limbPose = this.blendLimbTables(
            prepTable,
            peakTable,
            smootherstep01(Math.min(1, u / 0.34)),
          );
          this.frameResult.limbWeight = (0.85 + 0.15 * smoothstep01(u / 0.25)) * scale;
        } else {
          // Graceful lowering back through the lateral mid-arc to relaxed side
          const r = (1 - smootherstep01(u)) * scale;
          this.pelvisPos[0] = 0.018 * sideSign * r;
          this.pelvisPos[1] = -0.004 * r;
          this.pelvisRot[2] = 0.026 * sideSign * r;
          this.torsoOut.spineRollRad = 0.062 * sideSign * r;
          this.torsoOut.chestRollRad = 0.048 * sideSign * r;
          if (sideSign > 0) {
            this.torsoOut.leftShoulderLiftRad = 0.075 * r;
          } else {
            this.torsoOut.rightShoulderLiftRad = 0.075 * r;
          }
          this.headOut.rollRad = -0.062 * sideSign * r;

          this.frameResult.limbPose = this.blendLimbTables(
            peakTable,
            prepTable,
            smootherstep01(Math.min(1, u * 1.15)),
          );
          this.frameResult.limbWeight = r;
        }
        break;
      }

      case 'overhead_stretch': {
        if (phase === 'anticipation') {
          // Gather hands softly in front of chest with slight preparatory coil before reaching up
          const e = smootherstep01(u) * scale;
          this.pelvisPos[1] = -0.006 * e;
          this.torsoOut.spinePitchRad = 0.022 * e;
          this.torsoOut.chestPitchRad = 0.016 * e;
          this.torsoOut.leftShoulderProtractRad = 0.048 * e;
          this.torsoOut.rightShoulderProtractRad = 0.048 * e;
          this.torsoOut.breathDepthBoost = 0.30 * e;
          this.headOut.pitchRad = 0.016 * e;

          this.frameResult.limbPose = ACTIVITY_LIMB_POSE_TABLES.overheadPrep;
          this.frameResult.limbWeight = 0.90 * e;
        } else if (phase === 'execution') {
          // Sweeping bilateral V-arc overhead reach + ribcage expansion + gentle tiptoe lift
          const reach =
            u < 0.36
              ? smootherstep01(u / 0.36)
              : u < 0.78
                ? 1.0
                : 1.0 - 0.18 * smootherstep01((u - 0.78) / 0.22);
          const env = clamp01(reach) * scale;

          this.pelvisPos[1] = 0.008 * env;
          this.pelvisPos[2] = 0.006 * env;
          this.lowerOut.leftHeelLiftRad = 0.062 * env;
          this.lowerOut.rightHeelLiftRad = 0.062 * env;

          this.torsoOut.spinePitchRad = -0.042 * env;
          this.torsoOut.chestPitchRad = -0.052 * env;
          this.torsoOut.upperChestPitchRad = -0.026 * env;
          this.torsoOut.leftShoulderLiftRad = 0.112 * env;
          this.torsoOut.rightShoulderLiftRad = 0.112 * env;
          this.torsoOut.leftShoulderProtractRad = -0.042 * env;
          this.torsoOut.rightShoulderProtractRad = -0.042 * env;
          this.torsoOut.breathDepthBoost = 0.45 * env;

          this.headOut.pitchRad = -0.052 * env;
          this.headOut.rollRad = 0.038 * sideSign * Math.sin(Math.PI * u) * scale;

          this.frameResult.limbPose = this.blendLimbTables(
            ACTIVITY_LIMB_POSE_TABLES.overheadPrep,
            ACTIVITY_LIMB_POSE_TABLES.overheadPeak,
            smootherstep01(Math.min(1, u / 0.36)),
          );
          this.frameResult.limbWeight = (0.90 + 0.10 * smoothstep01(u / 0.2)) * scale;
        } else {
          // Satisfying exhale: lower arms outward through wide lateral mid-arc back to relaxed sides
          const r = (1 - smootherstep01(u)) * scale;
          const exhale = Math.sin(Math.PI * u) * scale;
          this.pelvisPos[1] = -0.005 * exhale;
          this.torsoOut.spinePitchRad = -0.032 * r + 0.012 * exhale;
          this.torsoOut.chestPitchRad = -0.038 * r;
          this.torsoOut.upperChestPitchRad = -0.018 * r;
          this.torsoOut.leftShoulderLiftRad = 0.085 * r - 0.018 * exhale;
          this.torsoOut.rightShoulderLiftRad = 0.085 * r - 0.018 * exhale;
          this.headOut.pitchRad = -0.036 * r + 0.014 * exhale;

          this.frameResult.limbPose = this.blendLimbTables(
            ACTIVITY_LIMB_POSE_TABLES.overheadPeak,
            ACTIVITY_LIMB_POSE_TABLES.overheadWideMid,
            smootherstep01(Math.min(1, u * 1.15)),
          );
          this.frameResult.limbWeight = r;
        }
        break;
      }
    }

    return this.frameResult;
  }
}

