import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
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
import type * as CharacterTypes from '../src/character/index.ts';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(TEST_DIR, '..');

type CharacterModule = typeof CharacterTypes;

function createSyntheticVRM() {
  const sceneRoot = new THREE.Group();
  const hips = new THREE.Bone(); hips.position.set(0, 0.9, 0);
  const spine = new THREE.Bone(); spine.position.set(0, 0.14, 0);
  const chest = new THREE.Bone(); chest.position.set(0, 0.14, 0);
  const upperChest = new THREE.Bone(); upperChest.position.set(0, 0.12, 0);
  const neck = new THREE.Bone(); neck.position.set(0, 0.1, 0);
  const head = new THREE.Bone(); head.position.set(0, 0.09, 0);
  const leftEye = new THREE.Bone(); leftEye.position.set(0.03, 0.06, 0.08);
  const rightEye = new THREE.Bone(); rightEye.position.set(-0.03, 0.06, 0.08);

  sceneRoot.add(hips);
  hips.add(spine);
  spine.add(chest);
  chest.add(upperChest);
  upperChest.add(neck);
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
  } as any);

  const rangeMap = new VRMLookAtRangeMap(90, 10);
  const applier = new VRMLookAtBoneApplier(humanoid, rangeMap, rangeMap, rangeMap, rangeMap);
  const lookAt = new VRMLookAt(humanoid, applier);

  const expressionsList = [
    { expressionName: 'happy' },
    { expressionName: 'relaxed' },
    { expressionName: 'sad' },
    { expressionName: 'angry' },
    { expressionName: 'surprised' },
    { expressionName: 'neutral' },
    { expressionName: 'curious' },
    { expressionName: 'confused' },
    { expressionName: 'blink' },
    { expressionName: 'aa' },
    { expressionName: 'ih' },
    { expressionName: 'ou' },
    { expressionName: 'ee' },
    { expressionName: 'oh' },
  ];

  const exprValues = new Map<string, number>();
  for (const item of expressionsList) {
    exprValues.set(item.expressionName, 0);
  }

  const expressionManager = {
    expressions: expressionsList,
    getExpression: (name: string) => (exprValues.has(name) ? { expressionName: name } : null),
    getValue: (name: string) => exprValues.get(name) ?? null,
    setValue: (name: string, weight: number) => {
      exprValues.set(name, weight);
    },
    update: () => {},
  };

  const vrm = {
    scene: sceneRoot,
    humanoid,
    lookAt,
    expressionManager,
    update: (dt: number) => {
      lookAt.update(dt);
    },
  } as unknown as VRM;

  return { vrm, neck, head, exprValues };
}

