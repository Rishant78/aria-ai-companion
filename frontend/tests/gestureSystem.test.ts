import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanoid, VRMLoaderPlugin } from '@pixiv/three-vrm';
import type { VRM, VRMHumanBoneName, VRMHumanBones } from '@pixiv/three-vrm';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { AttentionController as AttentionControllerType } from '../src/character/AttentionController.ts';
import type { BlinkController as BlinkControllerType } from '../src/character/BlinkController.ts';
import type { BreathingController as BreathingControllerType } from '../src/character/BreathingController.ts';
import type { ExpressionController as ExpressionControllerType } from '../src/character/ExpressionController.ts';
import type { GazeController as GazeControllerType } from '../src/character/GazeController.ts';
import type {
  ActiveGestureName,
  GESTURE_DEFINITIONS as GestureDefinitionsType,
  GestureController as GestureControllerType,
  GestureName,
} from '../src/character/GestureController.ts';
import type { UpperLimbBoneName } from '../src/character/HandPoseLibrary.ts';
import type { GestureHeadAccent } from '../src/character/AttentionController.ts';
import type { UpperBodyGestureOffset } from '../src/character/BreathingController.ts';
import type { UseAttentionSystemResult } from '../src/hooks/useAttentionSystem.ts';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPANION_VRM_PATH = path.join(FRONTEND_ROOT, 'public', 'models', 'companion.vrm');

interface CharacterBarrelModule {
  AttentionController: typeof AttentionControllerType;
  BlinkController: typeof BlinkControllerType;
  BreathingController: typeof BreathingControllerType;
  ExpressionController: typeof ExpressionControllerType;
  GazeController: typeof GazeControllerType;
  GestureController: typeof GestureControllerType;
  ACTIVE_GESTURE_NAMES: readonly ActiveGestureName[];
  GESTURE_DEFINITIONS: typeof GestureDefinitionsType;
  UPPER_LIMB_BONE_NAMES: readonly UpperLimbBoneName[];
  LEFT_FINGER_BONE_NAMES: readonly UpperLimbBoneName[];
  RIGHT_FINGER_BONE_NAMES: readonly UpperLimbBoneName[];
}

interface AvatarSceneModule {
  AvatarScene: React.ComponentType<{
    showDevControls?: boolean;
    gestureController?: GestureControllerType;
  }>;
}

interface AttentionHookModule {
  useAttentionSystem: (options?: unknown) => UseAttentionSystemResult;
}

function quatAngleRad(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = Math.min(1, Math.abs(a.dot(b)));
  return 2 * Math.acos(dot);
}

async function loadRealCompanionVrm(): Promise<VRM> {
  const g = globalThis as Record<string, unknown>;
  if (!g.self) {
    g.self = globalThis;
  }
  if (!g.createImageBitmap) {
    g.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  }

  const buffer = fs.readFileSync(COMPANION_VRM_PATH);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
  const gltf = await loader.parseAsync(arrayBuffer, '');
  const vrm = gltf.userData.vrm as VRM | undefined;
  assert.ok(vrm, 'Expected companion.vrm to parse into a valid VRM 1.0 instance');
  return vrm;
}

