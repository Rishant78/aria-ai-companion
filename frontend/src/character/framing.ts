import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { CameraFraming, FramingMode } from './types';

export type { FramingMode };

function getBoneWorldPosition(vrm: VRM, boneName: VRMHumanBoneName): THREE.Vector3 | null {
  const node = vrm.humanoid.getRawBoneNode(boneName) ?? vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!node) {
    return null;
  }
  const target = new THREE.Vector3();
  node.getWorldPosition(target);
  return target;
}

/**
 * Relaxes raw horizontal T-pose arms into a natural companion standing posture
 * via normalized VRM humanoid bones. Preserves all morph targets/expressions,
 * and yields cleanly whenever GestureController or IdleController drives normalized bones.
 */
export function applyNaturalRestArms(vrm: VRM): void {
  const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
  const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
  const leftHand = vrm.humanoid.getNormalizedBoneNode('leftHand');
  const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');

  // VRM 1.0 normalized rig faces +Z with +X = character left, -X = character right
  if (leftUpperArm) {
    leftUpperArm.rotation.set(0.05, 0.0, -1.14);
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.set(0.05, 0.0, 1.14);
  }
  if (leftLowerArm) {
    leftLowerArm.rotation.set(0.0, 0.14, -0.08);
  }
  if (rightLowerArm) {
    rightLowerArm.rotation.set(0.0, -0.14, 0.08);
  }
  if (leftHand) {
    leftHand.rotation.set(0.0, 0.0, -0.08);
  }
  if (rightHand) {
    rightHand.rotation.set(0.0, 0.0, 0.08);
  }
}

/**
 * Computes responsive aspect-ratio-aware camera framing supporting both waist-up
 * and full-body modes. Uses humanoid bone landmarks and safe-area margins instead
 * of unskinned T-pose bounding boxes so resting postures and gestures never clip.
 */
export function computeAvatarFraming(
  vrm: VRM,
  mode: FramingMode = 'waist',
  verticalFovDeg = 28,
  aspect = 1.0,
): CameraFraming {
  vrm.scene.updateMatrixWorld(true);

  const hipsPos = getBoneWorldPosition(vrm, 'hips');
  const spinePos = getBoneWorldPosition(vrm, 'spine');
  const headPos = getBoneWorldPosition(vrm, 'head');
  const leftEyePos = getBoneWorldPosition(vrm, 'leftEye');
  const rightEyePos = getBoneWorldPosition(vrm, 'rightEye');

  const centerX = headPos?.x ?? hipsPos?.x ?? 0;
  const centerZ = headPos?.z ?? hipsPos?.z ?? 0;

  const eyeY =
    leftEyePos && rightEyePos
      ? (leftEyePos.y + rightEyePos.y) * 0.5
      : headPos
        ? headPos.y + 0.06
        : 1.40;

  // Crown estimate with headroom so hair accessories and head-tilt accents are preserved
  const crownEstimateY = headPos ? headPos.y + 0.16 : eyeY + 0.12;
  const topY = crownEstimateY + 0.03;

  let bottomY: number;
  let targetY: number;
  let cameraY: number;
  let safeWidth: number;

  if (mode === 'full') {
    // Foot soles sit at Y = 0.000m. A calibrated bottom buffer provides clearance
    // above the bottom HUD pill bar across all mobile and desktop viewports.
    bottomY = -0.05;
    safeWidth = 0.72; // Fully encompasses feet stance, hip sway, and relaxed arms
    targetY = 0.77; // Centered to balance crown and grounded shoe soles
    cameraY = 0.86; // Eye-to-waist downward perspective without floor keystoning
  } else {
    // Waist cut near hips/lower spine
    const waistY = hipsPos
      ? hipsPos.y - 0.03
      : spinePos
        ? spinePos.y - 0.08
        : 0.85;
    bottomY = waistY;
    safeWidth = 0.70; // Accommodates conversational arm and hand gestures
    const span = Math.max(0.45, topY - bottomY);
    targetY = bottomY + span * 0.52;
    cameraY = THREE.MathUtils.lerp(targetY, eyeY, 0.35);
  }

  const verticalSpan = Math.max(0.45, topY - bottomY);

  // Dual-axis frustum fit: handles ultra-wide desktop as well as narrow mobile screens
  const safeAspect = Math.max(0.2, aspect);
  const halfFovRad = THREE.MathUtils.degToRad(verticalFovDeg * 0.5);
  const tanHalfFovV = Math.tan(halfFovRad);
  const tanHalfFovH = safeAspect * tanHalfFovV;

  const distV = (verticalSpan * 0.5) / tanHalfFovV;
  const distH = (safeWidth * 0.5) / Math.max(0.08, tanHalfFovH);
  const distance = Math.max(distV, distH) * 1.01;

  return {
    position: new THREE.Vector3(centerX, cameraY, centerZ + distance),
    target: new THREE.Vector3(centerX, targetY, centerZ),
  };
}

/**
 * Backward-compatible waist-up framing wrapper.
 */
export function computeWaistUpFraming(vrm: VRM, verticalFovDeg = 28): CameraFraming {
  return computeAvatarFraming(vrm, 'waist', verticalFovDeg, 1.0);
}
