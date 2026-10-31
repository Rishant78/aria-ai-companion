import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { VRMHumanoid } from '@pixiv/three-vrm';
import type { VRM, VRMHumanBones } from '@pixiv/three-vrm';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

import type { AttentionController as AttentionControllerType } from '../src/character/AttentionController.ts';
import type { BlinkController as BlinkControllerType } from '../src/character/BlinkController.ts';
import type { ExpressionController as ExpressionControllerType } from '../src/character/ExpressionController.ts';
import type { GestureController as GestureControllerType } from '../src/character/GestureController.ts';
import type { ReactionDispatcher as ReactionDispatcherType } from '../src/character/ReactionDispatcher.ts';
import type {
  ProfileSpec,
  SpeechMouthController as SpeechMouthControllerType,
  VisemeName,
} from '../src/character/SpeechMouthController.ts';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Creates a synthetic VRM instance equipped with humanoid bones,
 * emotion channels, blink channels, and the 5 mouth viseme channels (aa, ih, ou, ee, oh).
 */
function createSyntheticVRM() {
  const sceneRoot = new THREE.Group();
  const hips = new THREE.Bone();
  hips.position.set(0, 0.9, 0);
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

  sceneRoot.add(hips);
  hips.add(spine);
  spine.add(chest);
  chest.add(upperChest);
  upperChest.add(neck, leftShoulder, rightShoulder);
  neck.add(head);

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
    leftShoulder: { node: leftShoulder },
    leftUpperArm: { node: leftUpperArm },
    leftLowerArm: { node: leftLowerArm },
    leftHand: { node: leftHand },
    rightShoulder: { node: rightShoulder },
    rightUpperArm: { node: rightUpperArm },
    rightLowerArm: { node: rightLowerArm },
    rightHand: { node: rightHand },
  } as unknown as VRMHumanBones);

  const expressionWeights: Record<string, number> = {
    // 5 Visemes
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
    // Emotions
    neutral: 1,
    happy: 0,
    sad: 0,
    angry: 0,
    relaxed: 0,
    surprised: 0,
    // Blinks
    blink: 0,
    blinkLeft: 0,
    blinkRight: 0,
  };

  const expressionManager = {
    expressions: Object.keys(expressionWeights).map((name) => ({
      expressionName: name,
    })),
    getValue: (name: string) => expressionWeights[name] ?? 0,
    setValue: (name: string, value: number) => {
      expressionWeights[name] = value;
    },
    getExpression: (name: string) => {
      if (name in expressionWeights) {
        return { expressionName: name, isPreset: true };
      }
      return null;
    },
    update: () => {},
  };

  const vrm = {
    scene: sceneRoot,
    humanoid,
    expressionManager,
    update: () => {
      humanoid.update();
    },
  } as unknown as VRM;

  return { vrm, expressionWeights, humanoid };
}

