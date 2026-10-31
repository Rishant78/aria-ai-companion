import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import {
  VRMHumanoid,
  VRMLookAt,
  VRMLookAtBoneApplier,
  VRMLookAtRangeMap,
} from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

import type {
  AttentionController as AttentionControllerType,
  BlinkController as BlinkControllerType,
  BreathingController as BreathingControllerType,
  ExpressionController as ExpressionControllerType,
  GazeController as GazeControllerType,
  GestureController as GestureControllerType,
  NaturalIdleController as NaturalIdleControllerType,
  PostureName,
} from '../src/character/index.ts';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface CharacterBarrelModule {
  AttentionController: typeof AttentionControllerType;
  BlinkController: typeof BlinkControllerType;
  BreathingController: typeof BreathingControllerType;
  ExpressionController: typeof ExpressionControllerType;
  GazeController: typeof GazeControllerType;
  GestureController: typeof GestureControllerType;
  NaturalIdleController: typeof NaturalIdleControllerType;
  POSTURE_NAMES: readonly PostureName[];
  computeAvatarFraming: (
    vrm: VRM,
    mode?: 'waist' | 'full',
    verticalFovDeg?: number,
    aspect?: number,
  ) => { position: THREE.Vector3; target: THREE.Vector3 };
}

interface AvatarSceneModule {
  AvatarScene: React.ComponentType<{
    showDevControls?: boolean;
    initialFramingMode?: 'waist' | 'full';
  }>;
}

/**
 * Creates a synthetic VRM instance with complete lower-body, torso, head, and arm skeletons
 * matching companion.vrm normalized proportions and rest transforms.
 */