describe('Head Tilt Refinement — More Expressive Natural Head Movement', () => {
  let vite: ViteDevServer;
  let char: CharacterModule;

  before(async () => {
    vite = await createServer({
      root: FRONTEND_ROOT,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
    });
    char = (await vite.ssrLoadModule('/src/character/index.ts')) as CharacterModule;
  });

  after(async () => {
    await vite?.close();
  });

  it('1. scales autonomous head tilt amplitudes by ~1.5–1.8x across exploration, seeking attention, and attentive idle', () => {
    const attention = new char.AttentionController({
      inactivityThresholdSeconds: 30,
      explorationHeadTiltProbability: 1.0, // Force tilt on every decision to measure amplitude
    });

    // A. Attentive ambient idle roll amplitude
    let maxAmbientIdleRoll = 0;
    for (let i = 0; i < 1500; i++) {
      const intent = attention.update(1 / 60);
      maxAmbientIdleRoll = Math.max(maxAmbientIdleRoll, Math.abs(intent.headTiltRollRad));
    }
    // Baseline was 0.026 rad; new target reaches ~0.042 rad (~1.62x)
    assert.ok(
      maxAmbientIdleRoll >= 0.038 && maxAmbientIdleRoll <= 0.045,
      `Expected ambient idle roll peak ~0.042 rad, got ${maxAmbientIdleRoll}`,
    );

    // B. Listening mode initial and periodic tilt amplitudes
    attention.setHeadIdleEnabled(false);
    attention.setConversationMode('LISTENING');
    const listeningIntent = attention.update(1 / 60);
    // Baseline listening roll was 0.045 rad; new target is 0.080 rad (~1.78x)
    assert.ok(
      Math.abs(listeningIntent.headTiltRollRad) >= 0.075 &&
        Math.abs(listeningIntent.headTiltRollRad) <= 0.085,
      `Expected listening entry roll ~0.080 rad, got ${listeningIntent.headTiltRollRad}`,
    );
    attention.setHeadIdleEnabled(true);

    // C. Exploration mode tilt amplitude
    attention.returnToAttentive();
    for (let i = 0; i < 35 * 60; i++) {
      attention.update(1 / 60);
    }
    assert.equal(attention.getState(), 'EXPLORING');

    // Sample exploration decisions to verify tilt range [0.085, 0.170] rad (~1.65x baseline)
    let seenTiltAboveBaseline = false;
    let seenLeftTilt = false;
    let seenRightTilt = false;

    for (let i = 0; i < 50; i++) {
      (attention as unknown as { pickNextExplorationDecision: () => void }).pickNextExplorationDecision();
      const intent = attention.update(1 / 60);
      const roll = intent.headTiltRollRad;
      if (Math.abs(roll) >= 0.080) {
        seenTiltAboveBaseline = true;
      }
      if (roll > 0.05) seenLeftTilt = true;
      if (roll < -0.05) seenRightTilt = true;
    }

    assert.ok(seenTiltAboveBaseline, 'Expected exploration tilt amplitude to exceed 0.080 rad (1.6x baseline)');
    assert.ok(seenLeftTilt, 'Expected occasional left head tilt in exploration');
    assert.ok(seenRightTilt, 'Expected occasional right head tilt in exploration');

    // D. Seeking attention tilt amplitude
    attention.returnToAttentive();
    (attention as unknown as { inactivitySeconds: number }).inactivitySeconds = 60;
    (attention as unknown as { enterSeekingAttention: () => void }).enterSeekingAttention();
    assert.equal(attention.getState(), 'SEEKING_ATTENTION');
    const seekingIntent = attention.update(1 / 60);
    assert.ok(
      Math.abs(seekingIntent.headTiltRollRad) >= 0.040,
      `Expected non-trivial seeking attention head tilt, got ${seekingIntent.headTiltRollRad}`,
    );
  });

  it('2. verifies increased head roll amplitudes across all AutonomousActivityLibrary activities and gesture definitions', () => {
    const library = new char.AutonomousActivityEvaluator();

    // Relaxed settle: execution head roll target was 0.036; new is 0.060 (1.67x)
    const settleFrame = library.evaluate('relaxed_posture_settle', 'execution', 0.5, 1, 1.0);
    assert.ok(
      Math.abs(settleFrame.headOffset.rollRad ?? 0) >= 0.055,
      `Expected relaxed_posture_settle head roll >= 0.055 rad, got ${settleFrame.headOffset.rollRad}`,
    );

    // Weight shift browse: execution head roll target was 0.048; new is 0.080 (1.67x)
    const browseFrame = library.evaluate('weight_shift_browse', 'execution', 0.5, 1, 1.0);
    assert.ok(
      Math.abs(browseFrame.headOffset.rollRad ?? 0) >= 0.075,
      `Expected weight_shift_browse head roll >= 0.075 rad, got ${browseFrame.headOffset.rollRad}`,
    );

    // Shoulder rolls: execution head roll target was 0.024; new is 0.040 (1.67x)
    const shoulderFrame = library.evaluate('shoulder_rolls', 'execution', 0.25, 1, 1.0);
    assert.ok(
      Math.abs(shoulderFrame.headOffset.rollRad ?? 0) >= 0.035,
      `Expected shoulder_rolls head roll >= 0.035 rad, got ${shoulderFrame.headOffset.rollRad}`,
    );

    // Gentle side stretch: execution head roll target was -0.052; new is -0.086 (1.65x)
    const sideStretchFrame = library.evaluate('gentle_side_stretch', 'execution', 0.5, 1, 1.0);
    assert.ok(
      Math.abs(sideStretchFrame.headOffset.rollRad ?? 0) >= 0.080,
      `Expected gentle_side_stretch head roll >= 0.080 rad, got ${sideStretchFrame.headOffset.rollRad}`,
    );

    // Overhead stretch: execution head roll target was 0.022; new is 0.038 (1.73x)
    const overheadFrame = library.evaluate('overhead_stretch', 'execution', 0.5, 1, 1.0);
    assert.ok(
      Math.abs(overheadFrame.headOffset.rollRad ?? 0) >= 0.032,
      `Expected overhead_stretch head roll >= 0.032 rad, got ${overheadFrame.headOffset.rollRad}`,
    );

    // Gesture definitions head accents
    assert.ok(
      Math.abs(char.GESTURE_DEFINITIONS.thinking.headAccent.rollRad ?? 0) >= 0.11,
      `Expected thinking gesture headAccent rollRad >= 0.11, got ${char.GESTURE_DEFINITIONS.thinking.headAccent.rollRad}`,
    );
    assert.ok(
      Math.abs(char.GESTURE_DEFINITIONS.shrug.headAccent.rollRad ?? 0) >= 0.09,
      `Expected shrug gesture headAccent rollRad >= 0.09, got ${char.GESTURE_DEFINITIONS.shrug.headAccent.rollRad}`,
    );
    assert.ok(
      Math.abs(char.GESTURE_DEFINITIONS.shy_hands_together.headAccent.rollRad ?? 0) >= 0.10,
      `Expected shy gesture headAccent rollRad >= 0.10, got ${char.GESTURE_DEFINITIONS.shy_hands_together.headAccent.rollRad}`,
    );
    assert.ok(
      Math.abs(char.GESTURE_DEFINITIONS.wave.headAccent.rollRad ?? 0) >= 0.065,
      `Expected wave gesture headAccent rollRad >= 0.065, got ${char.GESTURE_DEFINITIONS.wave.headAccent.rollRad}`,
    );
  });

  it('3. produces distinguishable, expressive head tilts on curious and confused reactions, and omits tilts on neutral/sad', () => {
    const attention = new char.AttentionController();
    const expression = new char.ExpressionController();
    const gesture = new char.GestureController();
    const speechMouth = new char.SpeechMouthController();

    const dispatcher = new char.ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
    });

    // Disable ambient head idle so we measure emotional head tilt directly
    attention.setHeadIdleEnabled(false);

    // A. Curious reaction produces pronounced inquisitive head tilt (~0.14 - 0.18 rad) with slight pitch lift
    dispatcher.dispatchReaction({
      response_text: 'Oh? Tell me more about that!',
      emotion: 'curious',
      emotion_intensity: 0.85,
      gesture: null,
    });

    for (let i = 0; i < 30; i++) {
      attention.update(1 / 60);
    }
    const curiousIntent = attention.update(1 / 60);
    const curiousRoll = Math.abs(curiousIntent.headTiltRollRad);
    assert.ok(
      curiousRoll >= 0.12 && curiousRoll <= 0.20,
      `Expected curious head tilt in [0.12, 0.20] rad, got ${curiousRoll}`,
    );
    assert.ok(
      curiousIntent.headNodPitchRad < 0,
      `Expected curious reaction to produce slight upward inquisitive pitch lift (< 0), got ${curiousIntent.headNodPitchRad}`,
    );

    // B. Confused reaction produces distinct puzzled head tilt (~0.15 - 0.20 rad) with slight dip
    dispatcher.dispatchReaction({
      response_text: 'Wait, I am not quite following...',
      emotion: 'confused',
      emotion_intensity: 0.9,
      gesture: null,
    });

    for (let i = 0; i < 30; i++) {
      attention.update(1 / 60);
    }
    const confusedIntent = attention.update(1 / 60);
    const confusedRoll = Math.abs(confusedIntent.headTiltRollRad);
    assert.ok(
      confusedRoll >= 0.13 && confusedRoll <= 0.22,
      `Expected confused head tilt in [0.13, 0.22] rad, got ${confusedRoll}`,
    );
    assert.ok(
      confusedIntent.headNodPitchRad > 0,
      `Expected confused reaction to produce slight puzzled downward dip (> 0), got ${confusedIntent.headNodPitchRad}`,
    );

    // C. Neutral / Ordinary reactions do NOT force an emotional head tilt
    dispatcher.dispatchReaction({
      response_text: 'The weather today is clear.',
      emotion: 'neutral',
      emotion_intensity: 0.5,
      gesture: null,
    });

    for (let i = 0; i < 60; i++) {
      attention.update(1 / 60);
    }
    const neutralIntent = attention.update(1 / 60);
    assert.ok(
      Math.abs(neutralIntent.headTiltRollRad) < 0.02,
      `Neutral reaction must not force a head tilt, got ${neutralIntent.headTiltRollRad}`,
    );

    // D. Sad reaction also does not force a lateral tilt
    dispatcher.dispatchReaction({
      response_text: 'I understand, that must be hard.',
      emotion: 'sad',
      emotion_intensity: 0.7,
      gesture: null,
    });
    for (let i = 0; i < 60; i++) {
      attention.update(1 / 60);
    }
    const sadIntent = attention.update(1 / 60);
    assert.ok(
      Math.abs(sadIntent.headTiltRollRad) < 0.02,
      `Sad reaction must not force a lateral head tilt, got ${sadIntent.headTiltRollRad}`,
    );

    // E. Speech completion and cancel cleanly clear emotional head accent
    dispatcher.dispatchReaction({
      response_text: 'Curious again!',
      emotion: 'curious',
      emotion_intensity: 0.8,
      gesture: null,
    });
    for (let i = 0; i < 20; i++) {
      attention.update(1 / 60);
    }
    assert.ok(Math.abs(attention.update(0).headTiltRollRad) > 0.05);

    dispatcher.cancel();
    assert.equal(attention.getState(), 'ATTENTIVE');
    const intentAfterCancel = attention.update(0);
    assert.equal(intentAfterCancel.headTiltRollRad, 0);
  });

  it('4. coordinates camera-relative head roll with head yaw/pitch, preserves eye tracking, and returns smoothly to front', () => {
    const { vrm } = createSyntheticVRM();
    const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 50);
    // Camera positioned to the character left (+X local)
    camera.position.set(0.6, 1.4, 1.2);

    const attention = new char.AttentionController({ inactivityThresholdSeconds: 999 });
    attention.setHeadIdleEnabled(false);
    const gaze = new char.GazeController({ attention });
    gaze.attach(vrm, camera);

    for (let i = 0; i < 60; i++) {
      gaze.update(vrm, 1 / 60);
    }

    const headQuat = vrm.humanoid.getNormalizedBoneNode('head')!.quaternion;
    const neckQuat = vrm.humanoid.getNormalizedBoneNode('neck')!.quaternion;

    const headEuler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    const neckEuler = new THREE.Euler().setFromQuaternion(neckQuat, 'YXZ');

    // Both neck and head should turn horizontally toward camera
    assert.ok(headEuler.y > 0.05, `Expected head yaw > 0.05, got ${headEuler.y}`);
    assert.ok(neckEuler.y > 0.02, `Expected neck yaw > 0.02, got ${neckEuler.y}`);

    // Natural coupled roll banking must be present
    const totalRoll = headEuler.z + neckEuler.z;
    assert.ok(
      Math.abs(totalRoll) > 0.015,
      `Expected non-zero coupled camera head roll, got ${totalRoll}`,
    );

    // Camera returns directly to front
    camera.position.set(0, 1.4, 1.5);
    for (let i = 0; i < 90; i++) {
      gaze.update(vrm, 1 / 60);
    }

    const frontHeadEuler = new THREE.Euler().setFromQuaternion(
      vrm.humanoid.getNormalizedBoneNode('head')!.quaternion,
      'YXZ',
    );
    const frontNeckEuler = new THREE.Euler().setFromQuaternion(
      vrm.humanoid.getNormalizedBoneNode('neck')!.quaternion,
      'YXZ',
    );

    assert.ok(
      Math.abs(frontHeadEuler.z) < 0.005,
      `Expected head roll to return smoothly to zero when camera returns to front, got ${frontHeadEuler.z}`,
    );
    assert.ok(
      Math.abs(frontNeckEuler.z) < 0.005,
      `Expected neck roll to return smoothly to zero when camera returns to front, got ${frontNeckEuler.z}`,
    );

    assert.ok(vrm.lookAt, 'VRMLookAt must be present and active');
    gaze.dispose();
  });

  it('5. strictly enforces anatomical limits under extreme multi-source combination and preserves single-writer bone ownership', () => {
    const { vrm } = createSyntheticVRM();
    const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 50);
    camera.position.set(2.0, 1.8, 0.8);

    const attention = new char.AttentionController();
    const gaze = new char.GazeController({ attention });
    gaze.attach(vrm, camera);

    attention.setActivityHeadOffset({ rollRad: 0.24, pitchRad: 0.1 });
    attention.setGestureHeadAccent({ rollRad: 0.22, pitchRad: 0.08 });
    attention.setEmotionalHeadAccent({ rollRad: 0.25, pitchRad: -0.05, holdSeconds: 10 });

    for (let i = 0; i < 120; i++) {
      gaze.update(vrm, 1 / 60);
    }

    const headQuat = vrm.humanoid.getNormalizedBoneNode('head')!.quaternion;
    const neckQuat = vrm.humanoid.getNormalizedBoneNode('neck')!.quaternion;

    const headEuler = new THREE.Euler().setFromQuaternion(headQuat, 'YXZ');
    const neckEuler = new THREE.Euler().setFromQuaternion(neckQuat, 'YXZ');
    const totalRollRad = Math.abs(headEuler.z + neckEuler.z);

    assert.ok(
      totalRollRad <= char.MAX_HEAD_ROLL_ANATOMICAL_RAD + 0.005,
      `Total head roll (${totalRollRad}) must not exceed MAX_HEAD_ROLL_ANATOMICAL_RAD (${char.MAX_HEAD_ROLL_ANATOMICAL_RAD})`,
    );

    assert.ok(Number.isFinite(headQuat.x) && Number.isFinite(headQuat.w));
    assert.ok(Number.isFinite(neckQuat.x) && Number.isFinite(neckQuat.w));
    assert.ok(Math.abs(headQuat.length() - 1.0) < 1e-4, 'Head quaternion must be normalized');
    assert.ok(Math.abs(neckQuat.length() - 1.0) < 1e-4, 'Neck quaternion must be normalized');

    gaze.dispose();
  });
});
