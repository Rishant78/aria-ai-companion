import * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';

/** Euler tuple `[rx, ry, rz]` in radians evaluated with `'YXZ'` intrinsic order. */
export type EulerYXZTuple = readonly [number, number, number];

export const ARM_BONE_NAMES = [
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
] as const satisfies readonly VRMHumanBoneName[];

export const LEFT_FINGER_BONE_NAMES = [
  'leftThumbMetacarpal',
  'leftThumbProximal',
  'leftThumbDistal',
  'leftIndexProximal',
  'leftIndexIntermediate',
  'leftIndexDistal',
  'leftMiddleProximal',
  'leftMiddleIntermediate',
  'leftMiddleDistal',
  'leftRingProximal',
  'leftRingIntermediate',
  'leftRingDistal',
  'leftLittleProximal',
  'leftLittleIntermediate',
  'leftLittleDistal',
] as const satisfies readonly VRMHumanBoneName[];

export const RIGHT_FINGER_BONE_NAMES = [
  'rightThumbMetacarpal',
  'rightThumbProximal',
  'rightThumbDistal',
  'rightIndexProximal',
  'rightIndexIntermediate',
  'rightIndexDistal',
  'rightMiddleProximal',
  'rightMiddleIntermediate',
  'rightMiddleDistal',
  'rightRingProximal',
  'rightRingIntermediate',
  'rightRingDistal',
  'rightLittleProximal',
  'rightLittleIntermediate',
  'rightLittleDistal',
] as const satisfies readonly VRMHumanBoneName[];

/**
 * Complete set of 36 upper-limb humanoid bones (6 arm/forearm/wrist + 30 finger bones)
 * owned exclusively by `GestureController`.
 */
export const UPPER_LIMB_BONE_NAMES = [
  ...ARM_BONE_NAMES,
  ...LEFT_FINGER_BONE_NAMES,
  ...RIGHT_FINGER_BONE_NAMES,
] as const satisfies readonly VRMHumanBoneName[];

export type UpperLimbBoneName = (typeof UPPER_LIMB_BONE_NAMES)[number];

export type CanonicalFingerJointName =
  | 'thumbMetacarpal'
  | 'thumbProximal'
  | 'thumbDistal'
  | 'indexProximal'
  | 'indexIntermediate'
  | 'indexDistal'
  | 'middleProximal'
  | 'middleIntermediate'
  | 'middleDistal'
  | 'ringProximal'
  | 'ringIntermediate'
  | 'ringDistal'
  | 'littleProximal'
  | 'littleIntermediate'
  | 'littleDistal';

export const CANONICAL_FINGER_JOINT_NAMES: readonly CanonicalFingerJointName[] = [
  'thumbMetacarpal',
  'thumbProximal',
  'thumbDistal',
  'indexProximal',
  'indexIntermediate',
  'indexDistal',
  'middleProximal',
  'middleIntermediate',
  'middleDistal',
  'ringProximal',
  'ringIntermediate',
  'ringDistal',
  'littleProximal',
  'littleIntermediate',
  'littleDistal',
];

