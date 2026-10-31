import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
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
import type { AttentionController as AttentionControllerType } from '../src/character/AttentionController.ts';
import type { BlinkController as BlinkControllerType } from '../src/character/BlinkController.ts';
import type { BreathingController as BreathingControllerType } from '../src/character/BreathingController.ts';
import type { GazeController as GazeControllerType } from '../src/character/GazeController.ts';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface CharacterBarrelModule {
  ATTENTION_STATES: readonly ['ATTENTIVE', 'EXPLORING', 'SEEKING_ATTENTION', 'LISTENING', 'SPEAKING'];
  AttentionController: typeof AttentionControllerType;
  BlinkController: typeof BlinkControllerType;
  BreathingController: typeof BreathingControllerType;
  GazeController: typeof GazeControllerType;
}

interface AvatarSceneModule {
  AvatarScene: React.ComponentType<{ showDevControls?: boolean }>;
}

function createSyntheticVrm(options: { includeUnifiedBlink?: boolean } = {}) {
  const { includeUnifiedBlink = true } = options;

  const sceneRoot = new THREE.Group();
  const hips = new THREE.Bone(); hips.position.set(0, 0.9, 0);
  const spine = new THREE.Bone(); spine.position.set(0, 0.14, 0);
  const chest = new THREE.Bone(); chest.position.set(0, 0.14, 0);
  const upperChest = new THREE.Bone(); upperChest.position.set(0, 0.12, 0);
  const neck = new THREE.Bone(); neck.position.set(0, 0.1, 0);
  const head = new THREE.Bone(); head.position.set(0, 0.09, 0);
  const leftEye = new THREE.Bone(); leftEye.position.set(0.03, 0.06, 0.08);
  const rightEye = new THREE.Bone(); rightEye.position.set(-0.03, 0.06, 0.08);
  const leftShoulder = new THREE.Bone(); leftShoulder.position.set(0.05, 0.1, 0);
  const leftUpperArm = new THREE.Bone(); leftUpperArm.position.set(0.08, 0, 0);
  const leftLowerArm = new THREE.Bone(); leftLowerArm.position.set(0.22, 0, 0);
  const leftHand = new THREE.Bone(); leftHand.position.set(0.22, 0, 0);
  const rightShoulder = new THREE.Bone(); rightShoulder.position.set(-0.05, 0.1, 0);
  const rightUpperArm = new THREE.Bone(); rightUpperArm.position.set(-0.08, 0, 0);
  const rightLowerArm = new THREE.Bone(); rightLowerArm.position.set(-0.22, 0, 0);
  const rightHand = new THREE.Bone(); rightHand.position.set(-0.22, 0, 0);
  const leftUpperLeg = new THREE.Bone(); leftUpperLeg.position.set(0.09, -0.05, 0);
  const leftLowerLeg = new THREE.Bone(); leftLowerLeg.position.set(0, -0.4, 0);
  const leftFoot = new THREE.Bone(); leftFoot.position.set(0, -0.4, 0);
  const rightUpperLeg = new THREE.Bone(); rightUpperLeg.position.set(-0.09, -0.05, 0);
  const rightLowerLeg = new THREE.Bone(); rightLowerLeg.position.set(0, -0.4, 0);
  const rightFoot = new THREE.Bone(); rightFoot.position.set(0, -0.4, 0);

  sceneRoot.add(hips);
  hips.add(spine, leftUpperLeg, rightUpperLeg);
  leftUpperLeg.add(leftLowerLeg);
  leftLowerLeg.add(leftFoot);
  rightUpperLeg.add(rightLowerLeg);
  rightLowerLeg.add(rightFoot);
  spine.add(chest);
  chest.add(upperChest);
  upperChest.add(neck, leftShoulder, rightShoulder);
  leftShoulder.add(leftUpperArm);
  leftUpperArm.add(leftLowerArm);
  leftLowerArm.add(leftHand);
  rightShoulder.add(rightUpperArm);
  rightUpperArm.add(rightLowerArm);
  rightLowerArm.add(rightHand);
  neck.add(head);
  head.add(leftEye, rightEye);
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
    rightUpperLeg: { node: rightUpperLeg },
    rightLowerLeg: { node: rightLowerLeg },
    rightFoot: { node: rightFoot },
  });

  const rangeMap = new VRMLookAtRangeMap(90, 10);
  const applier = new VRMLookAtBoneApplier(humanoid, rangeMap, rangeMap, rangeMap, rangeMap);
  const lookAt = new VRMLookAt(humanoid, applier);

  const expressionValues = new Map<string, number>();
  const setWriteLog: string[] = [];
  const availablePresets = new Set<string>([
    ...(includeUnifiedBlink ? ['blink'] : []),
    'blinkLeft',
    'blinkRight',
    'happy',
    'relaxed',
    'sad',
    'angry',
    'surprised',
    'neutral',
  ]);

  for (const name of availablePresets) {
    expressionValues.set(name, 0);
  }

  const expressionsList = Array.from(availablePresets).map((name) => ({
    expressionName: name,
    overrideBlinkAmount: 0,
  }));

  const vrm = {
    scene: sceneRoot,
    humanoid,
    lookAt,
    expressionManager: {
      expressions: expressionsList,
      getExpression: (name: string) => (availablePresets.has(name) ? { expressionName: name } : null),
      getValue: (name: string) => expressionValues.get(name) ?? null,
      setValue: (name: string, weight: number) => {
        if (availablePresets.has(name)) {
          setWriteLog.push(name);
          expressionValues.set(name, weight);
        }
      },
    },
    update: (dt: number) => {
      humanoid.update();
      lookAt.update(dt);
    },
  } as unknown as VRM;

  return { vrm, expressionValues, setWriteLog, expressionsList };
}