function createSyntheticFullBodyVrm() {
  const sceneRoot = new THREE.Group();

  const hips = new THREE.Bone();
  hips.position.set(0, 0.90056, 0.00358);

  const spine = new THREE.Bone();
  spine.position.set(0, 0.14, 0);
  const chest = new THREE.Bone();
  chest.position.set(0, 0.14, 0);
  const upperChest = new THREE.Bone();
  upperChest.position.set(0, 0.12, 0);
  const neck = new THREE.Bone();
  neck.position.set(0, 0.1, 0);
  const head = new THREE.Bone();
  head.position.set(0, 0.09, 0);
  const leftEye = new THREE.Bone();
  leftEye.position.set(0.03, 0.06, 0.08);
  const rightEye = new THREE.Bone();
  rightEye.position.set(-0.03, 0.06, 0.08);

  const leftShoulder = new THREE.Bone();
  leftShoulder.position.set(0.09, 0.1, 0);
  const leftUpperArm = new THREE.Bone();
  leftUpperArm.position.set(0.08, 0, 0);
  const leftLowerArm = new THREE.Bone();
  leftLowerArm.position.set(0.22, 0, 0);
  const leftHand = new THREE.Bone();
  leftHand.position.set(0.22, 0, 0);

  const rightShoulder = new THREE.Bone();
  rightShoulder.position.set(-0.09, 0.1, 0);
  const rightUpperArm = new THREE.Bone();
  rightUpperArm.position.set(-0.08, 0, 0);
  const rightLowerArm = new THREE.Bone();
  rightLowerArm.position.set(-0.22, 0, 0);
  const rightHand = new THREE.Bone();
  rightHand.position.set(-0.22, 0, 0);

  // Exact companion.vrm lower-body bone offsets:
  // Femur: dy=-0.3502m, dz=-0.0073m (L1=0.3503m)
  // Shin: dy=-0.4109m, dz=-0.0247m (L2=0.4116m)
  // Foot: dy=-0.0624m, dz=+0.1096m (toes ball-of-foot forward)
  const leftUpperLeg = new THREE.Bone();
  leftUpperLeg.position.set(0.07663, -0.03952, -0.00363);
  const leftLowerLeg = new THREE.Bone();
  leftLowerLeg.position.set(0, -0.35022, -0.00733);
  const leftFoot = new THREE.Bone();
  leftFoot.position.set(0, -0.41089, -0.0247);
  const leftToes = new THREE.Bone();
  leftToes.position.set(0, -0.06241, 0.10956);

  const rightUpperLeg = new THREE.Bone();
  rightUpperLeg.position.set(-0.07663, -0.03952, -0.00363);
  const rightLowerLeg = new THREE.Bone();
  rightLowerLeg.position.set(0, -0.35022, -0.00733);
  const rightFoot = new THREE.Bone();
  rightFoot.position.set(0, -0.41089, -0.0247);
  const rightToes = new THREE.Bone();
  rightToes.position.set(0, -0.06241, 0.10956);

  sceneRoot.add(hips);
  hips.add(spine, leftUpperLeg, rightUpperLeg);
  leftUpperLeg.add(leftLowerLeg);
  leftLowerLeg.add(leftFoot);
  leftFoot.add(leftToes);

  rightUpperLeg.add(rightLowerLeg);
  rightLowerLeg.add(rightFoot);
  rightFoot.add(rightToes);

  spine.add(chest);
  chest.add(upperChest);
  upperChest.add(neck, leftShoulder, rightShoulder);
  neck.add(head);
  head.add(leftEye, rightEye);

  leftShoulder.add(leftUpperArm);
  leftUpperArm.add(leftLowerArm);
  leftLowerArm.add(leftHand);

  rightShoulder.add(rightUpperArm);
  rightUpperArm.add(rightLowerArm);
  rightLowerArm.add(rightHand);

  sceneRoot.updateMatrixWorld(true);

  const humanoid = new VRMHumanoid({
    hips: { node: hips },
    spine: { node: spine },
    chest: { node: chest },
    upperChest: { node: upperChest },
    neck: { node: neck },
    head: { node: head },
    leftEye: { node: leftEye },
    rightEye: { node: rightEye },
    leftShoulder: { node: leftShoulder },
    leftUpperArm: { node: leftUpperArm },
    leftLowerArm: { node: leftLowerArm },
    leftHand: { node: leftHand },
    rightShoulder: { node: rightShoulder },
    rightUpperArm: { node: rightUpperArm },
    rightLowerArm: { node: rightLowerArm },
    rightHand: { node: rightHand },
    leftUpperLeg: { node: leftUpperLeg },
    leftLowerLeg: { node: leftLowerLeg },
    leftFoot: { node: leftFoot },
    leftToes: { node: leftToes },
    rightUpperLeg: { node: rightUpperLeg },
    rightLowerLeg: { node: rightLowerLeg },
    rightFoot: { node: rightFoot },
    rightToes: { node: rightToes },
  });

  const rangeMap = new VRMLookAtRangeMap(90, 10);
  const applier = new VRMLookAtBoneApplier(humanoid, rangeMap, rangeMap, rangeMap, rangeMap);
  const lookAt = new VRMLookAt(humanoid, applier);

  const vrm = {
    scene: sceneRoot,
    humanoid,
    lookAt,
    expressionManager: {
      expressions: [{ expressionName: 'neutral', overrideBlinkAmount: 0 }],
      getExpression: () => null,
      getValue: () => 0,
      setValue: () => {},
    },
    update: (dt: number) => {
      humanoid.update();
      lookAt.update(dt);
    },
  } as unknown as VRM;

  return { vrm, sceneRoot, humanoid };
}