describe('Milestone 3B — Gesture & Body Language Engine', () => {
  let vite: ViteDevServer;
  let charMod: CharacterBarrelModule;
  let AvatarScene: AvatarSceneModule['AvatarScene'];
  let useAttentionSystem: AttentionHookModule['useAttentionSystem'];
  let happyWindow: Window;
  let companionVrm: VRM;

  before(async () => {
    companionVrm = await loadRealCompanionVrm();

    happyWindow = new Window({ url: 'http://localhost:5173/' });
    Object.assign(globalThis, {
      window: happyWindow,
      document: happyWindow.document,
      HTMLElement: happyWindow.HTMLElement,
      HTMLButtonElement: happyWindow.HTMLButtonElement,
      HTMLInputElement: happyWindow.HTMLInputElement,
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
          name: 'mock-avatar-viewer-ready-m3b',
          enforce: 'pre',
          resolveId(id) {
            if (id.endsWith('/hooks/useAvatarViewer') || id === '../hooks/useAvatarViewer') {
              return '\0virtual:useAvatarViewerM3B';
            }
            return null;
          },
          load(id) {
            if (id === '\0virtual:useAvatarViewerM3B') {
              return `
                export function useAvatarViewer() {
                  return {
                    loadState: { status: 'ready', progress: 100, errorMessage: null },
                    modelSummary: {
                      name: 'Shizue Izawa',
                      specVersion: '1.0',
                      authors: ['D-XFacter'],
                      presetExpressions: [
                        'happy', 'angry', 'sad', 'relaxed', 'surprised',
                        'aa', 'ih', 'ou', 'ee', 'oh',
                        'blink', 'blinkLeft', 'blinkRight', 'neutral'
                      ],
                      customExpressions: [],
                      allExpressions: [
                        'happy', 'angry', 'sad', 'relaxed', 'surprised',
                        'aa', 'ih', 'ou', 'ee', 'oh',
                        'blink', 'blinkLeft', 'blinkRight', 'neutral'
                      ],
                    },
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
    const hookMod = (await vite.ssrLoadModule('/src/hooks/useAttentionSystem.ts')) as AttentionHookModule;
    useAttentionSystem = hookMod.useAttentionSystem;
  });

  after(async () => {
    await vite?.close();
    await happyWindow?.happyDOM.close();
  });

  it('1. enforces exclusive 36-bone ownership, replaces applyNaturalRestArms when registered, and coordinates torso/head accents cleanly', () => {
    // A. Zero forbidden timer APIs in gesture/hand/viewer/attention modules
    for (const relPath of [
      'src/character/GestureController.ts',
      'src/character/HandPoseLibrary.ts',
      'src/hooks/useAttentionSystem.ts',
    ]) {
      const src = fs.readFileSync(path.join(FRONTEND_ROOT, relPath), 'utf8');
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      assert.equal(
        /setInterval|setTimeout|requestAnimationFrame/.test(codeOnly),
        false,
        `Forbidden timer API found in ${relPath}`,
      );
    }

    // Verify useAvatarViewer disables applyRelaxedPose when GestureController is attached
    const viewerSrc = fs.readFileSync(
      path.join(FRONTEND_ROOT, 'src/hooks/useAvatarViewer.ts'),
      'utf8',
    );
    assert.ok(
      viewerSrc.includes('!hasGestureController'),
      'useAvatarViewer must disable static applyNaturalRestArms when GestureController is attached',
    );

    const {
      AttentionController,
      BreathingController,
      GazeController,
      GestureController,
      UPPER_LIMB_BONE_NAMES,
    } = charMod;

    assert.equal(UPPER_LIMB_BONE_NAMES.length, 36, 'Expected 36 upper-limb bones');

    companionVrm.humanoid.resetNormalizedPose();
    companionVrm.expressionManager?.resetValues();

    const gesture = new GestureController();
    gesture.attach(companionVrm);
    assert.equal(gesture.getAttachedBoneCount(), 36, 'Expected all 36 bones on companion.vrm');

    // Non-owned bones must remain untouched ([0, 0, 0, 1] in normalized space) across gestures
    const nonOwnedBones: readonly VRMHumanBoneName[] = [
      'hips',
      'spine',
      'chest',
      'upperChest',
      'leftShoulder',
      'rightShoulder',
      'neck',
      'head',
      'leftUpperLeg',
      'rightUpperLeg',
    ];

    gesture.playGesture('shrug', { bypassCooldown: true });
    for (let i = 0; i < 40; i++) {
      gesture.update(companionVrm, 1 / 60);
    }

    for (const boneName of nonOwnedBones) {
      const node = companionVrm.humanoid.getNormalizedBoneNode(boneName)!;
      assert.deepEqual(
        node.quaternion.toArray(),
        [0, 0, 0, 1],
        `GestureController must NEVER write non-owned bone "${boneName}"`,
      );
    }

    // Verify coordinated additive channels into BreathingController & AttentionController -> GazeController
    const breathing = new BreathingController();
    const attention = new AttentionController();
    const gaze = new GazeController({ attention });
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 50);
    camera.position.set(0, 1.34, 1.65);
    camera.updateMatrixWorld(true);

    breathing.attach(companionVrm);
    gaze.attach(companionVrm, camera);

    const coordinatedGesture = new GestureController({
      onUpperBodyOffset: (offset) => breathing.setGestureOffset(offset),
      onHeadAccent: (accent) => attention.setGestureHeadAccent(accent),
    });
    coordinatedGesture.attach(companionVrm);

    coordinatedGesture.playGesture('shrug', { bypassCooldown: true });
    for (let i = 0; i < 30; i++) {
      coordinatedGesture.update(companionVrm, 1 / 60);
      breathing.update(companionVrm, 1 / 60);
      gaze.update(companionVrm, 1 / 60);
    }

    const dampedOffset = breathing.getDampedGestureOffset();
    assert.ok(dampedOffset.leftShoulderLiftRad > 0.08, 'Expected damped left shoulder shrug lift');
    assert.ok(dampedOffset.rightShoulderLiftRad > 0.09, 'Expected damped right shoulder shrug lift');

    // Stopping gesture smoothly clears coordinated offsets back toward zero
    coordinatedGesture.stopGesture();
    for (let i = 0; i < 90; i++) {
      coordinatedGesture.update(companionVrm, 1 / 60);
      breathing.update(companionVrm, 1 / 60);
      gaze.update(companionVrm, 1 / 60);
    }
    assert.ok(Math.abs(breathing.getDampedGestureOffset().leftShoulderLiftRad) < 1e-3);

    coordinatedGesture.dispose();
    breathing.dispose();
    gaze.dispose();
    gesture.dispose();
  });

  it('2. applies a natural relaxed arm and non-uniform individual finger resting pose on attach', () => {
    const { GestureController, LEFT_FINGER_BONE_NAMES, RIGHT_FINGER_BONE_NAMES } = charMod;

    companionVrm.humanoid.resetNormalizedPose();
    companionVrm.update(0);
    companionVrm.scene.updateMatrixWorld(true);

    const tPoseWrist = new THREE.Vector3();
    companionVrm.humanoid.getRawBoneNode('leftHand')!.getWorldPosition(tPoseWrist);
    assert.ok(tPoseWrist.y > 1.2, 'Sanity check: T-pose wrist starts near shoulder height');

    const gesture = new GestureController();
    gesture.attach(companionVrm);
    companionVrm.update(0);
    companionVrm.scene.updateMatrixWorld(true);

    const restWristL = new THREE.Vector3();
    const restWristR = new THREE.Vector3();
    companionVrm.humanoid.getRawBoneNode('leftHand')!.getWorldPosition(restWristL);
    companionVrm.humanoid.getRawBoneNode('rightHand')!.getWorldPosition(restWristR);

    assert.ok(
      restWristL.y < 0.9 && restWristR.y < 0.9,
      `Expected naturally lowered resting wrists (Y < 0.90m), got L=${restWristL.y.toFixed(3)}, R=${restWristR.y.toFixed(3)}`,
    );

    const identity = new THREE.Quaternion(0, 0, 0, 1);
    for (const fingerBone of [...LEFT_FINGER_BONE_NAMES, ...RIGHT_FINGER_BONE_NAMES]) {
      const q = companionVrm.humanoid.getNormalizedBoneNode(fingerBone)!.quaternion;
      assert.ok(
        quatAngleRad(q, identity) > 0.12,
        `Finger bone "${fingerBone}" must not remain stiffly uncurled at identity`,
      );
    }

    // Verify progressive anatomical finger cascade (index < middle < ring < little curl)
    const indexCurl = quatAngleRad(
      companionVrm.humanoid.getNormalizedBoneNode('leftIndexProximal')!.quaternion,
      identity,
    );
    const middleCurl = quatAngleRad(
      companionVrm.humanoid.getNormalizedBoneNode('leftMiddleProximal')!.quaternion,
      identity,
    );
    const ringCurl = quatAngleRad(
      companionVrm.humanoid.getNormalizedBoneNode('leftRingProximal')!.quaternion,
      identity,
    );
    const littleCurl = quatAngleRad(
      companionVrm.humanoid.getNormalizedBoneNode('leftLittleProximal')!.quaternion,
      identity,
    );
    assert.ok(
      indexCurl < middleCurl && middleCurl < ringCurl && ringCurl < littleCurl,
      `Expected progressive non-uniform finger curl cascade, got ${[indexCurl, middleCurl, ringCurl, littleCurl].map((v) => v.toFixed(3)).join(' < ')}`,
    );

    // Proximal, intermediate, and distal phalanges of the same digit must also differ
    const idxInter = quatAngleRad(
      companionVrm.humanoid.getNormalizedBoneNode('leftIndexIntermediate')!.quaternion,
      identity,
    );
    const idxDist = quatAngleRad(
      companionVrm.humanoid.getNormalizedBoneNode('leftIndexDistal')!.quaternion,
      identity,
    );
    assert.notEqual(indexCurl.toFixed(3), idxInter.toFixed(3));
    assert.notEqual(idxInter.toFixed(3), idxDist.toFixed(3));

    gesture.dispose();
  });

  it('3. validates all 8 gestures and world-space clearances against the actual companion.vrm skeleton', () => {
    const { ACTIVE_GESTURE_NAMES, GestureController } = charMod;
    assert.deepEqual(ACTIVE_GESTURE_NAMES, [
      'wave',
      'open_hand_greeting',
      'explaining',
      'thinking',
      'shrug',
      'laughing',
      'shy_hands_together',
      'reassuring',
    ]);

    companionVrm.humanoid.resetNormalizedPose();
    const gesture = new GestureController();
    gesture.attach(companionVrm);

    const restRightUpper = gesture.getRestBoneQuaternion('rightUpperArm');
    const restLeftUpper = gesture.getRestBoneQuaternion('leftUpperArm');

    const sustainRightWristByGesture = new Map<ActiveGestureName, THREE.Vector3>();

    for (const name of ACTIVE_GESTURE_NAMES) {
      gesture.stopGesture({ immediate: true });
      gesture.clearCooldowns();

      assert.equal(gesture.playGesture(name), true, `Expected "${name}" to start`);

      // Step into sustain (~0.60s at 60Hz)
      for (let i = 0; i < 36; i++) {
        gesture.update(companionVrm, 1 / 60);
      }
      assert.equal(gesture.getPhase(), 'sustain', `Expected "${name}" to be in sustain phase`);

      companionVrm.update(0);
      companionVrm.scene.updateMatrixWorld(true);

      const wristL = new THREE.Vector3();
      const wristR = new THREE.Vector3();
      companionVrm.humanoid.getRawBoneNode('leftHand')!.getWorldPosition(wristL);
      companionVrm.humanoid.getRawBoneNode('rightHand')!.getWorldPosition(wristR);
      sustainRightWristByGesture.set(name, wristR.clone());

      // Every gesture displaces at least one upper arm noticeably from rest
      const liveRightUpper = gesture.getBoneQuaternion('rightUpperArm');
      const liveLeftUpper = gesture.getBoneQuaternion('leftUpperArm');
      const maxArmDelta = Math.max(
        quatAngleRad(liveRightUpper, restRightUpper),
        quatAngleRad(liveLeftUpper, restLeftUpper),
      );
      assert.ok(maxArmDelta > 0.2, `Expected "${name}" to move arms clearly away from rest`);

      // Verify distributed forearm twist: wrist local quaternion stays well below 90° twist/bend
      const rightHandLocal = gesture.getBoneQuaternion('rightHand');
      assert.ok(
        quatAngleRad(rightHandLocal, new THREE.Quaternion(0, 0, 0, 1)) < 1.35,
        `Expected distributed wrist/forearm rotation on "${name}"`,
      );

      // Gesture-specific audited clearance assertions on companion.vrm (front torso Z=0.1561m, chin Y=1.3167m/Z=0.0814m)
      if (name === 'wave') {
        assert.ok(wristR.y > 1.2, `Expected raised right waving wrist, got Y=${wristR.y.toFixed(3)}`);
        assert.ok(wristL.y < 0.9, `Expected relaxed left wrist during wave, got Y=${wristL.y.toFixed(3)}`);
      } else if (name === 'open_hand_greeting') {
        assert.ok(wristR.y > 1.0 && wristR.z > 0.18, 'Expected open greeting right hand forward & visible');
      } else if (name === 'explaining') {
        assert.ok(wristL.z > 0.18 && wristR.z > 0.18, 'Expected explaining hands clear of front torso');
        assert.ok(Math.abs(wristL.y - wristR.y) > 0.015, 'Expected natural bilateral height asymmetry in explaining');
      } else if (name === 'thinking') {
        assert.ok(
          wristR.y > 1.16 && wristR.y < 1.31 && wristR.z > 0.12,
          `Expected thinking right wrist safely near/below chin without clipping face, got Y=${wristR.y.toFixed(3)}, Z=${wristR.z.toFixed(3)}`,
        );
      } else if (name === 'shrug') {
        assert.ok(wristL.x > 0.22 && wristR.x < -0.22 && wristR.y > 1.0, 'Expected open bilateral palms-up shrug');
      } else if (name === 'laughing') {
        assert.ok(wristR.y > 1.15 && wristR.z > 0.16, 'Expected laughing hand clear of chest & face');
      } else if (name === 'shy_hands_together') {
        const wristGap = wristL.distanceTo(wristR);
        assert.ok(wristL.z > 0.185 && wristR.z > 0.185, 'Expected shy hands clear of crop-top torso');
        assert.ok(
          wristGap > 0.07 && wristGap < 0.18,
          `Expected shy wrists softly together without self-intersection, got gap=${wristGap.toFixed(3)}m`,
        );
      } else if (name === 'reassuring') {
        assert.ok(wristR.z > 0.175 && wristL.z > 0.175, 'Expected reassuring hands clear of bust/torso');
      }
    }

    // Ensure wave and thinking produce distinct world-space hand locations
    assert.ok(
      sustainRightWristByGesture.get('wave')!.distanceTo(sustainRightWristByGesture.get('thinking')!) >
        0.12,
    );

    gesture.dispose();
  });

  it('4. executes smooth deltaTime attack -> sustain -> release -> idle phases and respects sleeve velocity bounds', () => {
    const { GestureController } = charMod;
    companionVrm.humanoid.resetNormalizedPose();

    const maxUpperSpeed = 5.6;
    const maxDistalSpeed = 9.6;
    const gesture = new GestureController({
      maxUpperArmSpeedRadPerSec: maxUpperSpeed,
      maxDistalSpeedRadPerSec: maxDistalSpeed,
    });
    gesture.attach(companionVrm);

    const restRightLower = gesture.getRestBoneQuaternion('rightLowerArm');

    // Request aggressive short transition (0.05s) on large-angle gesture 'thinking'
    assert.equal(
      gesture.playGesture('thinking', {
        transitionSeconds: 0.05,
        sustainSeconds: 0.2,
        bypassCooldown: true,
      }),
      true,
    );

    // Zero snap prior to first deltaTime tick
    assert.ok(quatAngleRad(gesture.getBoneQuaternion('rightLowerArm'), restRightLower) < 1e-7);
    assert.equal(gesture.getPhase(), 'attack');

    const dt = 1 / 60;
    let prevUpper = gesture.getBoneQuaternion('rightUpperArm');
    let prevLower = gesture.getBoneQuaternion('rightLowerArm');
    let sawSustain = false;
    let sawRelease = false;

    for (let step = 0; step < 90; step++) {
      gesture.update(companionVrm, dt);
      const nextUpper = gesture.getBoneQuaternion('rightUpperArm');
      const nextLower = gesture.getBoneQuaternion('rightLowerArm');

      const upperStepRad = quatAngleRad(prevUpper, nextUpper);
      const lowerStepRad = quatAngleRad(prevLower, nextLower);

      assert.ok(
        upperStepRad <= maxUpperSpeed * dt + 1e-5,
        `Upper-arm velocity exceeded bound at step ${step}: ${upperStepRad} > ${maxUpperSpeed * dt}`,
      );
      assert.ok(
        lowerStepRad <= maxDistalSpeed * dt + 1e-5,
        `Distal velocity exceeded bound at step ${step}: ${lowerStepRad} > ${maxDistalSpeed * dt}`,
      );

      if (gesture.getPhase() === 'sustain') sawSustain = true;
      if (gesture.getPhase() === 'release') sawRelease = true;

      prevUpper = nextUpper;
      prevLower = nextLower;
    }

    assert.equal(sawSustain, true, 'Expected gesture to pass through sustain phase');
    assert.equal(sawRelease, true, 'Expected gesture to pass through release phase');
    assert.equal(gesture.getPhase(), 'idle', 'Expected gesture to return cleanly to idle');
    assert.equal(gesture.getActiveGesture(), 'none');
    assert.ok(
      quatAngleRad(gesture.getBoneQuaternion('rightLowerArm'), restRightLower) < 1e-5,
      'Expected exact return to rest pose on completion',
    );

    // Configurable total durationSeconds override check
    gesture.clearCooldowns();
    assert.equal(gesture.playGesture('open_hand_greeting', { durationSeconds: 1.2 }), true);
    gesture.update(companionVrm, 0.5);
    assert.equal(gesture.getPhase(), 'sustain');
    gesture.update(companionVrm, 0.8);
    assert.equal(gesture.getPhase(), 'idle');

    gesture.dispose();
  });

  it('5. supports seamless mid-gesture interruption from live bone quaternions without snapping', () => {
    const { GestureController, UPPER_LIMB_BONE_NAMES } = charMod;
    companionVrm.humanoid.resetNormalizedPose();

    const gesture = new GestureController();
    gesture.attach(companionVrm);

    assert.equal(gesture.playGesture('wave', { bypassCooldown: true }), true);
    // Advance partway (~0.20s) into wave attack
    for (let i = 0; i < 12; i++) {
      gesture.update(companionVrm, 1 / 60);
    }
    assert.equal(gesture.getPhase(), 'attack');

    const snapshotBeforeInterrupt = new Map<UpperLimbBoneName, THREE.Quaternion>();
    for (const bone of UPPER_LIMB_BONE_NAMES) {
      snapshotBeforeInterrupt.set(bone, gesture.getBoneQuaternion(bone));
    }

    // Interrupt mid-attack with 'thinking'
    assert.equal(gesture.playGesture('thinking', { bypassCooldown: true }), true);
    assert.equal(gesture.getActiveGesture(), 'thinking');

    // 1. Exact zero jump at the moment of interruption
    for (const bone of UPPER_LIMB_BONE_NAMES) {
      const immediateAfter = gesture.getBoneQuaternion(bone);
      assert.ok(
        quatAngleRad(snapshotBeforeInterrupt.get(bone)!, immediateAfter) < 1e-7,
        `Bone "${bone}" snapped on interruption before next frame`,
      );
    }

    // 2. Next 60Hz tick steps smoothly from the mid-wave pose (never snapping through rest)
    gesture.update(companionVrm, 1 / 60);
    for (const bone of UPPER_LIMB_BONE_NAMES) {
      const nextQ = gesture.getBoneQuaternion(bone);
      assert.ok(
        quatAngleRad(snapshotBeforeInterrupt.get(bone)!, nextQ) <= 9.6 * (1 / 60) + 1e-5,
        `Bone "${bone}" jumped excessively on first frame after interruption`,
      );
    }

    // 3. Converges into 'thinking' sustain cleanly
    for (let i = 0; i < 30; i++) {
      gesture.update(companionVrm, 1 / 60);
    }
    assert.equal(gesture.getPhase(), 'sustain');
    assert.equal(gesture.getActiveGesture(), 'thinking');

    gesture.dispose();
  });

  it('6. enforces gesture priority tiers (autonomous < conversational < emotional < explicit) and stopGesture override', () => {
    const { GestureController } = charMod;
    const gesture = new GestureController();

    // 1. Autonomous starts
    assert.equal(gesture.playGesture('explaining', { priority: 'autonomous' }), true);
    gesture.update(0.1);
    assert.equal(gesture.getActiveGesture(), 'explaining');

    // 2. Conversational overrides autonomous
    assert.equal(gesture.playGesture('shrug', { priority: 'conversational' }), true);
    gesture.update(0.1);
    assert.equal(gesture.getActiveGesture(), 'shrug');

    // 3. Emotional overrides conversational
    assert.equal(gesture.playGesture('laughing', { priority: 'emotional' }), true);
    gesture.update(0.1);
    assert.equal(gesture.getActiveGesture(), 'laughing');

    // 4. Lower-priority autonomous & conversational requests are rejected while emotional is active
    assert.equal(
      gesture.playGesture('wave', { priority: 'autonomous', bypassCooldown: true }),
      false,
    );
    assert.equal(
      gesture.playGesture('thinking', { priority: 'conversational', bypassCooldown: true }),
      false,
    );
    assert.equal(gesture.getActiveGesture(), 'laughing');

    // 5. Explicit overrides emotional
    assert.equal(gesture.playGesture('wave', { priority: 'explicit' }), true);
    assert.equal(gesture.getActiveGesture(), 'wave');

    // 6. stopGesture() overrides explicit priority and allows autonomous gestures once released
    gesture.stopGesture();
    assert.equal(gesture.getPhase(), 'release');
    assert.equal(gesture.getActivePriority(), 0);
    assert.equal(
      gesture.playGesture('reassuring', { priority: 'autonomous' }),
      true,
      'Autonomous gesture should be accepted once active priority is cleared by stopGesture()',
    );

    gesture.dispose();
  });

  it('7. enforces per-gesture cooldowns via deltaTime and supports bypassCooldown when needed', () => {
    const { GESTURE_DEFINITIONS, GestureController } = charMod;
    const gesture = new GestureController();

    assert.equal(gesture.playGesture('wave'), true);
    assert.equal(gesture.getCooldownRemaining('wave'), GESTURE_DEFINITIONS.wave.cooldownSeconds);

    // Finish wave into idle (attack 0.38 + sustain 1.55 + release 0.44 = 2.37s; sustain refreshes 4.0s cooldown)
    for (let i = 0; i < 160; i++) {
      gesture.update(1 / 60);
    }
    assert.equal(gesture.getPhase(), 'idle');
    assert.ok(gesture.getCooldownRemaining('wave') > 2.5, 'Wave should still be on cooldown right after finishing');

    // Re-triggering 'wave' without bypassCooldown is blocked, while a different gesture ('shrug') succeeds
    assert.equal(gesture.playGesture('wave'), false, 'Expected cooldown to block immediate repeat');
    assert.equal(gesture.playGesture('shrug'), true, 'Other gestures have independent cooldowns');
    gesture.stopGesture({ immediate: true });

    // Explicit bypassCooldown succeeds even while cooldown > 0
    assert.equal(gesture.playGesture('wave', { bypassCooldown: true }), true);
    gesture.stopGesture({ immediate: true });

    // Advance past remaining 4.0s cooldown -> normal playGesture('wave') succeeds again
    for (let i = 0; i < 260; i++) {
      gesture.update(1 / 60);
    }
    assert.equal(gesture.getCooldownRemaining('wave'), 0);
    assert.equal(gesture.playGesture('wave'), true, 'Expected wave to succeed after cooldown elapses');

    gesture.dispose();
  });

  it('8. freezes phase, bone quaternions, and cooldowns on pause() and resumes smoothly on resume()', () => {
    const { GestureController, UPPER_LIMB_BONE_NAMES } = charMod;
    companionVrm.humanoid.resetNormalizedPose();

    const gesture = new GestureController();
    gesture.attach(companionVrm);

    gesture.playGesture('wave', { bypassCooldown: true });
    for (let i = 0; i < 12; i++) {
      gesture.update(companionVrm, 1 / 60);
    }

    const frozenPhase = gesture.getPhase();
    const frozenCooldown = gesture.getCooldownRemaining('wave');
    const frozenQuats = new Map<UpperLimbBoneName, number[]>();
    for (const bone of UPPER_LIMB_BONE_NAMES) {
      frozenQuats.set(bone, companionVrm.humanoid.getNormalizedBoneNode(bone)!.quaternion.toArray());
    }

    gesture.pause();
    assert.equal(gesture.isPaused, true);

    // 300 frames (5s) while paused must advance nothing
    for (let i = 0; i < 300; i++) {
      gesture.update(companionVrm, 1 / 60);
    }

    assert.equal(gesture.getPhase(), frozenPhase);
    assert.equal(gesture.getCooldownRemaining('wave'), frozenCooldown);
    for (const bone of UPPER_LIMB_BONE_NAMES) {
      assert.deepEqual(
        companionVrm.humanoid.getNormalizedBoneNode(bone)!.quaternion.toArray(),
        frozenQuats.get(bone),
        `Bone "${bone}" must stay frozen while paused`,
      );
    }

    // Resume and verify gesture advances to sustain and back to idle
    gesture.resume();
    assert.equal(gesture.isPaused, false);
    for (let i = 0; i < 160; i++) {
      gesture.update(companionVrm, 1 / 60);
    }
    assert.equal(gesture.getPhase(), 'idle');

    gesture.dispose();
  });

  it('9. safely handles partial/missing humanoid bones, invalid gesture names, and out-of-range intensities', () => {
    const { GestureController } = charMod;

    // A. Empty VRM with zero humanoid bones
    const emptyHumanoid = new VRMHumanoid({} as unknown as VRMHumanBones);
    const emptyVrm = {
      scene: new THREE.Group(),
      humanoid: emptyHumanoid,
      update: () => emptyHumanoid.update(),
    } as unknown as VRM;

    const emptyCtrl = new GestureController();
    emptyCtrl.attach(emptyVrm);
    assert.equal(emptyCtrl.getAttachedBoneCount(), 0);
    assert.equal(emptyCtrl.playGesture('wave'), true);
    emptyCtrl.update(emptyVrm, 0.25);
    emptyCtrl.stopGesture();
    emptyCtrl.update(emptyVrm, 0.5);
    emptyCtrl.dispose();

    // B. Partial VRM with only rightUpperArm & rightLowerArm (missing left arm, wrists, & all 30 fingers)
    const rightUpperArm = new THREE.Bone();
    const rightLowerArm = new THREE.Bone();
    rightUpperArm.add(rightLowerArm);
    const partialHumanoid = new VRMHumanoid({
      rightUpperArm: { node: rightUpperArm },
      rightLowerArm: { node: rightLowerArm },
    } as unknown as VRMHumanBones);
    const partialVrm = {
      scene: new THREE.Group(),
      humanoid: partialHumanoid,
      update: () => partialHumanoid.update(),
    } as unknown as VRM;

    const partialCtrl = new GestureController();
    partialCtrl.attach(partialVrm);
    assert.equal(partialCtrl.getAttachedBoneCount(), 2);

    // Unknown gesture string returns false without throwing
    assert.equal(
      partialCtrl.playGesture('backflip' as unknown as GestureName),
      false,
      'Unknown gesture name must return false safely',
    );

    // Intensity > 1.0 clamps to 1.0
    assert.equal(partialCtrl.playGesture('wave', { intensity: 2.5 }), true);
    assert.equal(partialCtrl.getIntensity(), 1.0);
    partialCtrl.update(partialVrm, 0.3);
    assert.notDeepEqual(
      partialHumanoid.getNormalizedBoneNode('rightUpperArm')!.quaternion.toArray(),
      [0, 0, 0, 1],
    );

    // Intensity <= 0 or NaN safely releases to rest
    assert.equal(partialCtrl.playGesture('shrug', { intensity: -0.4, bypassCooldown: true }), true);
    assert.equal(partialCtrl.getIntensity(), 0);
    assert.equal(partialCtrl.playGesture('thinking', { intensity: Number.NaN, bypassCooldown: true }), true);
    assert.equal(partialCtrl.getIntensity(), 0);

    partialCtrl.dispose();
  });

  it('10. guarantees zero cumulative quaternion drift over 60 seconds and wires Dev Gesture HUD controls cleanly', () => {
    const { ACTIVE_GESTURE_NAMES, GESTURE_DEFINITIONS, GestureController, UPPER_LIMB_BONE_NAMES } =
      charMod;
    companionVrm.humanoid.resetNormalizedPose();

    const gesture = new GestureController();
    gesture.attach(companionVrm);

    const initialRest = new Map<UpperLimbBoneName, THREE.Quaternion>();
    for (const bone of UPPER_LIMB_BONE_NAMES) {
      initialRest.set(bone, gesture.getRestBoneQuaternion(bone));
    }

    // Run 3,600 frames (60s at 60Hz) cycling through gestures, mid-flight interruptions, and full releases
    for (let frame = 0; frame < 3600; frame++) {
      if (frame === 0) gesture.playGesture('wave', { bypassCooldown: true });
      else if (frame === 25) gesture.playGesture('thinking', { bypassCooldown: true }); // interrupt mid-wave
      else if (frame === 260) gesture.playGesture('explaining', { bypassCooldown: true });
      else if (frame === 520) gesture.playGesture('shy_hands_together', { bypassCooldown: true });
      else if (frame === 560) gesture.playGesture('shrug', { bypassCooldown: true }); // interrupt mid-shy
      else if (frame === 900) gesture.playGesture('laughing', { bypassCooldown: true });
      else if (frame === 1300) gesture.playGesture('reassuring', { bypassCooldown: true });
      else if (frame === 1800) gesture.playGesture('open_hand_greeting', { bypassCooldown: true });
      else if (frame === 2400) gesture.stopGesture();

      gesture.update(companionVrm, 1 / 60);

      // Every frame, every owned quaternion must remain unit-normalized
      if (frame % 120 === 0) {
        for (const bone of UPPER_LIMB_BONE_NAMES) {
          const q = gesture.getBoneQuaternion(bone);
          assert.ok(
            Math.abs(q.length() - 1) < 1e-6,
            `Quaternion norm drifted on "${bone}" at frame ${frame}: ${q.length()}`,
          );
        }
      }
    }

    assert.equal(gesture.getPhase(), 'idle');
    for (const bone of UPPER_LIMB_BONE_NAMES) {
      const finalQ = companionVrm.humanoid.getNormalizedBoneNode(bone)!.quaternion;
      assert.ok(Math.abs(finalQ.length() - 1) < 1e-6);
      assert.ok(
        quatAngleRad(finalQ, initialRest.get(bone)!) < 1e-5,
        `Cumulative rotation drift detected on "${bone}"`,
      );
    }
    gesture.dispose();

    // Dev HUD Gesture Controls verification (rendered in dev mode, omitted when showDevControls={false})
    const uiGesture = new GestureController();
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      act(() => {
        root.render(
          React.createElement(AvatarScene, {
            showDevControls: true,
            gestureController: uiGesture,
          }),
        );
      });

      const gesturePanel = host.querySelector('.avatar-scene__dev-gestures');
      assert.ok(gesturePanel, 'Expected .avatar-scene__dev-gestures when showDevControls={true}');

      const buttonLabels = Array.from(gesturePanel.querySelectorAll('button')).map((b) =>
        (b.textContent ?? '').trim(),
      );
      for (const gestureName of ACTIVE_GESTURE_NAMES) {
        const expectedLabel = GESTURE_DEFINITIONS[gestureName].label;
        assert.ok(
          buttonLabels.includes(expectedLabel),
          `Expected "${expectedLabel}" gesture button, got: ${buttonLabels.join(', ')}`,
        );
      }
      assert.ok(buttonLabels.includes('Stop / Reset'), 'Expected Stop / Reset button');

      const sliders = Array.from(gesturePanel.querySelectorAll('input[type="range"]'));
      assert.equal(sliders.length, 1, 'Expected Gesture Intensity range slider');

      const waveBtn = Array.from(gesturePanel.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === 'Wave',
      ) as unknown as HTMLButtonElement;
      const stopBtn = Array.from(gesturePanel.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === 'Stop / Reset',
      ) as unknown as HTMLButtonElement;

      act(() => {
        waveBtn.click();
      });
      assert.equal(uiGesture.getActiveGesture(), 'wave');
      assert.equal(waveBtn.getAttribute('aria-pressed'), 'true');

      act(() => {
        stopBtn.click();
      });
      assert.equal(uiGesture.getActiveGesture(), 'none');
      assert.equal(uiGesture.getPhase(), 'release');

      // Production mode check
      act(() => {
        root.render(
          React.createElement(AvatarScene, {
            showDevControls: false,
            gestureController: uiGesture,
          }),
        );
      });
      assert.equal(host.querySelector('.avatar-scene__dev-gestures'), null);
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
      uiGesture.dispose();
    }
  });

  it('11. scales UpperBodyGestureOffset and GestureHeadAccent proportionally for intensity below 1.0', () => {
    const { GestureController } = charMod;

    let receivedOffset: UpperBodyGestureOffset | null = null;
    let receivedAccent: GestureHeadAccent | null = null;

    const controller = new GestureController({
      onUpperBodyOffset: (offset) => {
        receivedOffset = offset;
      },
      onHeadAccent: (accent) => {
        receivedAccent = accent;
      },
    });

    // A. Shrug at full intensity 1.0
    controller.playGesture('shrug', { intensity: 1.0 });
    controller.update(0.35); // enter sustain

    assert.ok(receivedOffset, 'Expected UpperBodyGestureOffset on shrug');
    assert.ok(receivedAccent, 'Expected GestureHeadAccent on shrug');

    const fullLeftShoulder = (receivedOffset as UpperBodyGestureOffset).leftShoulderLiftRad ?? 0;
    const fullRightShoulder = (receivedOffset as UpperBodyGestureOffset).rightShoulderLiftRad ?? 0;
    const fullHeadRoll = (receivedAccent as GestureHeadAccent).rollRad ?? 0;

    assert.ok(fullLeftShoulder > 0.04, `Expected leftShoulderLiftRad > 0.04, got ${fullLeftShoulder}`);
    assert.ok(fullRightShoulder > 0.04, `Expected rightShoulderLiftRad > 0.04, got ${fullRightShoulder}`);
    assert.ok(Math.abs(fullHeadRoll) > 0.02, `Expected |rollRad| > 0.02, got ${fullHeadRoll}`);

    // B. Shrug at partial intensity 0.4
    controller.stopGesture({ immediate: true });
    controller.playGesture('shrug', { intensity: 0.4, bypassCooldown: true });
    controller.update(0.35);

    assert.ok(receivedOffset, 'Expected UpperBodyGestureOffset at intensity 0.4');
    assert.ok(receivedAccent, 'Expected GestureHeadAccent at intensity 0.4');

    const partialLeftShoulder = (receivedOffset as UpperBodyGestureOffset).leftShoulderLiftRad ?? 0;
    const partialRightShoulder = (receivedOffset as UpperBodyGestureOffset).rightShoulderLiftRad ?? 0;
    const partialHeadRoll = (receivedAccent as GestureHeadAccent).rollRad ?? 0;

    assert.ok(
      Math.abs(partialLeftShoulder - fullLeftShoulder * 0.4) < 1e-5,
      `Expected leftShoulderLiftRad to scale to 40% (${fullLeftShoulder * 0.4}), got ${partialLeftShoulder}`,
    );
    assert.ok(
      Math.abs(partialRightShoulder - fullRightShoulder * 0.4) < 1e-5,
      `Expected rightShoulderLiftRad to scale to 40% (${fullRightShoulder * 0.4}), got ${partialRightShoulder}`,
    );
    assert.ok(
      Math.abs(partialHeadRoll - fullHeadRoll * 0.4) < 1e-5,
      `Expected head roll to scale to 40% (${fullHeadRoll * 0.4}), got ${partialHeadRoll}`,
    );

    // C. Dynamic setIntensity() during sustain updates accents immediately
    controller.setIntensity(0.7);
    const updatedLeftShoulder = (receivedOffset as UpperBodyGestureOffset).leftShoulderLiftRad ?? 0;
    assert.ok(
      Math.abs(updatedLeftShoulder - fullLeftShoulder * 0.7) < 1e-5,
      `Expected dynamic intensity 0.7 to scale leftShoulder to ${fullLeftShoulder * 0.7}, got ${updatedLeftShoulder}`,
    );

    controller.dispose();
  });

  it('12. clears torso and head offsets upon natural sustain completion and clears cooldowns on dispose', () => {
    const { GestureController } = charMod;

    let latestOffset: UpperBodyGestureOffset | null = null;
    let latestAccent: GestureHeadAccent | null = null;
    let offsetCallCount = 0;
    let accentCallCount = 0;

    const controller = new GestureController({
      onUpperBodyOffset: (offset) => {
        latestOffset = offset;
        offsetCallCount++;
      },
      onHeadAccent: (accent) => {
        latestAccent = accent;
        accentCallCount++;
      },
    });

    controller.playGesture('wave', { intensity: 1.0 });

    // Step into sustain (wave attack is 0.38s)
    controller.update(0.40);
    assert.equal(controller.getPhase(), 'sustain');
    assert.notEqual(latestOffset, null);
    assert.notEqual(latestAccent, null);
    assert.ok(offsetCallCount > 0);
    assert.ok(accentCallCount > 0);

    // Natural sustain duration for wave is 1.55s. Step through sustain and past it:
    controller.update(1.60);

    // Envelope must have advanced naturally from sustain to release
    assert.equal(controller.getPhase(), 'release');
    assert.equal(controller.getActiveGesture(), 'none');

    // Torso and head offsets must have been cleared to null without stopGesture() being called
    assert.equal(latestOffset, null, 'Expected torso offset to be null upon natural sustain completion');
    assert.equal(latestAccent, null, 'Expected head accent to be null upon natural sustain completion');

    // Verify cooldown is active immediately after sustain
    const canPlayImmediately = controller.playGesture('wave');
    assert.equal(canPlayImmediately, false, 'Wave should be on cooldown right after sustain');

    // dispose() must clear cooldowns and deregister listeners
    controller.dispose();

    // Replay after dispose should not be blocked by lingering cooldown
    const canPlayAfterDispose = controller.playGesture('wave');
    assert.equal(canPlayAfterDispose, true, 'Cooldown map should be cleared upon dispose()');

    controller.dispose();
  });

  it('13. integrates with useAttentionSystem, verifying live offset wiring into BreathingController and AttentionController', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    let system!: UseAttentionSystemResult;
    function TestHookComponent() {
      const res = useAttentionSystem();
      React.useEffect(() => {
        system = res;
      });
      return null;
    }

    try {
      act(() => {
        root.render(React.createElement(TestHookComponent));
      });

      assert.ok(system.gestureController, 'Expected gestureController');
      assert.ok(system.breathingController, 'Expected breathingController');
      assert.ok(system.attention, 'Expected attentionController');

      // Disable ambient head idle so headRoll reflects gesture accent exclusively
      act(() => {
        system.setHeadIdleEnabled(false);
      });

      // Trigger shrug gesture via hook
      act(() => {
        const accepted = system.playGesture('shrug', { intensity: 1.0 });
        assert.equal(accepted, true, 'Shrug gesture should be accepted');
      });

      // Step gesture into sustain (shrug attack is 0.34s)
      act(() => {
        system.gestureController.update(0.36);
      });
      assert.equal(system.gestureController.getPhase(), 'sustain');

      // Step breathing and attention controllers: verify they received live offsets
      system.breathingController.update(companionVrm, 0.1);
      const intentDuringSustain = system.attention.update(0.1);

      // Verify BreathingController received upperBodyOffset: shoulder lift should be active
      const leftShoulderNode = companionVrm.humanoid.getNormalizedBoneNode('leftShoulder');
      assert.ok(leftShoulderNode, 'leftShoulder node must exist on companion.vrm');
      const shoulderEuler = new THREE.Euler().setFromQuaternion(leftShoulderNode.quaternion, 'YXZ');
      assert.ok(
        Math.abs(shoulderEuler.z) > 0.01,
        `Expected non-zero shoulder roll offset from shrug gesture, got ${shoulderEuler.z}`,
      );

      // Verify AttentionController received headAccent: shrug accent rolls head
      assert.ok(
        Math.abs(intentDuringSustain.headTiltRollRad) > 0.01,
        `Expected non-zero headTiltRollRad in intent during sustain, got ${intentDuringSustain.headTiltRollRad}`,
      );

      // Advance through sustain completion into release (shrug sustain is 0.95s)
      act(() => {
        system.gestureController.update(1.05);
      });
      assert.equal(system.gestureController.getPhase(), 'release');

      // Advance breathing and attention controllers: offsets must decay smoothly toward 0
      let intentAfterRelease = intentDuringSustain;
      for (let f = 0; f < 35; f++) {
        system.breathingController.update(companionVrm, 1 / 60);
        intentAfterRelease = system.attention.update(1 / 60);
      }

      assert.ok(
        Math.abs(intentAfterRelease.headTiltRollRad) < 0.005,
        `Expected headTiltRollRad to decay toward zero after release, got ${intentAfterRelease.headTiltRollRad}`,
      );
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });
});