describe('Milestone 2 — Natural Idle Animation System', () => {
  let vite: ViteDevServer;
  let charMod: CharacterBarrelModule;
  let AvatarScene: React.ComponentType<{ showDevControls?: boolean }>;
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
                export function useAvatarViewer() {
                  return {
                    loadState: { status: 'ready', progress: 100, errorMessage: null },
                    modelSummary: {
                      name: 'Shizue Izawa',
                      specVersion: '1.0',
                      authors: [],
                      presetExpressions: ['neutral', 'blink', 'blinkLeft', 'blinkRight'],
                      customExpressions: [],
                      allExpressions: ['neutral', 'blink', 'blinkLeft', 'blinkRight'],
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
  });

  after(async () => {
    await vite?.close();
    await happyWindow?.happyDOM.close();
  });

  it('uses zero setInterval, setTimeout, or extra requestAnimationFrame loops across all idle/attention files', () => {
    for (const relPath of [
      'src/character/AttentionController.ts',
      'src/character/BreathingController.ts',
      'src/character/BlinkController.ts',
      'src/character/GazeController.ts',
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
  });

  it('enforces strict disjoint controller ownership (torso vs neck/head vs blink expressions)', () => {
    const { AttentionController, BlinkController, BreathingController, GazeController } = charMod;
    const { vrm, setWriteLog, expressionValues } = createSyntheticVrm();
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 50);
    camera.position.set(0.25, 1.32, 1.65);
    camera.updateMatrixWorld(true);

    const neckNode = vrm.humanoid.getNormalizedBoneNode('neck')!;
    const headNode = vrm.humanoid.getNormalizedBoneNode('head')!;
    const chestNode = vrm.humanoid.getNormalizedBoneNode('chest')!;
    const leftShoulder = vrm.humanoid.getNormalizedBoneNode('leftShoulder')!;
    const rightShoulder = vrm.humanoid.getNormalizedBoneNode('rightShoulder')!;

    // 1. BreathingController mutates chest/shoulders symmetrically and NEVER touches neck, head, or expressions
    const breathing = new BreathingController();
    breathing.attach(vrm);
    setWriteLog.length = 0;

    for (let i = 0; i < 90; i++) {
      breathing.update(vrm, 1 / 60);
    }

    assert.equal(setWriteLog.length, 0, 'BreathingController must never write expressions');
    assert.deepEqual(neckNode.quaternion.toArray(), [0, 0, 0, 1], 'BreathingController must not touch neck');
    assert.deepEqual(headNode.quaternion.toArray(), [0, 0, 0, 1], 'BreathingController must not touch head');
    assert.notDeepEqual(chestNode.quaternion.toArray(), [0, 0, 0, 1], 'Expected chest breathing motion');

    // Verify bilateral shoulder symmetry (left +Z vs right -Z lift)
    const leftEuler = new THREE.Euler().setFromQuaternion(leftShoulder.quaternion, 'YXZ');
    const rightEuler = new THREE.Euler().setFromQuaternion(rightShoulder.quaternion, 'YXZ');
    assert.ok(Math.abs(leftEuler.z + rightEuler.z) < 1e-6, 'Expected symmetrical bilateral shoulder Z lift');

    breathing.dispose();
    assert.deepEqual(chestNode.quaternion.toArray(), [0, 0, 0, 1], 'Expected rest restoration on dispose');

    // 2. GazeController mutates neck/head/lookAt and NEVER writes blink expressions or torso bones
    const attention = new AttentionController();
    const gaze = new GazeController({ attention });
    gaze.attach(vrm, camera);
    setWriteLog.length = 0;

    for (let i = 0; i < 180; i++) {
      gaze.update(vrm, 1 / 60);
    }

    assert.equal(setWriteLog.length, 0, 'GazeController must never write blink or facial expressions');
    assert.deepEqual(chestNode.quaternion.toArray(), [0, 0, 0, 1], 'GazeController must not touch chest');
    assert.notDeepEqual(headNode.quaternion.toArray(), [0, 0, 0, 1], 'Expected GazeController head tracking');
    gaze.dispose();

    // 3. BlinkController is sole blink writer and preserves emotional expressions without overwriting
    expressionValues.set('happy', 0.4);
    expressionValues.set('sad', 0.25);

    const blink = new BlinkController({ intervalRange: [0.2, 0.2], doubleBlinkProbability: 0 });
    blink.attach(vrm);
    setWriteLog.length = 0;

    for (let i = 0; i < 30; i++) {
      blink.update(vrm, 1 / 60);
    }

    for (const writtenName of setWriteLog) {
      assert.ok(
        writtenName === 'blink' || writtenName === 'blinkLeft' || writtenName === 'blinkRight',
        `BlinkController wrote non-blink expression "${writtenName}"`,
      );
    }
    assert.equal(expressionValues.get('happy'), 0.4, 'BlinkController must preserve happy expression');
    assert.equal(expressionValues.get('sad'), 0.25, 'BlinkController must preserve sad expression');

    // Peak effective blink must be attenuated by active happy=0.4 (<= 0.6) so VRoid eyes never clip
    let maxEffectiveBlink = 0;
    blink.triggerManualBlink();
    for (let i = 0; i < 20; i++) {
      blink.update(vrm, 1 / 60);
      maxEffectiveBlink = Math.max(maxEffectiveBlink, expressionValues.get('blink') ?? 0);
    }
    assert.ok(maxEffectiveBlink > 0.5 && maxEffectiveBlink <= 0.6001, `Expected attenuated peak ~0.6, got ${maxEffectiveBlink}`);
    blink.dispose();
  });

  it('guarantees absence of conflicting head rotations and zero cumulative bone drift over 60 seconds', () => {
    const { AttentionController, BreathingController, GazeController } = charMod;
    const rigA = createSyntheticVrm();
    const rigB = createSyntheticVrm();
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 50);
    camera.position.set(-0.2, 1.35, 1.6);

    // Deterministic micro-adjustments & ambient head nods off so both rigs receive identical AttentionFrameIntent
    const attnA = new AttentionController({ microAdjustmentIntervalRange: [999, 999], inactivityThresholdSeconds: 999 });
    const attnB = new AttentionController({ microAdjustmentIntervalRange: [999, 999], inactivityThresholdSeconds: 999 });
    attnA.setHeadIdleEnabled(false);
    attnB.setHeadIdleEnabled(false);

    const breathingA = new BreathingController();
    const gazeA = new GazeController({ attention: attnA });
    const gazeB = new GazeController({ attention: attnB });

    breathingA.attach(rigA.vrm);
    gazeA.attach(rigA.vrm, camera);
    gazeB.attach(rigB.vrm, camera);

    // Run 3,600 frames (60s): rigA runs Breathing + Gaze; rigB runs Gaze alone
    for (let i = 0; i < 3600; i++) {
      breathingA.update(rigA.vrm, 1 / 60);
      gazeA.update(rigA.vrm, 1 / 60);
      rigA.vrm.update(1 / 60);

      gazeB.update(rigB.vrm, 1 / 60);
      rigB.vrm.update(1 / 60);
    }

    const headNormA = rigA.vrm.humanoid.getNormalizedBoneNode('head')!.quaternion.toArray();
    const headNormB = rigB.vrm.humanoid.getNormalizedBoneNode('head')!.quaternion.toArray();
    const neckNormA = rigA.vrm.humanoid.getNormalizedBoneNode('neck')!.quaternion.toArray();
    const neckNormB = rigB.vrm.humanoid.getNormalizedBoneNode('neck')!.quaternion.toArray();

    for (let j = 0; j < 4; j++) {
      assert.ok(
        Math.abs(headNormA[j] - headNormB[j]) < 1e-3,
        `BreathingController must not conflict with GazeController head rotation (element ${j}: ${headNormA[j]} vs ${headNormB[j]})`,
      );
      assert.ok(
        Math.abs(neckNormA[j] - neckNormB[j]) < 1e-3,
        `BreathingController must not conflict with GazeController neck rotation (element ${j}: ${neckNormA[j]} vs ${neckNormB[j]})`,
      );
    }

    // Disable breathing & posture and damp back to rest: verify zero cumulative drift from identity rest
    breathingA.setEnabled(false);
    breathingA.setPostureEnabled(false);
    for (let i = 0; i < 240; i++) {
      breathingA.update(rigA.vrm, 1 / 60);
    }

    const chestQuat = rigA.vrm.humanoid.getNormalizedBoneNode('chest')!.quaternion;
    const angleDriftRad = 2 * Math.acos(Math.min(1, Math.abs(chestQuat.w)));
    assert.ok(angleDriftRad < 1e-4, `Expected zero cumulative chest drift, got ${angleDriftRad}`);
  });

  it('schedules smooth non-overlapping blinks, double blinks, split blinkLeft/Right fallback, and runs across attention states', () => {
    const { ATTENTION_STATES, AttentionController, BlinkController, BreathingController } = charMod;

    // 1. Overlap prevention & smooth envelope
    const { vrm, expressionValues } = createSyntheticVrm();
    const blink = new BlinkController({
      intervalRange: [0.35, 0.35],
      doubleBlinkProbability: 0,
    });
    blink.attach(vrm);

    assert.equal(blink.triggerManualBlink(), true, 'First manual blink should start');
    assert.equal(blink.isBlinking, true);
    assert.equal(blink.triggerManualBlink(), false, 'Overlapping manual blink must be rejected');
    assert.equal(blink.notifySaccade(), false, 'Overlapping saccade blink must be rejected');

    let sawIntermediate = false;
    let sawFullClosure = false;
    for (let i = 0; i < 20; i++) {
      blink.update(vrm, 1 / 60);
      const w = expressionValues.get('blink') ?? 0;
      if (w > 0.1 && w < 0.9) sawIntermediate = true;
      if (w >= 0.99) sawFullClosure = true;
    }
    assert.equal(sawIntermediate, true, 'Expected smooth closure/reopening weights');
    assert.equal(sawFullClosure, true, 'Expected full blink closure peak');
    assert.equal(blink.isBlinking, false, 'Expected blink sequence to return to idle');
    assert.equal(expressionValues.get('blink'), 0);

    // 2. Double-blink sequence produces two distinct peaks
    const doubleBlink = new BlinkController({
      intervalRange: [0.05, 0.05],
      doubleBlinkProbability: 1.0,
    });
    doubleBlink.attach(vrm);
    let peakTransitions = 0;
    let wasHigh = false;
    for (let i = 0; i < 45; i++) {
      doubleBlink.update(vrm, 1 / 60);
      const isHigh = (expressionValues.get('blink') ?? 0) > 0.9;
      if (isHigh && !wasHigh) {
        peakTransitions += 1;
      }
      wasHigh = isHigh;
      if (peakTransitions === 2 && !doubleBlink.isBlinking) {
        break;
      }
    }
    assert.equal(peakTransitions, 2, 'Expected two distinct closure peaks in a double blink');

    // 3. Fallback to blinkLeft + blinkRight when unified 'blink' is absent
    const splitRig = createSyntheticVrm({ includeUnifiedBlink: false });
    const splitBlink = new BlinkController({ doubleBlinkProbability: 0 });
    splitBlink.attach(splitRig.vrm);
    splitBlink.triggerManualBlink();
    for (let i = 0; i < 5; i++) {
      splitBlink.update(splitRig.vrm, 1 / 60);
    }
    assert.ok((splitRig.expressionValues.get('blinkLeft') ?? 0) > 0.8);
    assert.ok((splitRig.expressionValues.get('blinkRight') ?? 0) > 0.8);

    // 4. Breathing continues in all 5 states; blinking works in ATTENTIVE, EXPLORING, LISTENING, SPEAKING
    const attention = new AttentionController({
      inactivityThresholdSeconds: 0.2,
      attentionSeekingMinInactivitySeconds: 0.3,
    });
    const breathing = new BreathingController();
    breathing.attach(vrm);
    const stateBlink = new BlinkController({ intervalRange: [0.15, 0.15], doubleBlinkProbability: 0 });
    stateBlink.attach(vrm);

    for (const targetState of ATTENTION_STATES) {
      if (targetState === 'ATTENTIVE') attention.returnToAttentive();
      else if (targetState === 'LISTENING') attention.setConversationMode('LISTENING');
      else if (targetState === 'SPEAKING') attention.setConversationMode('SPEAKING');
      else if (targetState === 'EXPLORING') {
        attention.returnToAttentive();
        for (let k = 0; k < 20; k++) attention.update(1 / 60);
      }

      const chestBefore = vrm.humanoid.getNormalizedBoneNode('chest')!.quaternion.clone();
      let blinkedInState = false;
      for (let i = 0; i < 35; i++) {
        attention.update(1 / 60);
        breathing.update(vrm, 1 / 60);
        stateBlink.update(vrm, 1 / 60);
        if ((expressionValues.get('blink') ?? 0) > 0.5) {
          blinkedInState = true;
        }
      }
      const chestAfter = vrm.humanoid.getNormalizedBoneNode('chest')!.quaternion;
      assert.equal(chestBefore.equals(chestAfter), false, `Expected breathing in ${targetState}`);
      assert.equal(blinkedInState, true, `Expected blinking in ${targetState}`);
    }
  });

  it('freezes breathing, blinking, and gaze cleanly on pause() and continues smoothly on resume()', () => {
    const { AttentionController, BlinkController, BreathingController, GazeController } = charMod;
    const { vrm, expressionValues } = createSyntheticVrm();
    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 50);
    camera.position.set(0.3, 1.3, 1.6);

    const attention = new AttentionController();
    const breathing = new BreathingController();
    const blink = new BlinkController({ doubleBlinkProbability: 0 });
    const gaze = new GazeController({ attention });

    breathing.attach(vrm);
    blink.attach(vrm);
    gaze.attach(vrm, camera);

    // Advance mid-motion & mid-blink
    blink.triggerManualBlink();
    for (let i = 0; i < 4; i++) {
      breathing.update(vrm, 1 / 60);
      gaze.update(vrm, 1 / 60);
      blink.update(vrm, 1 / 60);
      vrm.update(1 / 60);
    }

    const pausedBlinkWeight = expressionValues.get('blink') ?? 0;
    assert.ok(pausedBlinkWeight > 0.2, 'Expected mid-blink weight prior to pause');
    const pausedChestQuat = vrm.humanoid.getNormalizedBoneNode('chest')!.quaternion.toArray();
    const pausedHeadQuat = vrm.humanoid.getNormalizedBoneNode('head')!.quaternion.toArray();

    attention.pause();
    breathing.pause();
    blink.pause();

    for (let i = 0; i < 300; i++) {
      breathing.update(vrm, 1 / 60);
      gaze.update(vrm, 1 / 60);
      blink.update(vrm, 1 / 60);
      vrm.update(1 / 60);
    }

    assert.equal(expressionValues.get('blink'), pausedBlinkWeight, 'Blink weight must freeze while paused');
    assert.deepEqual(
      vrm.humanoid.getNormalizedBoneNode('chest')!.quaternion.toArray(),
      pausedChestQuat,
      'Chest bone must freeze while paused',
    );
    assert.deepEqual(
      vrm.humanoid.getNormalizedBoneNode('head')!.quaternion.toArray(),
      pausedHeadQuat,
      'Head bone must freeze while paused',
    );

    // Resume and verify blink finishes cleanly back to 0 and bones resume motion
    attention.resume();
    breathing.resume();
    blink.resume();

    for (let i = 0; i < 20; i++) {
      breathing.update(vrm, 1 / 60);
      gaze.update(vrm, 1 / 60);
      blink.update(vrm, 1 / 60);
      vrm.update(1 / 60);
    }

    assert.equal(expressionValues.get('blink'), 0, 'Resumed blink should finish cleanly to 0');
    assert.notDeepEqual(
      vrm.humanoid.getNormalizedBoneNode('chest')!.quaternion.toArray(),
      pausedChestQuat,
      'Chest breathing should resume after resume()',
    );
  });

  it('renders development-only idle controls in dev mode and omits them when showDevControls={false}', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      act(() => {
        root.render(React.createElement(AvatarScene, { showDevControls: true }));
      });

      const devPanel = host.querySelector('.avatar-scene__dev-panel');
      assert.ok(devPanel, 'Expected development idle panel when showDevControls={true}');

      const findDevBtn = (prefix: string) => {
        const btn = Array.from(devPanel.querySelectorAll('button')).find((b) =>
          (b.textContent ?? '').trim().startsWith(prefix),
        );
        assert.ok(btn, `Expected dev button starting with "${prefix}"`);
        return btn as unknown as HTMLButtonElement;
      };

      const breathBtn = findDevBtn('Breathing:');
      const blinkBtn = findDevBtn('Blinking:');
      const headIdleBtn = findDevBtn('Head Idle:');
      const manualBlinkBtn = findDevBtn('Manual Blink');
      const manualNodBtn = findDevBtn('Manual Nod');

      assert.equal(breathBtn.getAttribute('aria-pressed'), 'true');
      act(() => {
        breathBtn.click();
        blinkBtn.click();
        headIdleBtn.click();
        manualBlinkBtn.click();
        manualNodBtn.click();
      });

      assert.equal(breathBtn.textContent?.trim(), 'Breathing: Off');
      assert.equal(blinkBtn.textContent?.trim(), 'Blinking: Off');
      assert.equal(headIdleBtn.textContent?.trim(), 'Head Idle: Off');

      // Production mode check: showDevControls={false} hides temporary dev panel completely
      act(() => {
        root.render(React.createElement(AvatarScene, { showDevControls: false }));
      });
      assert.equal(host.querySelector('.avatar-scene__dev-panel'), null);
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });
});