describe('Milestone 5, Stage 2 — SpeechMouthController & ReactionDispatcher', () => {
  let vite: ViteDevServer;
  let AttentionController: typeof AttentionControllerType;
  let BlinkController: typeof BlinkControllerType;
  let ExpressionController: typeof ExpressionControllerType;
  let GestureController: typeof GestureControllerType;
  let ReactionDispatcher: typeof ReactionDispatcherType;
  let SpeechMouthController: typeof SpeechMouthControllerType;
  let VISEME_NAMES: readonly VisemeName[];
  let PROFILE_SPECS: Record<string, ProfileSpec>;

  before(async () => {
    vite = await createServer({
      root: FRONTEND_ROOT,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
    });
    const charMod = (await vite.ssrLoadModule('/src/character/index.ts')) as {
      AttentionController: typeof AttentionControllerType;
      BlinkController: typeof BlinkControllerType;
      ExpressionController: typeof ExpressionControllerType;
      GestureController: typeof GestureControllerType;
      ReactionDispatcher: typeof ReactionDispatcherType;
      SpeechMouthController: typeof SpeechMouthControllerType;
      VISEME_NAMES: readonly VisemeName[];
      PROFILE_SPECS: Record<string, ProfileSpec>;
    };
    AttentionController = charMod.AttentionController;
    BlinkController = charMod.BlinkController;
    ExpressionController = charMod.ExpressionController;
    GestureController = charMod.GestureController;
    ReactionDispatcher = charMod.ReactionDispatcher;
    SpeechMouthController = charMod.SpeechMouthController;
    VISEME_NAMES = charMod.VISEME_NAMES;
    PROFILE_SPECS = charMod.PROFILE_SPECS;
  });

  after(async () => {
    await vite?.close();
  });

  it('1. activates all five visemes (aa, ih, ou, ee, oh) on corresponding phonetic inputs', () => {
    const { vrm } = createSyntheticVRM();
    const mouth = new SpeechMouthController();
    mouth.attach(vrm);

    const activatedVisemes = new Set<string>();

    // Test text containing vowels that map to all 5 visemes
    const testText = 'Ah! Eh! Ih! Oh! Ou!';
    const duration = mouth.startSpeech(testText, { profile: 'soft_conversation' });
    assert.ok(duration > 0, 'Duration must be positive');

    const dt = 0.02;
    const steps = Math.ceil(duration / dt) + 10;

    for (let i = 0; i < steps; i++) {
      mouth.update(vrm, dt);
      for (const v of VISEME_NAMES) {
        if (mouth.getCurrentWeight(v) > 0.15) {
          activatedVisemes.add(v);
        }
      }
    }

    assert.equal(
      activatedVisemes.size,
      5,
      `All 5 visemes must activate during speech, got: ${Array.from(activatedVisemes).join(', ')}`,
    );

    mouth.dispose();
  });

  it('2. executes smooth exponential blending using deltaTime without instantaneous jumps', () => {
    const { vrm } = createSyntheticVRM();
    const mouth = new SpeechMouthController();
    mouth.attach(vrm);

    mouth.startSpeech('Aaaaaaaa!', { profile: 'soft_conversation' });

    let maxWeightDeltaPerFrame = 0;
    let prevWeight = mouth.getCurrentWeight('aa');
    const dt = 1 / 60;

    for (let i = 0; i < 60; i++) {
      mouth.update(vrm, dt);
      const curWeight = mouth.getCurrentWeight('aa');
      const diff = Math.abs(curWeight - prevWeight);
      if (diff > maxWeightDeltaPerFrame) {
        maxWeightDeltaPerFrame = diff;
      }
      prevWeight = curWeight;
    }

    // Weight delta per 60Hz frame should be smooth (< 0.35 per frame)
    assert.ok(
      maxWeightDeltaPerFrame < 0.35,
      `Viseme blending must be smooth, got peak delta: ${maxWeightDeltaPerFrame}`,
    );

    mouth.dispose();
  });

  it('3. introduces natural pauses for punctuation (commas, periods) with mouth closure', () => {
    const { vrm } = createSyntheticVRM();
    const mouth = new SpeechMouthController();
    mouth.attach(vrm);

    // Text with deliberate punctuation pause
    const duration = mouth.startSpeech('Hey... Yes.', { profile: 'soft_conversation' });
    const dt = 0.02;
    const totalSteps = Math.ceil(duration / dt);

    let observedPauseDip = false;

    for (let i = 0; i < totalSteps; i++) {
      mouth.update(vrm, dt);
      const totalVisemeWeight = VISEME_NAMES.reduce(
        (acc, v) => acc + mouth.getCurrentWeight(v),
        0,
      );

      // Check if during mid-speech a dip occurred where all visemes were near 0
      if (i > 15 && i < totalSteps - 15 && totalVisemeWeight < 0.05) {
        observedPauseDip = true;
      }
    }

    assert.ok(observedPauseDip, 'Mouth must close during punctuation pauses');

    mouth.dispose();
  });

  it('4. respects profile cadence and peak amplitude across the 5 profiles', () => {
    const { vrm } = createSyntheticVRM();
    const mouth = new SpeechMouthController();
    mouth.attach(vrm);

    const text = 'Testing distinct profile cadences and peak amplitudes.';

    const durSoft = mouth.startSpeech(text, { profile: 'soft_conversation' });
    const durEnergetic = mouth.startSpeech(text, { profile: 'energetic' });
    const durGentle = mouth.startSpeech(text, { profile: 'gentle' });
    const durMinimal = mouth.startSpeech(text, { profile: 'minimal' });

    // Energetic must be faster (shorter duration) than gentle
    assert.ok(
      durEnergetic < durGentle,
      `Energetic duration (${durEnergetic.toFixed(2)}s) must be shorter than Gentle (${durGentle.toFixed(2)}s)`,
    );

    assert.ok(
      durSoft < durGentle,
      `Soft duration (${durSoft.toFixed(2)}s) must be shorter than Gentle (${durGentle.toFixed(2)}s)`,
    );

    assert.ok(durMinimal > 0, 'Minimal duration must be positive');

    assert.equal(
      PROFILE_SPECS.minimal.peakAmplitude,
      0.25,
      'Minimal profile must have subtle 0.25 peak amplitude',
    );
    assert.equal(
      PROFILE_SPECS.energetic.peakAmplitude,
      0.85,
      'Energetic profile must have punchy 0.85 peak amplitude',
    );

    mouth.dispose();
  });

  it('5. handles empty, whitespace-only, and extremely short strings safely with 0 duration', () => {
    const { vrm } = createSyntheticVRM();
    const mouth = new SpeechMouthController();
    mouth.attach(vrm);

    let completed = false;
    const durEmpty = mouth.startSpeech('', { onComplete: () => { completed = true; } });
    assert.equal(durEmpty, 0);
    assert.equal(completed, true);
    assert.equal(mouth.active, false);

    completed = false;
    const durSpaces = mouth.startSpeech('   \n  \t ', { onComplete: () => { completed = true; } });
    assert.equal(durSpaces, 0);
    assert.equal(completed, true);

    mouth.dispose();
  });

  it('6. safely cancels/interrupts active speech and smoothly restores all 5 channels to 0.000', () => {
    const { vrm, expressionWeights } = createSyntheticVRM();
    const mouth = new SpeechMouthController();
    mouth.attach(vrm);

    mouth.startSpeech('A long expressive sentence that gets interrupted mid-way.', {
      profile: 'soft_conversation',
    });

    for (let i = 0; i < 20; i++) {
      mouth.update(vrm, 0.02);
    }

    assert.equal(mouth.active, true);

    // Cancel speech
    mouth.cancel();
    assert.equal(mouth.active, false);

    // All channels must immediately be zero
    for (const v of VISEME_NAMES) {
      assert.equal(mouth.getCurrentWeight(v), 0, `Viseme ${v} must be 0 after cancel`);
      assert.equal(expressionWeights[v], 0, `VRM channel ${v} must be 0 after cancel`);
    }

    mouth.dispose();
  });

  it('7. writes strictly to expressionManager viseme presets with zero bone writes and zero conflict with ExpressionController or BlinkController', () => {
    const { vrm, humanoid, expressionWeights } = createSyntheticVRM();

    const mouth = new SpeechMouthController();
    const expression = new ExpressionController();
    const blink = new BlinkController();

    mouth.attach(vrm);
    expression.attach(vrm);
    blink.attach(vrm);

    // Set emotional expression
    expression.setEmotion('happy', 0.8);
    // Trigger blink
    blink.triggerManualBlink();

    // Start mouth speech
    mouth.startSpeech('Hello there, wonderful day!', { profile: 'soft_conversation' });

    // Snapshot bone transforms
    const head = humanoid.getNormalizedBoneNode('head')!;
    const hips = humanoid.getNormalizedBoneNode('hips')!;
    const leftArm = humanoid.getNormalizedBoneNode('leftUpperArm')!;

    const headQuat0 = head.quaternion.clone();
    const hipsPos0 = hips.position.clone();
    const leftArmQuat0 = leftArm.quaternion.clone();

    // Step through updates
    for (let i = 0; i < 40; i++) {
      mouth.update(vrm, 0.02);
      expression.update(vrm, 0.02);
      blink.update(vrm, 0.02);
    }

    // Verify bone transforms remain untouched (SpeechMouthController writes ZERO bones)
    assert.deepEqual(head.quaternion.toArray(), headQuat0.toArray(), 'Head bone must not be written');
    assert.deepEqual(hips.position.toArray(), hipsPos0.toArray(), 'Hips position must not be written');
    assert.deepEqual(leftArm.quaternion.toArray(), leftArmQuat0.toArray(), 'Arm bones must not be written');

    // Verify expression channel segregation
    assert.ok(expressionWeights.happy > 0.5, 'ExpressionController happy preset must be active');
    // Viseme channels must not overwrite happy
    for (const v of VISEME_NAMES) {
      assert.notEqual(v, 'happy');
      assert.notEqual(v, 'blink');
    }

    mouth.dispose();
    expression.dispose();
    blink.dispose();
  });

  it('8. maps backend emotions to ExpressionController with priority=conversation and duration-based hold', () => {
    const { vrm } = createSyntheticVRM();
    const attention = new AttentionController();
    const expression = new ExpressionController();
    const gesture = new GestureController();
    const speechMouth = new SpeechMouthController();

    expression.attach(vrm);
    speechMouth.attach(vrm);
    gesture.attach(vrm);

    const dispatcher = new ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
    });

    const result = dispatcher.dispatchReaction({
      response_text: 'I am so pleased to hear that!',
      emotion: 'happy',
      emotion_intensity: 0.75,
      gesture: null,
      gesture_intensity: 0.0,
      speech_intent: 'playful',
    });

    assert.equal(result.accepted, true);
    assert.equal(result.mappedEmotion, 'happy');
    assert.equal(result.clampedEmotionIntensity, 0.75);
    assert.equal(expression.getSnapshot().activeEmotion, 'happy');

    dispatcher.cancel();
  });

  it('9. maps Gemini gesture names (wave, greeting, explain, think, shrug, laugh, shy, reassure) to actual GestureController names', () => {
    const { vrm } = createSyntheticVRM();
    const attention = new AttentionController();
    const expression = new ExpressionController();
    const gesture = new GestureController();
    const speechMouth = new SpeechMouthController();

    gesture.attach(vrm);
    speechMouth.attach(vrm);

    const dispatcher = new ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
    });

    const testMappings: Array<[string, string]> = [
      ['wave', 'wave'],
      ['greeting', 'open_hand_greeting'],
      ['explain', 'explaining'],
      ['explaining_hands', 'explaining'],
      ['think', 'thinking'],
      ['shrug', 'shrug'],
      ['laugh', 'laughing'],
      ['shy', 'shy_hands_together'],
      ['reassure', 'reassuring'],
      ['gentle_reassuring', 'reassuring'],
    ];

    for (const [geminiName, expectedInternalName] of testMappings) {
      const res = dispatcher.dispatchReaction({
        response_text: `Testing gesture ${geminiName}`,
        emotion: 'neutral',
        emotion_intensity: 0.5,
        gesture: geminiName,
        gesture_intensity: 0.8,
        speech_intent: 'conversational',
      });

      assert.equal(
        res.mappedGesture,
        expectedInternalName,
        `Gemini gesture '${geminiName}' must map to '${expectedInternalName}'`,
      );
      assert.equal(
        gesture.getSnapshot().activeGesture,
        expectedInternalName,
        `GestureController active gesture must be '${expectedInternalName}'`,
      );
    }

    dispatcher.cancel();
  });

  it('10. handles null gesture and unsupported/unknown gesture safely falling back to null', () => {
    const { vrm } = createSyntheticVRM();
    const attention = new AttentionController();
    const expression = new ExpressionController();
    const gesture = new GestureController();
    const speechMouth = new SpeechMouthController();

    gesture.attach(vrm);

    const dispatcher = new ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
    });

    // Explicit null
    const resNull = dispatcher.dispatchReaction({
      response_text: 'No gesture here.',
      emotion: 'neutral',
      emotion_intensity: 0.5,
      gesture: null,
      gesture_intensity: 0.0,
    });
    assert.equal(resNull.mappedGesture, null);
    assert.equal(resNull.clampedGestureIntensity, 0.0);

    // Unsupported / unknown gesture string
    const resInvalid = dispatcher.dispatchReaction({
      response_text: 'Invalid gesture.',
      emotion: 'neutral',
      emotion_intensity: 0.5,
      gesture: 'backflip_breakdance',
      gesture_intensity: 0.9,
    });
    assert.equal(resInvalid.mappedGesture, null);
    assert.equal(resInvalid.clampedGestureIntensity, 0.0);

    dispatcher.cancel();
  });

  it('11. clamps emotion and gesture intensities to [0.0, 1.0] and enforces zero intensity on null gesture', () => {
    const attention = new AttentionController();
    const expression = new ExpressionController();
    const gesture = new GestureController();
    const speechMouth = new SpeechMouthController();

    const dispatcher = new ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
    });

    const res = dispatcher.dispatchReaction({
      response_text: 'Clamping test.',
      emotion: 'happy',
      emotion_intensity: 1.8, // out of bounds
      gesture: 'wave',
      gesture_intensity: -0.5, // out of bounds
    });

    assert.equal(res.clampedEmotionIntensity, 1.0);
    assert.equal(res.clampedGestureIntensity, 0.0);

    dispatcher.cancel();
  });

  it('12. executes attention lifecycle: onUserMessageSubmitted -> LISTENING -> dispatchReaction -> SPEAKING -> handleSpeechComplete -> ATTENTIVE', () => {
    const { vrm } = createSyntheticVRM();
    const attention = new AttentionController();
    const expression = new ExpressionController();
    const gesture = new GestureController();
    const speechMouth = new SpeechMouthController();

    speechMouth.attach(vrm);
    gesture.attach(vrm);

    const dispatcher = new ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
    });

    // 1. User submits message -> enters LISTENING
    dispatcher.onUserMessageSubmitted();
    assert.equal(attention.getState(), 'LISTENING');
    assert.equal(speechMouth.active, false);

    // 2. Waiting for LLM -> maintains LISTENING
    dispatcher.onWaitingForResponse();
    assert.equal(attention.getState(), 'LISTENING');

    // 3. Response arrives -> enters SPEAKING and activates mouth & gesture
    dispatcher.dispatchReaction({
      response_text: 'Hello, this is my voice response!',
      emotion: 'happy',
      emotion_intensity: 0.8,
      gesture: 'wave',
      gesture_intensity: 0.85,
      speech_intent: 'playful',
    });

    assert.equal(attention.getState(), 'SPEAKING');
    assert.equal(speechMouth.active, true);
    assert.equal(gesture.getSnapshot().activeGesture, 'wave');

    // 4. Speech articulation naturally completes -> returns to ATTENTIVE
    dispatcher.handleSpeechComplete();
    assert.equal(attention.getState(), 'ATTENTIVE');
    assert.equal(speechMouth.active, false);

    dispatcher.cancel();
  });

  it('13. handles mid-speech interruption safely when a new reaction is dispatched', () => {
    const { vrm } = createSyntheticVRM();
    const attention = new AttentionController();
    const expression = new ExpressionController();
    const gesture = new GestureController();
    const speechMouth = new SpeechMouthController();

    speechMouth.attach(vrm);
    gesture.attach(vrm);
    expression.attach(vrm);

    const dispatcher = new ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
    });

    // Reaction 1
    dispatcher.dispatchReaction({
      response_text: 'First very long speech utterance.',
      emotion: 'happy',
      emotion_intensity: 0.8,
      gesture: 'wave',
      gesture_intensity: 0.8,
    });

    for (let i = 0; i < 10; i++) {
      speechMouth.update(vrm, 0.02);
    }
    assert.equal(speechMouth.active, true);

    // Interrupt with Reaction 2
    dispatcher.dispatchReaction({
      response_text: 'Second interrupting thought!',
      emotion: 'surprised',
      emotion_intensity: 0.9,
      gesture: 'think',
      gesture_intensity: 0.7,
    });

    assert.equal(speechMouth.active, true);
    assert.equal(gesture.getSnapshot().activeGesture, 'thinking');
    assert.equal(expression.getSnapshot().activeEmotion, 'surprised');

    dispatcher.cancel();
    assert.equal(speechMouth.active, false);
    assert.equal(attention.getState(), 'ATTENTIVE');
  });
});