const LEFT_FINGER_MAP: Readonly<Record<CanonicalFingerJointName, UpperLimbBoneName>> = {
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

const RIGHT_FINGER_MAP: Readonly<Record<CanonicalFingerJointName, UpperLimbBoneName>> = {
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

export type HandShapePresetName =
  | 'relaxed'
  | 'relaxed_alt'
  | 'open_wave'
  | 'open_greeting'
  | 'open_explaining'
  | 'thinking_chin'
  | 'open_shrug'
  | 'cupped_laugh'
  | 'shy_clasped'
  | 'warm_heart'
  | 'gentle_palm';

/**
 * Canonical left-hand 15-joint finger pose definition.
 * Every finger and phalanx uses distinct, non-uniform anatomical curl (`-Z`),
 * splay (`±Y`), and opposition (`X/Y/Z` on thumb) angles.
 */
export type CanonicalHandShape = Readonly<Record<CanonicalFingerJointName, EulerYXZTuple>>;

export const HAND_SHAPE_LIBRARY: Readonly<Record<HandShapePresetName, CanonicalHandShape>> = {
  // Natural progressive cascade at standing rest (index least curled -> pinky most curled)
  relaxed: {
    thumbMetacarpal: [0.08, -0.14, -0.16],
    thumbProximal: [0.04, -0.12, -0.18],
    thumbDistal: [0.02, -0.08, -0.15],
    indexProximal: [0.0, -0.04, -0.22],
    indexIntermediate: [0.0, 0.0, -0.27],
    indexDistal: [0.0, 0.0, -0.18],
    middleProximal: [0.0, -0.01, -0.30],
    middleIntermediate: [0.0, 0.0, -0.36],
    middleDistal: [0.0, 0.0, -0.24],
    ringProximal: [-0.01, 0.03, -0.38],
    ringIntermediate: [0.0, 0.0, -0.44],
    ringDistal: [0.0, 0.0, -0.30],
    littleProximal: [-0.02, 0.06, -0.46],
    littleIntermediate: [0.0, 0.0, -0.51],
    littleDistal: [0.0, 0.0, -0.35],
  },

  // Subtle organic right-hand resting variation (non-identical left/right cascade)
  relaxed_alt: {
    thumbMetacarpal: [0.09, -0.15, -0.17],
    thumbProximal: [0.04, -0.13, -0.19],
    thumbDistal: [0.02, -0.09, -0.16],
    indexProximal: [0.0, -0.03, -0.24],
    indexIntermediate: [0.0, 0.0, -0.29],
    indexDistal: [0.0, 0.0, -0.19],
    middleProximal: [0.0, -0.01, -0.32],
    middleIntermediate: [0.0, 0.0, -0.38],
    middleDistal: [0.0, 0.0, -0.25],
    ringProximal: [-0.01, 0.03, -0.40],
    ringIntermediate: [0.0, 0.0, -0.46],
    ringDistal: [0.0, 0.0, -0.31],
    littleProximal: [-0.02, 0.07, -0.48],
    littleIntermediate: [0.0, 0.0, -0.53],
    littleDistal: [0.0, 0.0, -0.36],
  },

  // Friendly open wave: gently fanned digits with soft non-plank phalanx micro-curve
  open_wave: {
    thumbMetacarpal: [-0.06, 0.14, 0.08],
    thumbProximal: [0.02, -0.05, -0.08],
    thumbDistal: [0.0, -0.04, -0.06],
    indexProximal: [0.0, -0.09, -0.06],
    indexIntermediate: [0.0, 0.0, -0.08],
    indexDistal: [0.0, 0.0, -0.05],
    middleProximal: [0.0, -0.02, -0.05],
    middleIntermediate: [0.0, 0.0, -0.07],
    middleDistal: [0.0, 0.0, -0.05],
    ringProximal: [0.0, 0.05, -0.08],
    ringIntermediate: [0.0, 0.0, -0.10],
    ringDistal: [0.0, 0.0, -0.07],
    littleProximal: [-0.01, 0.12, -0.11],
    littleIntermediate: [0.0, 0.0, -0.13],
    littleDistal: [0.0, 0.0, -0.09],
  },

  // Warm welcoming palm: relaxed open fan with progressive outer-finger softness
  open_greeting: {
    thumbMetacarpal: [-0.04, 0.10, 0.04],
    thumbProximal: [0.03, -0.08, -0.10],
    thumbDistal: [0.01, -0.05, -0.08],
    indexProximal: [0.0, -0.07, -0.10],
    indexIntermediate: [0.0, 0.0, -0.14],
    indexDistal: [0.0, 0.0, -0.09],
    middleProximal: [0.0, -0.01, -0.14],
    middleIntermediate: [0.0, 0.0, -0.18],
    middleDistal: [0.0, 0.0, -0.12],
    ringProximal: [-0.01, 0.04, -0.20],
    ringIntermediate: [0.0, 0.0, -0.24],
    ringDistal: [0.0, 0.0, -0.16],
    littleProximal: [-0.02, 0.09, -0.26],
    littleIntermediate: [0.0, 0.0, -0.30],
    littleDistal: [0.0, 0.0, -0.20],
  },

  // Conversational explaining hand: expressive index-led soft open curve
  open_explaining: {
    thumbMetacarpal: [0.02, 0.06, -0.04],
    thumbProximal: [0.04, -0.10, -0.12],
    thumbDistal: [0.02, -0.06, -0.10],
    indexProximal: [0.01, -0.06, -0.14],
    indexIntermediate: [0.0, 0.0, -0.18],
    indexDistal: [0.0, 0.0, -0.12],
    middleProximal: [0.0, -0.01, -0.22],
    middleIntermediate: [0.0, 0.0, -0.26],
    middleDistal: [0.0, 0.0, -0.17],
    ringProximal: [-0.01, 0.03, -0.31],
    ringIntermediate: [0.0, 0.0, -0.36],
    ringDistal: [0.0, 0.0, -0.23],
    littleProximal: [-0.02, 0.08, -0.39],
    littleIntermediate: [0.0, 0.0, -0.44],
    littleDistal: [0.0, 0.0, -0.29],
  },

  // Contemplative chin pose: index gently extended, middle/ring/little tucked progressively
  thinking_chin: {
    thumbMetacarpal: [0.14, -0.22, -0.24],
    thumbProximal: [0.06, -0.18, -0.26],
    thumbDistal: [0.02, -0.10, -0.20],
    indexProximal: [0.02, -0.04, -0.16],
    indexIntermediate: [0.0, 0.0, -0.22],
    indexDistal: [0.0, 0.0, -0.14],
    middleProximal: [0.0, 0.01, -0.82],
    middleIntermediate: [0.0, 0.0, -0.96],
    middleDistal: [0.0, 0.0, -0.62],
    ringProximal: [-0.01, 0.03, -0.94],
    ringIntermediate: [0.0, 0.0, -1.06],
    ringDistal: [0.0, 0.0, -0.70],
    littleProximal: [-0.02, 0.05, -1.04],
    littleIntermediate: [0.0, 0.0, -1.14],
    littleDistal: [0.0, 0.0, -0.76],
  },

  // Expressive palms-up shrug: open relaxed spread
  open_shrug: {
    thumbMetacarpal: [-0.05, 0.12, 0.05],
    thumbProximal: [0.02, -0.06, -0.09],
    thumbDistal: [0.0, -0.05, -0.07],
    indexProximal: [0.0, -0.08, -0.12],
    indexIntermediate: [0.0, 0.0, -0.15],
    indexDistal: [0.0, 0.0, -0.10],
    middleProximal: [0.0, -0.01, -0.16],
    middleIntermediate: [0.0, 0.0, -0.20],
    middleDistal: [0.0, 0.0, -0.13],
    ringProximal: [-0.01, 0.04, -0.22],
    ringIntermediate: [0.0, 0.0, -0.27],
    ringDistal: [0.0, 0.0, -0.18],
    littleProximal: [-0.02, 0.10, -0.28],
    littleIntermediate: [0.0, 0.0, -0.34],
    littleDistal: [0.0, 0.0, -0.22],
  },

  // Polite cupped laugh hand: fingers lightly gathered and curved together
  cupped_laugh: {
    thumbMetacarpal: [0.12, -0.20, -0.22],
    thumbProximal: [0.05, -0.16, -0.24],
    thumbDistal: [0.02, -0.10, -0.18],
    indexProximal: [0.01, 0.03, -0.36],
    indexIntermediate: [0.0, 0.0, -0.44],
    indexDistal: [0.0, 0.0, -0.28],
    middleProximal: [0.0, 0.01, -0.40],
    middleIntermediate: [0.0, 0.0, -0.48],
    middleDistal: [0.0, 0.0, -0.31],
    ringProximal: [-0.01, -0.02, -0.45],
    ringIntermediate: [0.0, 0.0, -0.52],
    ringDistal: [0.0, 0.0, -0.34],
    littleProximal: [-0.02, -0.04, -0.50],
    littleIntermediate: [0.0, 0.0, -0.56],
    littleDistal: [0.0, 0.0, -0.38],
  },

  // Bashful hands-together pose: soft inward curve so opposite fingertips never intersect
  shy_clasped: {
    thumbMetacarpal: [0.14, -0.22, -0.24],
    thumbProximal: [0.05, -0.18, -0.28],
    thumbDistal: [0.02, -0.12, -0.22],
    indexProximal: [0.01, 0.02, -0.46],
    indexIntermediate: [0.0, 0.0, -0.56],
    indexDistal: [0.0, 0.0, -0.36],
    middleProximal: [0.0, 0.0, -0.52],
    middleIntermediate: [0.0, 0.0, -0.62],
    middleDistal: [0.0, 0.0, -0.40],
    ringProximal: [-0.01, -0.02, -0.58],
    ringIntermediate: [0.0, 0.0, -0.66],
    ringDistal: [0.0, 0.0, -0.44],
    littleProximal: [-0.02, -0.04, -0.64],
    littleIntermediate: [0.0, 0.0, -0.70],
    littleDistal: [0.0, 0.0, -0.48],
  },

  // Warm empathetic hand near heart
  warm_heart: {
    thumbMetacarpal: [0.08, -0.12, -0.14],
    thumbProximal: [0.04, -0.10, -0.16],
    thumbDistal: [0.02, -0.08, -0.14],
    indexProximal: [0.0, 0.01, -0.22],
    indexIntermediate: [0.0, 0.0, -0.26],
    indexDistal: [0.0, 0.0, -0.18],
    middleProximal: [0.0, 0.0, -0.26],
    middleIntermediate: [0.0, 0.0, -0.31],
    middleDistal: [0.0, 0.0, -0.21],
    ringProximal: [-0.01, -0.01, -0.31],
    ringIntermediate: [0.0, 0.0, -0.36],
    ringDistal: [0.0, 0.0, -0.24],
    littleProximal: [-0.02, -0.03, -0.36],
    littleIntermediate: [0.0, 0.0, -0.42],
    littleDistal: [0.0, 0.0, -0.28],
  },

  // Soft calming secondary palm
  gentle_palm: {
    thumbMetacarpal: [0.02, 0.05, -0.05],
    thumbProximal: [0.03, -0.08, -0.12],
    thumbDistal: [0.01, -0.06, -0.10],
    indexProximal: [0.0, -0.05, -0.16],
    indexIntermediate: [0.0, 0.0, -0.20],
    indexDistal: [0.0, 0.0, -0.14],
    middleProximal: [0.0, -0.01, -0.21],
    middleIntermediate: [0.0, 0.0, -0.26],
    middleDistal: [0.0, 0.0, -0.17],
    ringProximal: [-0.01, 0.02, -0.27],
    ringIntermediate: [0.0, 0.0, -0.33],
    ringDistal: [0.0, 0.0, -0.21],
    littleProximal: [-0.02, 0.06, -0.33],
    littleIntermediate: [0.0, 0.0, -0.39],
    littleDistal: [0.0, 0.0, -0.25],
  },
};

/**
 * Canonical 3-segment arm chain (`upperArm`, `lowerArm`, `hand`) authored in VRM 1.0
 * normalized left-side coordinates with forearm pronation/supination distributed
 * across `lowerArm` (72%) and `hand` (28%) so wrist twist never pinches skinning.
 */
export interface CanonicalArmChain {
  readonly upperArm: EulerYXZTuple;
  readonly lowerArm: EulerYXZTuple;
  readonly hand: EulerYXZTuple;
  readonly handShape: HandShapePresetName;
}

export interface BilateralLimbPoseSpec {
  readonly left: CanonicalArmChain;
  /** Authored in canonical left-side coordinates and reflected across X=0 via `mirrorLeftQuaternionToRight`. */
  readonly rightCanonical: CanonicalArmChain;
}

/**
 * Forward-kinematics-verified limb poses calibrated directly against `companion.vrm`
 * to clear torso/bust (`Z > 0.156m`), chin (`Y = 1.317m, Z = 0.081m`), and opposite-hand geometry.
 */
export const CALIBRATED_LIMB_POSES = {
  rest: {
    left: {
      upperArm: [0.04, -0.05, -1.16],
      lowerArm: [-0.12, -0.19, 0.0],
      hand: [-0.06, 0.04, -0.05],
      handShape: 'relaxed',
    },
    rightCanonical: {
      upperArm: [0.05, -0.06, -1.15],
      lowerArm: [-0.13, -0.21, 0.0],
      hand: [-0.07, 0.05, -0.05],
      handShape: 'relaxed_alt',
    },
  },

  wave: {
    left: {
      upperArm: [0.05, -0.06, -1.16],
      lowerArm: [-0.14, -0.22, 0.0],
      hand: [-0.06, 0.04, -0.05],
      handShape: 'relaxed',
    },
    rightCanonical: {
      upperArm: [-0.5964, 0.2236, -0.7785],
      lowerArm: [0.4018, -2.0218, 0.0],
      hand: [0.0996, 0.1783, 0.6178],
      handShape: 'open_wave',
    },
  },

  open_hand_greeting: {
    left: {
      upperArm: [0.15, 0.0, -1.33],
      lowerArm: [0.0, 0.0, -0.20],
      hand: [-0.06, 0.04, -0.05],
      handShape: 'relaxed',
    },
    rightCanonical: {
      upperArm: [-0.2127, -0.1077, -0.9346],
      lowerArm: [-1.4137, -1.4029, 0.0],
      hand: [-0.5596, -0.3215, -0.0713],
      handShape: 'open_greeting',
    },
  },

  explaining: {
    left: {
      upperArm: [-0.0648, -0.1752, -1.0216],
      lowerArm: [-1.1327, -1.3875, 0.0],
      hand: [-0.4575, -0.1133, -0.3286],
      handShape: 'open_explaining',
    },
    rightCanonical: {
      upperArm: [-0.1665, -0.1294, -0.9485],
      lowerArm: [-1.2348, -1.4221, 0.0],
      hand: [-0.4874, -0.0511, -0.3165],
      handShape: 'open_explaining',
    },
  },

  thinking: {
    left: {
      upperArm: [0.15, 0.0, -1.33],
      lowerArm: [0.0, 0.0, -0.20],
      hand: [-0.06, 0.04, -0.05],
      handShape: 'relaxed',
    },
    rightCanonical: {
      upperArm: [-0.2298, -0.4794, -0.931],
      lowerArm: [-0.3449, -2.2506, 0.0],
      hand: [-0.108, -0.8002, 0.0623],
      handShape: 'thinking_chin',
    },
  },

  shrug: {
    left: {
      upperArm: [-0.1271, 0.2305, -1.0805],
      lowerArm: [-1.5272, -1.4044, 0.0],
      hand: [-0.6162, -0.4844, -0.1094],
      handShape: 'open_shrug',
    },
    rightCanonical: {
      upperArm: [-0.1992, 0.26, -1.0719],
      lowerArm: [-1.5225, -1.396, 0.0],
      hand: [-0.6089, -0.4677, -0.0854],
      handShape: 'open_shrug',
    },
  },

  laughing: {
    left: {
      upperArm: [0.15, 0.0, -1.33],
      lowerArm: [0.0, 0.0, -0.20],
      hand: [-0.06, 0.04, -0.05],
      handShape: 'relaxed',
    },
    rightCanonical: {
      upperArm: [-0.278, -0.4382, -0.9384],
      lowerArm: [-0.6037, -2.0423, 0.0],
      hand: [-0.3721, -0.8328, -0.3222],
      handShape: 'cupped_laugh',
    },
  },

  shy_hands_together: {
    left: {
      upperArm: [-0.0358, -0.5129, -1.1462],
      lowerArm: [-0.2838, -1.4052, 0.0],
      hand: [-0.0636, -0.8178, 0.1082],
      handShape: 'shy_clasped',
    },
    rightCanonical: {
      upperArm: [-0.105, -0.5306, -1.1396],
      lowerArm: [-0.2962, -1.3677, 0.0],
      hand: [-0.085, -0.8113, 0.0706],
      handShape: 'shy_clasped',
    },
  },

  reassuring: {
    left: {
      upperArm: [-0.0061, -0.2037, -1.065],
      lowerArm: [-1.1952, -1.3234, 0.0],
      hand: [-0.4888, -0.1435, -0.3721],
      handShape: 'gentle_palm',
    },
    rightCanonical: {
      upperArm: [-0.1453, -0.6099, -0.9458],
      lowerArm: [-0.4848, -1.7878, 0.0],
      hand: [-0.4106, -0.6991, -0.6161],
      handShape: 'warm_heart',
    },
  },
} as const satisfies Readonly<Record<string, BilateralLimbPoseSpec>>;

export type CalibratedPoseKey = keyof typeof CALIBRATED_LIMB_POSES;

const scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export function eulerTupleToQuaternion(
  tuple: EulerYXZTuple,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  scratchEuler.set(tuple[0], tuple[1], tuple[2], 'YXZ');
  return target.setFromEuler(scratchEuler).normalize();
}

/**
 * Reflects a canonical left-side quaternion across the sagittal plane (`X = 0`)
 * in Three.js / VRM 1.0 normalized right-handed coordinates: `(qx, -qy, -qz, qw)`.
 */
export function mirrorLeftQuaternionToRight(
  leftQuat: THREE.Quaternion,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  return target.set(leftQuat.x, -leftQuat.y, -leftQuat.z, leftQuat.w).normalize();
}

/**
 * Builds a complete 36-bone map of unit-normalized target quaternions from a
 * calibrated bilateral arm + finger pose specification.
 */
export function buildLimbPoseQuaternionMap(
  spec: BilateralLimbPoseSpec,
): Map<UpperLimbBoneName, THREE.Quaternion> {
  const map = new Map<UpperLimbBoneName, THREE.Quaternion>();

  // Left arm chain
  map.set('leftUpperArm', eulerTupleToQuaternion(spec.left.upperArm));
  map.set('leftLowerArm', eulerTupleToQuaternion(spec.left.lowerArm));
  map.set('leftHand', eulerTupleToQuaternion(spec.left.hand));

  // Right arm chain (mirrored across X=0 from canonical right spec)
  map.set(
    'rightUpperArm',
    mirrorLeftQuaternionToRight(eulerTupleToQuaternion(spec.rightCanonical.upperArm)),
  );
  map.set(
    'rightLowerArm',
    mirrorLeftQuaternionToRight(eulerTupleToQuaternion(spec.rightCanonical.lowerArm)),
  );
  map.set(
    'rightHand',
    mirrorLeftQuaternionToRight(eulerTupleToQuaternion(spec.rightCanonical.hand)),
  );

  // Left 15 individual finger joints
  const leftFingers = HAND_SHAPE_LIBRARY[spec.left.handShape];
  for (const joint of CANONICAL_FINGER_JOINT_NAMES) {
    const boneName = LEFT_FINGER_MAP[joint];
    map.set(boneName, eulerTupleToQuaternion(leftFingers[joint]));
  }

  // Right 15 individual finger joints (mirrored across X=0)
  const rightFingers = HAND_SHAPE_LIBRARY[spec.rightCanonical.handShape];
  for (const joint of CANONICAL_FINGER_JOINT_NAMES) {
    const boneName = RIGHT_FINGER_MAP[joint];
    map.set(
      boneName,
      mirrorLeftQuaternionToRight(eulerTupleToQuaternion(rightFingers[joint])),
    );
  }

  return map;
}