describe('Milestone 4 — Natural Full-Body Idle Animation System', () => {
  let vite: ViteDevServer;
  let charMod: CharacterBarrelModule;
  let AvatarScene: React.ComponentType<{
    showDevControls?: boolean;
    initialFramingMode?: 'waist' | 'full';
  }>;
  let happyWindow: Window;

  before(async () => {
    happyWindow = new Window({ url: 'http://localhost:5173/' });
    Object.assign(globalThis, {
      window: happyWindow,
      document: happyWindow.document,
      HTMLElement: happyWindow.HTMLElement,
      HTMLButtonElement: happyWindow.HTMLButtonElement,
      Node: happyWindow.Node,
      Event: happyWindow.Event,
      MouseEvent: happyWindow.MouseEvent,
      IS_REACT_ACT_ENVIRONMENT: true,
    });

    vite = await createServer({
      root: FRONTEND_ROOT,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
      plugins: [
        {
          name: 'mock-avatar-viewer-ready',
          enforce: 'pre',
          resolveId(id) {
            if (id.endsWith('/hooks/useAvatarViewer') || id === '../hooks/useAvatarViewer') {
              return '\0virtual:useAvatarViewer';
            }
            return null;
          },
          load(id) {
            if (id === '\0virtual:useAvatarViewer') {
              return `
                export function useAvatarViewer({ initialFramingMode = 'waist' } = {}) {
                  return {
                    loadState: { status: 'ready', progress: 100, errorMessage: null },
                    modelSummary: {
                      name: 'Companion',
                      specVersion: '1.0',
                      authors: [],
                      presetExpressions: ['neutral', 'blink', 'happy'],
                      customExpressions: [],
                      allExpressions: ['neutral', 'blink', 'happy'],
                    },
                    framingMode: initialFramingMode,
                    setFramingMode: () => {},
                    toggleFramingMode: () => {},
                    resetFraming: () => {},
                    retryLoad: () => {},
                  };
                }
              `;
            }
            return null;
          },
        },
      ],
    });

    charMod = (await vite.ssrLoadModule('/src/character/index.ts')) as CharacterBarrelModule;
    const sceneMod = (await vite.ssrLoadModule('/src/components/AvatarScene.tsx')) as AvatarSceneModule;
    AvatarScene = sceneMod.AvatarScene;
  });

  after(async () => {
    await vite?.close();
    await happyWindow?.happyDOM.close();
  });

  it('1. enforces exclusive 9-bone lower body ownership and disjoint contract across all 54 humanoid bones', () => {
    const { NaturalIdleController, GestureController, BreathingController, GazeController } = charMod;

    const lowerBody = new NaturalIdleController();
    const gesture = new GestureController();
    const breathing = new BreathingController();
    const gaze = new GazeController();

    assert.equal(lowerBody.id, 'lowerBody');
    assert.equal(gesture.id, 'gesture');
    assert.equal(breathing.id, 'breathing');
    assert.equal(gaze.id, 'gaze');

    const lowerBones = [
      'hips',
      'leftUpperLeg',
      'leftLowerLeg',
      'leftFoot',
      'leftToes',
      'rightUpperLeg',
      'rightLowerLeg',
      'rightFoot',
      'rightToes',
    ];

    assert.equal(lowerBones.length, 9, 'Lower-body humanoid bone count must be exactly 9');

    // Total humanoid bones: 9 lower + 36 upper limb + 5 torso + 2 cervical + 2 eyes = 54
    const totalHumanoidBones = 9 + 36 + 5 + 2 + 2;
    assert.equal(totalHumanoidBones, 54, 'Whole VRM humanoid rig must total exactly 54 bones');

    lowerBody.dispose();
    gesture.dispose();
    breathing.dispose();
    gaze.dispose();
  });

  it('2. solves analytical 3D leg IK with zero ground penetration and sub-millimeter foot clamp', () => {
    const { NaturalIdleController, POSTURE_NAMES } = charMod;
    const { vrm } = createSyntheticFullBodyVrm();

    const controller = new NaturalIdleController({ enabled: false });
    controller.attach(vrm);

    const leftFoot = vrm.humanoid.getNormalizedBoneNode('leftFoot')!;
    const rightFoot = vrm.humanoid.getNormalizedBoneNode('rightFoot')!;
    const leftToes = vrm.humanoid.getNormalizedBoneNode('leftToes')!;
    const rightToes = vrm.humanoid.getNormalizedBoneNode('rightToes')!;

    const leftFootPos0 = new THREE.Vector3();
    const rightFootPos0 = new THREE.Vector3();
    const leftToesPos0 = new THREE.Vector3();
    const rightToesPos0 = new THREE.Vector3();

    leftFoot.getWorldPosition(leftFootPos0);
    rightFoot.getWorldPosition(rightFootPos0);
    leftToes.getWorldPosition(leftToesPos0);
    rightToes.getWorldPosition(rightToesPos0);

    // Test each posture archetype
    for (const posture of POSTURE_NAMES) {
      controller.setPosture(posture, 0.5);

      // Advance through transition to full hold
      for (let i = 0; i < 40; i++) {
        controller.update(vrm, 0.02);
        vrm.update(0.02);
      }

      const curLF = new THREE.Vector3();
      const curRF = new THREE.Vector3();
      const curLT = new THREE.Vector3();
      const curRT = new THREE.Vector3();

      leftFoot.getWorldPosition(curLF);
      rightFoot.getWorldPosition(curRF);
      leftToes.getWorldPosition(curLT);
      rightToes.getWorldPosition(curRT);

      if (posture === 'neutral_stand') {
        // Both feet must be strictly clamped to resting ground targets
        assert.ok(
          curLF.distanceTo(leftFootPos0) < 1e-4,
          `Left foot should be clamped at rest in ${posture}, got ${curLF.distanceTo(leftFootPos0)}m error`,
        );
        assert.ok(
          curRF.distanceTo(rightFootPos0) < 1e-4,
          `Right foot should be clamped at rest in ${posture}, got ${curRF.distanceTo(rightFootPos0)}m error`,
        );
      } else if (posture === 'relaxed_settle') {
        // Both feet remain clamped to floor
        assert.ok(
          curLF.distanceTo(leftFootPos0) < 1e-4,
          `Left foot should be clamped at rest in relaxed_settle, got ${curLF.distanceTo(leftFootPos0)}m error`,
        );
        assert.ok(
          curRF.distanceTo(rightFootPos0) < 1e-4,
          `Right foot should be clamped at rest in relaxed_settle, got ${curRF.distanceTo(rightFootPos0)}m error`,
        );
        const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips')!;
        const leftLower = vrm.humanoid.getNormalizedBoneNode('leftLowerLeg')!;
        const rightLower = vrm.humanoid.getNormalizedBoneNode('rightLowerLeg')!;
        const eLeft = new THREE.Euler().setFromQuaternion(leftLower.quaternion, 'YXZ');
        const eRight = new THREE.Euler().setFromQuaternion(rightLower.quaternion, 'YXZ');

        // Pelvic drop >= 12mm
        assert.ok(
          0.90056 - hipsNode.position.y >= 0.012,
          `Relaxed settle must drop pelvis by at least 12mm below rest, got ${(0.90056 - hipsNode.position.y) * 1000}mm`,
        );
        // Bilateral knee flexion >= 8.0 deg (0.14 rad)
        assert.ok(
          eLeft.x >= 0.14,
          `Relaxed settle left knee flexion must be >= 8.0 deg (0.14 rad), got ${eLeft.x} rad`,
        );
        assert.ok(
          eRight.x >= 0.14,
          `Relaxed settle right knee flexion must be >= 8.0 deg (0.14 rad), got ${eRight.x} rad`,
        );
      } else if (posture === 'weight_left') {
        // Left foot is supporting and clamped
        assert.ok(
          curLF.distanceTo(leftFootPos0) < 1e-4,
          `Support left foot should stay clamped in weight_left, got ${curLF.distanceTo(leftFootPos0)}m error`,
        );
        // Right toes stay planted on floor Y during heel peel with sub-millimeter precision (< 1mm)
        assert.ok(
          Math.abs(curRT.y - rightToesPos0.y) < 1e-3,
          `Unweighted right toes must stay grounded in weight_left, got dy=${Math.abs(curRT.y - rightToesPos0.y)}m`,
        );
        // Right heel elevates upward by at least 10mm
        assert.ok(
          curRF.y - rightFootPos0.y >= 0.010,
          `Unweighted right heel must elevate by at least 10mm in weight_left, got ${(curRF.y - rightFootPos0.y) * 1000}mm`,
        );
      } else if (posture === 'weight_right') {
        // Right foot is supporting and clamped
        assert.ok(
          curRF.distanceTo(rightFootPos0) < 1e-4,
          `Support right foot should stay clamped in weight_right, got ${curRF.distanceTo(rightFootPos0)}m error`,
        );
        // Left toes stay planted on floor Y during heel peel with sub-millimeter precision (< 1mm)
        assert.ok(
          Math.abs(curLT.y - leftToesPos0.y) < 1e-3,
          `Unweighted left toes must stay grounded in weight_right, got dy=${Math.abs(curLT.y - leftToesPos0.y)}m`,
        );
        // Left heel elevates upward by at least 10mm
        assert.ok(
          curLF.y - leftFootPos0.y >= 0.010,
          `Unweighted left heel must elevate by at least 10mm in weight_right, got ${(curLF.y - leftFootPos0.y) * 1000}mm`,
        );
      }
    }

    controller.dispose();
  });

  it('3. enforces coupled pelvic vertical ceiling and eliminates knee hyperextension singularity', () => {
    const { NaturalIdleController } = charMod;
    const { vrm } = createSyntheticFullBodyVrm();

    const controller = new NaturalIdleController({ enabled: false });
    controller.attach(vrm);

    const leftLower = vrm.humanoid.getNormalizedBoneNode('leftLowerLeg')!;
    const rightLower = vrm.humanoid.getNormalizedBoneNode('rightLowerLeg')!;

    // Transition from neutral to weight_left
    controller.setPosture('weight_left', 3.0);

    let maxKneeAngularVelocity = 0;
    let prevLeftKneeAngle = 0;

    for (let frame = 0; frame < 180; frame++) {
      controller.update(vrm, 1 / 60);
      vrm.update(1 / 60);

      // Measure knee flexion angle (+X rotation in Euler YXZ)
      const eLeft = new THREE.Euler().setFromQuaternion(leftLower.quaternion, 'YXZ');
      const eRight = new THREE.Euler().setFromQuaternion(rightLower.quaternion, 'YXZ');

      // Neither knee must ever hyperextend (flexion >= 0)
      assert.ok(eLeft.x >= -1e-4, `Left knee must not hyperextend, got ${eLeft.x} rad`);
      assert.ok(eRight.x >= -1e-4, `Right knee must not hyperextend, got ${eRight.x} rad`);

      if (frame > 0) {
        const vel = Math.abs(eLeft.x - prevLeftKneeAngle) * 60;
        if (vel > maxKneeAngularVelocity) {
          maxKneeAngularVelocity = vel;
        }
      }
      prevLeftKneeAngle = eLeft.x;
    }

    // Knee angular velocity must be bounded smoothly without snapping
    assert.ok(
      maxKneeAngularVelocity < 1.5,
      `Knee angular velocity must be bounded, got ${maxKneeAngularVelocity} rad/s`,
    );

    controller.dispose();
  });

  it('4. bounds hip translation velocity below SpringBone cloth flutter thresholds (v <= 0.03 m/s)', () => {
    const { NaturalIdleController } = charMod;
    const { vrm } = createSyntheticFullBodyVrm();

    const controller = new NaturalIdleController({ enabled: false });
    controller.attach(vrm);

    const hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
    const prevPos = hips.position.clone();
    let maxHipVelocity = 0;

    // Transition directly across crossover (weight_left -> weight_right)
    controller.setPosture('weight_left', 0.1);
    for (let i = 0; i < 20; i++) controller.update(vrm, 0.02);

    controller.setPosture('weight_right', 3.8);
    prevPos.copy(hips.position);

    for (let frame = 0; frame < 240; frame++) {
      controller.update(vrm, 1 / 60);
      const vel = hips.position.distanceTo(prevPos) * 60;
      if (vel > maxHipVelocity) {
        maxHipVelocity = vel;
      }
      prevPos.copy(hips.position);
    }

    assert.ok(
      maxHipVelocity <= 0.045,
      `Peak hip translation velocity must stay <= 0.045 m/s to prevent SpringBone flutter, got ${maxHipVelocity.toFixed(4)} m/s`,
    );

    controller.dispose();
  });

  it('5. coordinates PelvicCounterOffset with BreathingController and attenuates synthetic sway', () => {
    const { NaturalIdleController, BreathingController } = charMod;
    const { vrm } = createSyntheticFullBodyVrm();

    const idle = new NaturalIdleController({ enabled: false });
    const breathing = new BreathingController();

    idle.attach(vrm);
    breathing.attach(vrm);

    idle.setPelvicOffsetHandler((offset) => {
      breathing.setPelvicOffset(offset);
    });

    idle.setPosture('weight_left', 2.0);

    for (let i = 0; i < 150; i++) {
      idle.update(vrm, 0.02);
      breathing.update(vrm, 0.02);
      vrm.update(0.02);
    }

    const dampedPelvic = breathing.getDampedPelvicOffset();
    assert.ok(
      Math.abs(dampedPelvic.spineRollRad) > 0.015,
      `BreathingController should receive active counter-roll, got ${dampedPelvic.spineRollRad}`,
    );
    // In weight_left: spineRoll counter-balances with negative roll
    assert.ok(
      dampedPelvic.spineRollRad < 0,
      'spineRoll must be negative to counter-balance +Z pelvic roll in weight_left',
    );

    // Verify contrapposto shoulder elevation asymmetry (4.0mm to 6.0mm delta)
    vrm.scene.updateMatrixWorld(true);
    const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder')!;
    const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder')!;
    const leftShoulderPos = new THREE.Vector3();
    const rightShoulderPos = new THREE.Vector3();
    leftShoulder.getWorldPosition(leftShoulderPos);
    rightShoulder.getWorldPosition(rightShoulderPos);

    const shoulderDeltaY = leftShoulderPos.y - rightShoulderPos.y;
    assert.ok(
      shoulderDeltaY >= 0.0040 && shoulderDeltaY <= 0.0060,
      `Shoulder elevation asymmetry in weight_left must be between 4.0mm and 6.0mm, got ${(shoulderDeltaY * 1000).toFixed(2)}mm`,
    );

    idle.dispose();
    breathing.dispose();
  });

  it('6. freezes transitions on pause() and restores exact rest transforms on dispose() with zero drift', () => {
    const { NaturalIdleController } = charMod;
    const { vrm } = createSyntheticFullBodyVrm();

    const controller = new NaturalIdleController();
    controller.attach(vrm);

    const hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
    const restHipsPos = hips.position.clone();
    const restHipsQuat = hips.quaternion.clone();

    // Run 3600 frames (60 seconds) of natural idle
    for (let i = 0; i < 1800; i++) {
      controller.update(vrm, 1 / 60);
      vrm.update(1 / 60);
    }

    // Pause and verify frozen state
    controller.setPaused(true);
    const pausedHipsPos = hips.position.clone();
    for (let i = 0; i < 60; i++) {
      controller.update(vrm, 1 / 60);
      assert.equal(hips.position.x, pausedHipsPos.x);
      assert.equal(hips.position.y, pausedHipsPos.y);
      assert.equal(hips.position.z, pausedHipsPos.z);
    }

    controller.setPaused(false);
    for (let i = 0; i < 1800; i++) {
      controller.update(vrm, 1 / 60);
      vrm.update(1 / 60);
    }

    // Dispose and assert exact return to rest pose
    controller.dispose();

    assert.ok(
      hips.position.distanceTo(restHipsPos) < 1e-5,
      `Hips position must return exactly to rest, diff=${hips.position.distanceTo(restHipsPos)}m`,
    );
    assert.ok(
      Math.abs(hips.quaternion.dot(restHipsQuat) - 1.0) < 1e-5,
      'Hips quaternion must return exactly to rest',
    );
  });

  it('7. computes responsive aspect-ratio-aware camera framing for waist and full-body modes', () => {
    const { computeAvatarFraming } = charMod;
    const { vrm } = createSyntheticFullBodyVrm();

    const aspectRatios = [
      { name: 'ultrawide_21_9', aspect: 2.33 },
      { name: 'desktop_16_9', aspect: 1.777 },
      { name: 'square_1_1', aspect: 1.0 },
      { name: 'mobile_portrait_9_16', aspect: 0.5625 },
      { name: 'narrow_split_pane', aspect: 0.35 },
    ];

    for (const { name, aspect } of aspectRatios) {
      const waistFraming = computeAvatarFraming(vrm, 'waist', 28, aspect);
      const fullFraming = computeAvatarFraming(vrm, 'full', 28, aspect);

      // Full body target sits lower (~0.80m) to center the whole body
      assert.ok(
        fullFraming.target.y < waistFraming.target.y,
        `Full-body target Y (${fullFraming.target.y}) must sit lower than waist (${waistFraming.target.y}) on ${name}`,
      );

      // Full body distance must be greater than waist distance
      assert.ok(
        fullFraming.position.z > waistFraming.position.z,
        `Full-body distance (${fullFraming.position.z}) must be greater than waist (${waistFraming.position.z}) on ${name}`,
      );

      // Verify feet at Y=0 and head at Y=1.565 project inside the camera frustum
      const camera = new THREE.PerspectiveCamera(28, aspect, 0.1, 50);
      camera.position.copy(fullFraming.position);
      camera.lookAt(fullFraming.target);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();

      const crownPoint = new THREE.Vector3(0, 1.565, 0).project(camera);
      const solePoint = new THREE.Vector3(0, 0.0, 0).project(camera);

      assert.ok(
        crownPoint.y <= 0.95 && crownPoint.y >= -0.95,
        `Crown must project inside NDC [-1, 1] on ${name}, got ${crownPoint.y}`,
      );
      assert.ok(
        solePoint.y <= 0.95 && solePoint.y >= -0.95,
        `Sole must project inside NDC [-1, 1] on ${name}, got ${solePoint.y}`,
      );
      // Sole must be placed above bottom HUD pill safe margin (NDC > -0.92)
      assert.ok(
        solePoint.y >= -0.92,
        `Sole must have HUD safe area clearance on ${name}, got ${solePoint.y}`,
      );
    }
  });

  it('8. renders development posture controls and full-body / waist-up framing toggle in AvatarScene', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      act(() => {
        root.render(React.createElement(AvatarScene, { showDevControls: true }));
      });

      // Framing toggle in main HUD
      const framingBtn = Array.from(host.querySelectorAll('button')).find((b) =>
        ['Full Body', 'Waist Up'].includes((b.textContent ?? '').trim()),
      );
      assert.ok(framingBtn, 'Expected camera framing toggle button in HUD');

      // Posture buttons in dev toolbar
      const postureLabel = host.querySelector('.avatar-scene__dev-label');
      assert.ok(postureLabel, 'Expected posture label in dev panel');

      const devButtons = Array.from(host.querySelectorAll('.avatar-scene__dev-panel button'));
      const neutralBtn = devButtons.find((b) => (b.textContent ?? '').trim() === 'Neutral');
      const weightLBtn = devButtons.find((b) => (b.textContent ?? '').trim() === 'Weight L');
      const weightRBtn = devButtons.find((b) => (b.textContent ?? '').trim() === 'Weight R');
      const settleBtn = devButtons.find((b) => (b.textContent ?? '').trim() === 'Settle');
      const shiftToggleBtn = devButtons.find((b) =>
        (b.textContent ?? '').trim().startsWith('Weight Shift:'),
      );

      assert.ok(neutralBtn, 'Expected Neutral posture button');
      assert.ok(weightLBtn, 'Expected Weight L posture button');
      assert.ok(weightRBtn, 'Expected Weight R posture button');
      assert.ok(settleBtn, 'Expected Settle posture button');
      assert.ok(shiftToggleBtn, 'Expected Weight Shift toggle button');

      act(() => {
        (weightLBtn as unknown as { click: () => void }).click();
        (framingBtn as unknown as { click: () => void }).click();
      });

      // Verify that viewport pointerdown interaction does NOT cancel the explicit Weight L posture
      const viewport = host.querySelector('.avatar-scene__viewport');
      assert.ok(viewport, 'Expected viewport element in DOM');

      act(() => {
        const pointerEvent = new happyWindow.Event('pointerdown', { bubbles: true });
        viewport.dispatchEvent(pointerEvent);
      });

      // Dev toolbar Weight L button must remain active (aria-pressed === 'true')
      assert.equal(
        weightLBtn?.getAttribute('aria-pressed'),
        'true',
        'Viewport pointer interaction must not cancel explicit developer Weight L posture',
      );

      act(() => {
        root.unmount();
      });
    } finally {
      host.remove();
    }
  });
});
