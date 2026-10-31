import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

import type * as CharacterBarrel from '../src/character/index.ts';
import type { UseAttentionSystemOptions, UseAttentionSystemResult } from '../src/hooks/useAttentionSystem.ts';

type CharacterBarrelModule = typeof CharacterBarrel;

interface AvatarSceneProps {
  attentionSystem?: unknown;
  controllers?: unknown;
  showHud?: boolean;
  showDevControls?: boolean;
  [key: string]: unknown;
}

interface AvatarSceneModule {
  AvatarScene: React.ComponentType<AvatarSceneProps>;
}

interface AttentionHookModule {
  useAttentionSystem: (options?: UseAttentionSystemOptions) => UseAttentionSystemResult;
}

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(TEST_DIR, '..');
const COMPANION_VRM_PATH = path.resolve(FRONTEND_ROOT, 'public/models/companion.vrm');

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

function createDeterministicRng(seed = 123456789): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('Milestone 6 — Autonomous Full-Body Behaviour & Gesture Reliability', () => {
  let vite: ViteDevServer;
  let charMod: CharacterBarrelModule;
  let AvatarScene: AvatarSceneModule['AvatarScene'];
  let useAttentionSystem: AttentionHookModule['useAttentionSystem'];
  let createRootFn: (container: Element | DocumentFragment) => Root;
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
    const reactDomClient = await import('react-dom/client');
    createRootFn = reactDomClient.createRoot;

    vite = await createServer({
      root: FRONTEND_ROOT,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
      plugins: [
        {
          name: 'mock-avatar-viewer-ready-m6',
          enforce: 'pre',
          resolveId(id) {
            if (id.endsWith('/hooks/useAvatarViewer') || id === '../hooks/useAvatarViewer') {
              return '\0virtual:useAvatarViewerM6';
            }
            return null;
          },
          load(id) {
            if (id === '\0virtual:useAvatarViewerM6') {
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
                    framingMode: 'full',
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
    const hookMod = (await vite.ssrLoadModule('/src/hooks/useAttentionSystem.ts')) as AttentionHookModule;
    useAttentionSystem = hookMod.useAttentionSystem;
  });

  after(async () => {
    await vite?.close();
    await happyWindow?.happyDOM.close();
  });

  function createFullControllerRig(rng?: () => number, stillnessProbability = 0.25) {
    companionVrm.humanoid.resetNormalizedPose();
    const hips = companionVrm.humanoid.getNormalizedBoneNode('hips');
    if (hips) {
      hips.position.set(0, 0.901, 0.004);
      hips.quaternion.identity();
    }
    companionVrm.scene.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 50);
    camera.position.set(0, 1.32, 2.6);
    camera.lookAt(0, 1.25, 0);
    camera.updateMatrixWorld(true);

    const attention = new charMod.AttentionController();
    const breathing = new charMod.BreathingController();
    const naturalIdle = new charMod.NaturalIdleController();
    const expression = new charMod.ExpressionController();
    const blink = new charMod.BlinkController();
    const speechMouth = new charMod.SpeechMouthController();
    const gaze = new charMod.GazeController({
      attention,
      onSaccadeBlinkSuggestion: () => blink.notifySaccade(),
    });
    const gesture = new charMod.GestureController({
      onUpperBodyOffset: (offset) => breathing.setGestureOffset(offset),
      onHeadAccent: (accent) => attention.setGestureHeadAccent(accent),
    });
    naturalIdle.setPelvicOffsetHandler((offset) => breathing.setPelvicOffset(offset));

    const scheduler = new charMod.AutonomousActivityScheduler({
      attention,
      breathing,
      naturalIdle,
      gesture,
      expression,
      speechMouth,
      rng,
      config: {
        decisionIntervalRangeSeconds: [4.0, 6.0],
        stillnessIntervalRangeSeconds: [3.0, 4.0],
        stillnessProbability,
      },
    });

    const dispatcher = new charMod.ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
      naturalIdle,
      activityScheduler: scheduler,
    });

    scheduler.attach(companionVrm);
    naturalIdle.attach(companionVrm);
    gesture.attach(companionVrm);
    breathing.attach(companionVrm);
    gaze.attach(companionVrm, camera);
    expression.attach(companionVrm);
    speechMouth.attach(companionVrm);
    blink.attach(companionVrm);

    let elapsed = 0;
    const step = (dt: number) => {
      elapsed += dt;
      scheduler.update(companionVrm, dt);
      naturalIdle.update(companionVrm, dt);
      gesture.update(companionVrm, dt, elapsed);
      breathing.update(companionVrm, dt);
      gaze.update(companionVrm, dt);
      expression.update(companionVrm, dt);
      speechMouth.update(companionVrm, dt);
      blink.update(companionVrm, dt);
      companionVrm.scene.updateMatrixWorld(true);
    };

    const disposeAll = () => {
      scheduler.dispose();
      naturalIdle.dispose();
      gesture.dispose();
      breathing.dispose();
      gaze.dispose();
      expression.dispose();
      speechMouth.dispose();
      blink.dispose();
      attention.dispose();
    };

    return {
      camera,
      attention,
      breathing,
      naturalIdle,
      expression,
      blink,
      speechMouth,
      gaze,
      gesture,
      scheduler,
      dispatcher,
      step,
      disposeAll,
    };
  }

  it('1. fixes incomplete conversational gestures: short spoken replies do not truncate gestures at speech end', () => {
    const rig = createFullControllerRig();
    try {
      // Short utterance ("Hi!") has speechDuration ~0.5s, whereas 'wave' takes ~2.37s total
      const res = rig.dispatcher.dispatchReaction({
        response_text: 'Hi!',
        emotion: 'happy',
        emotion_intensity: 0.8,
        gesture: 'wave',
        gesture_intensity: 0.9,
        speech_intent: 'excited',
      });

      assert.ok(
        res.speechDurationSeconds < 1.2,
        `Expected short utterance duration < 1.2s, got ${res.speechDurationSeconds}`,
      );
      assert.equal(rig.gesture.getActiveGesture(), 'wave');
      assert.equal(rig.gesture.getPhase(), 'attack');

      const seenPhases = new Set<string>([rig.gesture.getPhase()]);
      let speechCompletedAtStep = -1;
      let maxWaveWristDisplacement = 0;
      const restRightHandQ = rig.gesture.getRestBoneQuaternion('rightHand');

      // Step through 3.2s at 60 FPS
      for (let i = 0; i < 192; i++) {
        rig.step(1 / 60);
        seenPhases.add(rig.gesture.getPhase());

        if (!rig.speechMouth.active && speechCompletedAtStep === -1) {
          speechCompletedAtStep = i;
          // Crucial fix verification: when speechMouth finishes early, gesture MUST still be active!
          assert.equal(rig.attention.getState(), 'ATTENTIVE');
          assert.equal(
            rig.gesture.getActiveGesture(),
            'wave',
            'Conversational gesture must NOT be truncated when short speech articulation finishes',
          );
          assert.ok(
            rig.gesture.getPhase() === 'attack' || rig.gesture.getPhase() === 'sustain',
            `Expected wave to still be in attack/sustain at speech completion, got ${rig.gesture.getPhase()}`,
          );
        }

        const liveHandQ = rig.gesture.getBoneQuaternion('rightHand');
        maxWaveWristDisplacement = Math.max(
          maxWaveWristDisplacement,
          quatAngleRad(restRightHandQ, liveHandQ),
        );
      }

      assert.ok(speechCompletedAtStep > 0, 'Expected speech articulation to finish during simulation');
      assert.equal(seenPhases.has('attack'), true, 'Expected attack phase');
      assert.equal(seenPhases.has('sustain'), true, 'Expected sustain phase to be reached and completed');
      assert.equal(seenPhases.has('release'), true, 'Expected natural release phase');
      assert.equal(rig.gesture.getPhase(), 'idle', 'Expected gesture to return naturally to idle');
      assert.ok(maxWaveWristDisplacement > 0.45, 'Expected full wave amplitude to execute');
      assert.equal(rig.gesture.areLimbsAtRest(1e-3), true, 'Expected limbs to settle back to rest');
    } finally {
      rig.disposeAll();
    }
  });

  it('2. preserves gestures across user messages / null-gesture replies and blends smoothly on explicit interruption', () => {
    const rig = createFullControllerRig();
    try {
      rig.dispatcher.dispatchReaction({
        response_text: 'Let me think carefully about that.',
        emotion: 'curious',
        emotion_intensity: 0.7,
        gesture: 'thinking',
        gesture_intensity: 0.9,
      });

      // Advance 0.6s into sustain
      for (let i = 0; i < 36; i++) {
        rig.step(1 / 60);
      }
      assert.equal(rig.gesture.getActiveGesture(), 'thinking');
      assert.equal(rig.gesture.getPhase(), 'sustain');

      // Submitting a follow-up user message must NOT abruptly cancel the active gesture
      rig.dispatcher.onUserMessageSubmitted();
      assert.equal(rig.attention.getState(), 'LISTENING');
      assert.equal(rig.gesture.getActiveGesture(), 'thinking');
      assert.equal(rig.gesture.getPhase(), 'sustain');

      // A Gemini reply with gesture: null must NOT cancel the in-flight gesture
      rig.dispatcher.dispatchReaction({
        response_text: 'Still pondering.',
        emotion: 'neutral',
        emotion_intensity: 0.4,
        gesture: null,
        gesture_intensity: 0,
      });
      assert.equal(rig.gesture.getActiveGesture(), 'thinking');
      assert.equal(rig.gesture.getPhase(), 'sustain');

      // A Gemini reply with a NEW gesture ('explaining') blends smoothly from live quaternions without snapping
      const preBlendUpperQ = rig.gesture.getBoneQuaternion('rightUpperArm');
      rig.dispatcher.dispatchReaction({
        response_text: 'Here is the explanation!',
        emotion: 'happy',
        emotion_intensity: 0.8,
        gesture: 'explaining',
        gesture_intensity: 0.95,
      });
      assert.equal(rig.gesture.getActiveGesture(), 'explaining');
      assert.equal(rig.gesture.getPhase(), 'attack');

      rig.step(1 / 60);
      const postFirstStepUpperQ = rig.gesture.getBoneQuaternion('rightUpperArm');
      const singleFrameJumpRad = quatAngleRad(preBlendUpperQ, postFirstStepUpperQ);
      assert.ok(
        singleFrameJumpRad <= (5.6 / 60) + 1e-4,
        `Expected velocity-bounded blend without snap (<= ${(5.6 / 60).toFixed(4)} rad), got ${singleFrameJumpRad}`,
      );

      // Explicit cancel() blends smoothly through 'release' rather than snapping immediately
      for (let i = 0; i < 25; i++) {
        rig.step(1 / 60);
      }
      const beforeCancelQ = rig.gesture.getBoneQuaternion('leftUpperArm');
      rig.dispatcher.cancel();
      assert.equal(rig.gesture.getPhase(), 'release');
      rig.step(1 / 60);
      const afterCancelStepQ = rig.gesture.getBoneQuaternion('leftUpperArm');
      assert.ok(
        quatAngleRad(beforeCancelQ, afterCancelStepQ) <= (5.6 / 60) + 1e-4,
        'Expected graceful release blend on explicit cancel without snapping',
      );
    } finally {
      rig.disposeAll();
    }
  });

  it('3. schedules tiered autonomous activities, respects stillness windows, avoids repetition, and enforces cooldowns', () => {
    // Verify updated inactivity tier thresholds
    assert.equal(charMod.INACTIVITY_TIER_THRESHOLDS.short, 3);
    assert.equal(charMod.INACTIVITY_TIER_THRESHOLDS.moderate, 11);
    assert.equal(charMod.INACTIVITY_TIER_THRESHOLDS.longer, 25);

    assert.equal(charMod.AUTONOMOUS_ACTIVITY_DEFINITIONS.relaxed_posture_settle.minInactivitySeconds, 3);
    assert.equal(charMod.AUTONOMOUS_ACTIVITY_DEFINITIONS.weight_shift_browse.minInactivitySeconds, 3);
    assert.equal(charMod.AUTONOMOUS_ACTIVITY_DEFINITIONS.shoulder_rolls.minInactivitySeconds, 11);
    assert.equal(charMod.AUTONOMOUS_ACTIVITY_DEFINITIONS.calf_raise.minInactivitySeconds, 11);
    assert.equal(charMod.AUTONOMOUS_ACTIVITY_DEFINITIONS.gentle_side_stretch.minInactivitySeconds, 25);
    assert.equal(charMod.AUTONOMOUS_ACTIVITY_DEFINITIONS.overhead_stretch.minInactivitySeconds, 25);

    const rng = createDeterministicRng(42);
    const rig = createFullControllerRig(rng, 0.0);
    try {
      // Before minInactivitySeconds (3s), no activity should fire even if decision timer elapses
      for (let i = 0; i < 2 * 30; i++) {
        rig.step(1 / 30);
      }
      assert.equal(
        rig.scheduler.getActiveActivity(),
        null,
        'No autonomous activity should fire before 3s inactivity threshold',
      );

      // Between 3s and 11s (short inactivity tier), only subtle short-tier activities are eligible
      let firstActivity: string | null = null;
      for (let i = 0; i < 6 * 30; i++) {
        rig.step(1 / 30);
        if (rig.scheduler.getActiveActivity()) {
          firstActivity = rig.scheduler.getActiveActivity();
          break;
        }
      }
      assert.ok(
        firstActivity === 'relaxed_posture_settle' || firstActivity === 'weight_shift_browse',
        `Expected short-inactivity tier activity first, got ${String(firstActivity)}`,
      );

      // Verify cooldown enforcement on manual trigger without bypassCooldown
      const activeCooldown = rig.scheduler.getCooldownRemaining(
        firstActivity as CharacterBarrel.AutonomousActivityName,
      );
      assert.ok(activeCooldown > 10, `Expected cooldown > 10s, got ${activeCooldown}`);

      // Finish first activity
      while (rig.scheduler.getPhase() !== 'idle') {
        rig.step(1 / 30);
      }
      assert.equal(
        rig.scheduler.triggerActivity(firstActivity as CharacterBarrel.AutonomousActivityName, {
          bypassCooldown: false,
        }),
        false,
        'Expected on-cooldown activity to be rejected when bypassCooldown is false',
      );

      // Advance across 90+ seconds with cleared cooldowns after each completion to verify anti-repetition & tier unlocking
      const selectedSequence: string[] = [firstActivity!];
      for (let cycle = 0; cycle < 10; cycle++) {
        rig.scheduler.clearCooldowns();
        let safetySteps = 0;
        while (rig.scheduler.getPhase() === 'idle' && safetySteps < 600) {
          rig.step(1 / 30);
          safetySteps += 1;
        }
        const picked = rig.scheduler.getActiveActivity();
        assert.ok(picked, `Expected scheduled activity in cycle ${cycle}`);
        selectedSequence.push(picked);
        while (rig.scheduler.getPhase() !== 'idle') {
          rig.step(1 / 30);
        }
      }

      // Never selects the exact same activity twice back-to-back
      for (let i = 1; i < selectedSequence.length; i++) {
        assert.notEqual(
          selectedSequence[i],
          selectedSequence[i - 1],
          `Scheduler repeated '${selectedSequence[i]}' back-to-back in sequence ${selectedSequence.join(' -> ')}`,
        );
      }
      const uniqueSelected = new Set(selectedSequence);
      assert.ok(
        uniqueSelected.size >= 4,
        `Expected diverse randomized selection (>= 4 distinct activities), got ${Array.from(uniqueSelected).join(', ')}`,
      );

      // Verify stillness probability = 1.0 keeps the avatar peacefully still
      const stillRig = createFullControllerRig(createDeterministicRng(7), 1.0);
      for (let i = 0; i < 30 * 20; i++) {
        stillRig.step(1 / 20);
        assert.equal(stillRig.scheduler.getActiveActivity(), null);
      }
      stillRig.disposeAll();
    } finally {
      rig.disposeAll();
    }
  });

  it('4. executes all 6 autonomous activities through anticipation -> execution -> recovery -> idle on companion.vrm with zero foot slide, unit quaternions, and safe clearances', () => {
    // Verify gentle_knee_bounce is completely absent from definitions and names
    assert.equal(
      (charMod.AUTONOMOUS_ACTIVITY_NAMES as readonly string[]).includes('gentle_knee_bounce'),
      false,
      'gentle_knee_bounce must be removed from AUTONOMOUS_ACTIVITY_NAMES',
    );
    assert.equal(
      'gentle_knee_bounce' in charMod.AUTONOMOUS_ACTIVITY_DEFINITIONS,
      false,
      'gentle_knee_bounce must be removed from AUTONOMOUS_ACTIVITY_DEFINITIONS',
    );
    assert.equal(charMod.AUTONOMOUS_ACTIVITY_NAMES.length, 6);

    const rig = createFullControllerRig(createDeterministicRng(99), 0.0);
    try {
      const hipsNode = companionVrm.humanoid.getNormalizedBoneNode('hips')!;
      const leftToesNode = companionVrm.humanoid.getNormalizedBoneNode('leftToes')!;
      const rightToesNode = companionVrm.humanoid.getNormalizedBoneNode('rightToes')!;
      const headNode = companionVrm.humanoid.getNormalizedBoneNode('head')!;
      const leftHandNode = companionVrm.humanoid.getNormalizedBoneNode('leftHand')!;
      const rightHandNode = companionVrm.humanoid.getNormalizedBoneNode('rightHand')!;

      rig.step(1 / 60);
      const restLeftToesPos = new THREE.Vector3().setFromMatrixPosition(leftToesNode.matrixWorld);
      const restRightToesPos = new THREE.Vector3().setFromMatrixPosition(rightToesNode.matrixWorld);
      const restHipsPos = hipsNode.position.clone();

      const posScratch = new THREE.Vector3();
      const headPos = new THREE.Vector3();
      const lHandPos = new THREE.Vector3();
      const rHandPos = new THREE.Vector3();

      const activityStats: Record<
        string,
        {
          maxDeltaHipsY: number;
          minDeltaHipsY: number;
          maxAbsDeltaHipsX: number;
          minShoulderLift: number;
        }
      > = {};

      for (const activityName of charMod.AUTONOMOUS_ACTIVITY_NAMES) {
        rig.scheduler.resetToNeutral();
        for (let settle = 0; settle < 75; settle++) {
          rig.step(1 / 60);
        }

        const started = rig.scheduler.triggerActivity(activityName, {
          bypassCooldown: true,
          force: true,
        });
        assert.equal(started, true, `Expected ${activityName} to start`);
        assert.equal(rig.scheduler.getPhase(), 'anticipation');

        const visitedPhases = new Set<string>([rig.scheduler.getPhase()]);
        let minHandToHeadDist = Number.POSITIVE_INFINITY;
        let maxToeDriftMeters = 0;
        let frameCount = 0;
        let maxDeltaHipsY = -Number.MAX_VALUE;
        let minDeltaHipsY = Number.MAX_VALUE;
        let maxAbsDeltaHipsX = 0;
        let minShoulderLift = Number.MAX_VALUE;

        while (rig.scheduler.getPhase() !== 'idle' && frameCount < 600) {
          rig.step(1 / 60);
          frameCount += 1;
          visitedPhases.add(rig.scheduler.getPhase());

          const dy = hipsNode.position.y - restHipsPos.y;
          const dx = Math.abs(hipsNode.position.x - restHipsPos.x);
          maxDeltaHipsY = Math.max(maxDeltaHipsY, dy);
          minDeltaHipsY = Math.min(minDeltaHipsY, dy);
          maxAbsDeltaHipsX = Math.max(maxAbsDeltaHipsX, dx);

          const torsoOffset = rig.breathing.getDampedActivityOffset();
          minShoulderLift = Math.min(
            minShoulderLift,
            torsoOffset.leftShoulderLiftRad,
            torsoOffset.rightShoulderLiftRad,
          );

          // Check planted toes world lock (zero foot sliding & zero ground penetration)
          posScratch.setFromMatrixPosition(leftToesNode.matrixWorld);
          maxToeDriftMeters = Math.max(maxToeDriftMeters, posScratch.distanceTo(restLeftToesPos));
          posScratch.setFromMatrixPosition(rightToesNode.matrixWorld);
          maxToeDriftMeters = Math.max(maxToeDriftMeters, posScratch.distanceTo(restRightToesPos));

          // Check hand-to-head anatomical clearance during stretches
          headPos.setFromMatrixPosition(headNode.matrixWorld);
          lHandPos.setFromMatrixPosition(leftHandNode.matrixWorld);
          rHandPos.setFromMatrixPosition(rightHandNode.matrixWorld);
          minHandToHeadDist = Math.min(
            minHandToHeadDist,
            lHandPos.distanceTo(headPos),
            rHandPos.distanceTo(headPos),
          );

          // Check unit quaternion normalization across upper, torso, and lower body
          for (const boneName of [
            'hips',
            'spine',
            'chest',
            'leftShoulder',
            'rightShoulder',
            'leftUpperArm',
            'rightUpperArm',
            'leftLowerArm',
            'rightLowerArm',
            'leftUpperLeg',
            'rightUpperLeg',
            'leftLowerLeg',
            'rightLowerLeg',
            'leftFoot',
            'rightFoot',
          ] as VRMHumanBoneName[]) {
            const node = companionVrm.humanoid.getNormalizedBoneNode(boneName);
            if (node) {
              const qLen = node.quaternion.length();
              assert.ok(
                Math.abs(qLen - 1.0) < 1e-4,
                `Quaternion drift detected on ${boneName} during ${activityName}: length=${qLen}`,
              );
            }
          }
        }

        activityStats[activityName] = {
          maxDeltaHipsY,
          minDeltaHipsY,
          maxAbsDeltaHipsX,
          minShoulderLift,
        };

        assert.equal(visitedPhases.has('anticipation'), true, `${activityName} missed anticipation`);
        assert.equal(visitedPhases.has('execution'), true, `${activityName} missed execution`);
        assert.equal(visitedPhases.has('recovery'), true, `${activityName} missed recovery`);
        assert.equal(rig.scheduler.getPhase(), 'idle', `${activityName} did not finish in idle`);
        assert.equal(rig.scheduler.getSnapshot().lastCompletedActivity, activityName);

        assert.ok(
          maxToeDriftMeters < 0.001,
          `Foot sliding detected during ${activityName}: maxToeDrift=${(maxToeDriftMeters * 1000).toFixed(3)}mm`,
        );
        assert.ok(
          minHandToHeadDist > 0.25,
          `Hand approached head too closely during ${activityName}: minDist=${minHandToHeadDist.toFixed(3)}m`,
        );

        // Settle 0.8s after completion and verify clean return to resting upper-limb pose
        for (let settle = 0; settle < 48; settle++) {
          rig.step(1 / 60);
        }
        assert.equal(
          rig.gesture.areLimbsAtRest(1e-2),
          true,
          `Expected upper limbs to return to rest pose after ${activityName}`,
        );
      }

      // Explicit verification of enhanced movement requirements:
      // 1. Calf Raise: pelvis elevates > 40mm, heel lift >= 0.45 rad in evaluator, zero toe drift
      const calfStats = activityStats['calf_raise'];
      assert.ok(calfStats, 'Expected stats for calf_raise');
      assert.ok(
        calfStats.maxDeltaHipsY > 0.040,
        `Calf raise must visibly elevate pelvis (>40mm), got ${(calfStats.maxDeltaHipsY * 1000).toFixed(1)}mm`,
      );

      // 2. Weight Shift: lateral pelvis displacement > 35mm
      const weightStats = activityStats['weight_shift_browse'];
      assert.ok(weightStats, 'Expected stats for weight_shift_browse');
      assert.ok(
        weightStats.maxAbsDeltaHipsX > 0.035,
        `Weight shift must visibly shift hips laterally (>35mm), got ${(weightStats.maxAbsDeltaHipsX * 1000).toFixed(1)}mm`,
      );

      // 3. Relaxed Posture Settle: pelvis drops < -20mm, shoulder drops < -0.050 rad
      const settleStats = activityStats['relaxed_posture_settle'];
      assert.ok(settleStats, 'Expected stats for relaxed_posture_settle');
      assert.ok(
        settleStats.minDeltaHipsY < -0.020,
        `Relaxed posture settle must drop pelvis (< -20mm), got ${(settleStats.minDeltaHipsY * 1000).toFixed(1)}mm`,
      );
      assert.ok(
        settleStats.minShoulderLift < -0.050,
        `Relaxed posture settle must drop shoulders (< -0.050 rad), got ${settleStats.minShoulderLift.toFixed(3)} rad`,
      );

      // 4. Evaluator mathematical output verification
      const evaluator = new charMod.AutonomousActivityEvaluator();
      const peakCalf = evaluator.evaluate('calf_raise', 'execution', 0.5, 1, 1.0);
      assert.ok((peakCalf.lowerBodyOffset.leftHeelLiftRad ?? 0) >= 0.45, 'Evaluator calf heel lift >= 0.45 rad');
      assert.ok((peakCalf.lowerBodyOffset.pelvisTranslation?.[1] ?? 0) >= 0.050, 'Evaluator calf pelvis Y >= 50mm');

      const peakShift = evaluator.evaluate('weight_shift_browse', 'execution', 0.5, 1, 1.0);
      assert.ok((peakShift.lowerBodyOffset.pelvisTranslation?.[0] ?? 0) >= 0.040, 'Evaluator weight shift X >= 40mm');
      assert.ok((peakShift.lowerBodyOffset.pelvisRotationEuler?.[2] ?? 0) >= 0.050, 'Evaluator weight shift roll >= 0.050 rad');

      const peakSettle = evaluator.evaluate('relaxed_posture_settle', 'execution', 0.5, 1, 1.0);
      assert.ok((peakSettle.lowerBodyOffset.pelvisTranslation?.[1] ?? 0) <= -0.024, 'Evaluator settle pelvis Y <= -24mm');
      assert.ok((peakSettle.torsoOffset.leftShoulderLiftRad ?? 0) <= -0.060, 'Evaluator settle shoulder lift <= -0.060 rad');
    } finally {
      rig.disposeAll();
    }
  });

  it('5. enforces strict single-writer bone & expression ownership, zero direct orchestrator writes, camera-relative gaze, and zero forbidden timer APIs', () => {
    // A. Static check: zero timer APIs in new & updated modules
    for (const relPath of [
      'src/character/AutonomousActivityLibrary.ts',
      'src/character/AutonomousActivityScheduler.ts',
      'src/character/GestureController.ts',
      'src/character/BreathingController.ts',
      'src/character/NaturalIdleController.ts',
      'src/character/AttentionController.ts',
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

    const rig = createFullControllerRig(createDeterministicRng(11), 0.0);
    try {
      rig.scheduler.triggerActivity('overhead_stretch', { bypassCooldown: true, force: true });
      // Advance into full execution
      for (let i = 0; i < 90; i++) {
        rig.step(1 / 60);
      }
      assert.equal(rig.scheduler.getPhase(), 'execution');

      // B. Instrument every normalized bone quaternion.copy / setFromAxisAngle / multiply by tracking snapshots around each controller update
      const allHumanoidBones: VRMHumanBoneName[] = [
        'hips',
        'spine',
        'chest',
        'upperChest',
        'neck',
        'head',
        'leftShoulder',
        'rightShoulder',
        'leftUpperArm',
        'leftLowerArm',
        'leftHand',
        'rightUpperArm',
        'rightLowerArm',
        'rightHand',
        'leftUpperLeg',
        'leftLowerLeg',
        'leftFoot',
        'leftToes',
        'rightUpperLeg',
        'rightLowerLeg',
        'rightFoot',
        'rightToes',
      ];

      const captureBoneState = () => {
        const map = new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
        for (const name of allHumanoidBones) {
          const node = companionVrm.humanoid.getNormalizedBoneNode(name);
          if (node) {
            map.set(name, { pos: node.position.clone(), quat: node.quaternion.clone() });
          }
        }
        return map;
      };

      const diffWriters = (
        beforeMap: Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>,
        afterMap: Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>,
      ): string[] => {
        const touched: string[] = [];
        for (const [name, prev] of beforeMap.entries()) {
          const next = afterMap.get(name)!;
          if (
            prev.pos.distanceToSquared(next.pos) > 1e-16 ||
            Math.abs(prev.quat.x - next.quat.x) > 1e-12 ||
            Math.abs(prev.quat.y - next.quat.y) > 1e-12 ||
            Math.abs(prev.quat.z - next.quat.z) > 1e-12 ||
            Math.abs(prev.quat.w - next.quat.w) > 1e-12
          ) {
            touched.push(name);
          }
        }
        return touched;
      };

      const writersPerBone = new Map<string, Set<string>>();
      const runTrackedStep = (controllerName: string, fn: () => void) => {
        const beforeState = captureBoneState();
        fn();
        const afterState = captureBoneState();
        const touched = diffWriters(beforeState, afterState);
        for (const bone of touched) {
          if (!writersPerBone.has(bone)) {
            writersPerBone.set(bone, new Set());
          }
          writersPerBone.get(bone)!.add(controllerName);
        }
        return touched;
      };

      const dt = 1 / 60;
      const schedulerTouched = runTrackedStep('scheduler', () =>
        rig.scheduler.update(companionVrm, dt),
      );
      assert.deepEqual(
        schedulerTouched,
        [],
        'AutonomousActivityScheduler must write ZERO VRM bones directly',
      );

      runTrackedStep('naturalIdle', () => rig.naturalIdle.update(companionVrm, dt));
      runTrackedStep('gesture', () => rig.gesture.update(companionVrm, dt, 2.0));
      runTrackedStep('breathing', () => rig.breathing.update(companionVrm, dt));
      runTrackedStep('gaze', () => rig.gaze.update(companionVrm, dt));
      runTrackedStep('expression', () => rig.expression.update(companionVrm, dt));
      runTrackedStep('speechMouth', () => rig.speechMouth.update(companionVrm, dt));
      runTrackedStep('blink', () => rig.blink.update(companionVrm, dt));

      for (const [bone, writers] of writersPerBone.entries()) {
        assert.equal(
          writers.size,
          1,
          `Bone ownership conflict on '${bone}': written by [${Array.from(writers).join(', ')}]`,
        );
      }

      // C. Camera-relative gaze tracking remains active during overhead stretch
      const headNode = companionVrm.humanoid.getNormalizedBoneNode('head')!;
      const centerHeadQuat = headNode.quaternion.clone();
      rig.camera.position.set(1.35, 1.35, 2.4);
      rig.camera.lookAt(0, 1.25, 0);
      rig.camera.updateMatrixWorld(true);
      for (let i = 0; i < 30; i++) {
        rig.step(1 / 60);
      }
      assert.ok(
        quatAngleRad(centerHeadQuat, headNode.quaternion) > 0.04,
        'Expected GazeController to continue tracking orbited camera during autonomous stretch',
      );
    } finally {
      rig.disposeAll();
    }
  });

  it('6. interrupts autonomous activities gracefully on user interaction, coordinates with LISTENING/SPEAKING, and resumes after conversation', () => {
    const rig = createFullControllerRig(createDeterministicRng(23), 0.0);
    try {
      // Start overhead stretch and advance into peak execution
      rig.scheduler.triggerActivity('overhead_stretch', { bypassCooldown: true, force: true });
      for (let i = 0; i < 95; i++) {
        rig.step(1 / 60);
      }
      assert.equal(rig.scheduler.getPhase(), 'execution');

      const preInteractArmQ = rig.gesture.getBoneQuaternion('leftUpperArm');
      const preInteractBlinkEnabled = rig.blink.isEnabled;
      const preInteractBreathEnabled = rig.breathing.isEnabled;

      // User interacts: stops scheduling, enters graceful recovery without snapping, restores attention
      rig.scheduler.notifyUserInteraction();
      rig.attention.notifyInteraction();

      assert.equal(rig.scheduler.getPhase(), 'recovery');
      assert.equal(rig.attention.getState(), 'ATTENTIVE');
      assert.equal(rig.blink.isEnabled, preInteractBlinkEnabled);
      assert.equal(rig.breathing.isEnabled, preInteractBreathEnabled);

      rig.step(1 / 60);
      const postFirstFrameArmQ = rig.gesture.getBoneQuaternion('leftUpperArm');
      assert.ok(
        quatAngleRad(preInteractArmQ, postFirstFrameArmQ) <= (5.6 / 60) + 1e-4,
        'Expected zero quaternion snap on user interaction interruption',
      );

      // Settle recovery back to idle
      for (let i = 0; i < 60; i++) {
        rig.step(1 / 60);
      }
      assert.equal(rig.scheduler.getPhase(), 'idle');
      assert.equal(rig.gesture.areLimbsAtRest(1e-2), true);

      // During LISTENING & SPEAKING, autonomous activities must NOT start even after long time
      rig.dispatcher.onUserMessageSubmitted();
      assert.equal(rig.attention.getState(), 'LISTENING');
      for (let i = 0; i < 30 * 30; i++) {
        rig.step(1 / 30);
        assert.equal(
          rig.scheduler.getActiveActivity(),
          null,
          'Scheduler must never start activities while LISTENING',
        );
      }

      rig.dispatcher.dispatchReaction({
        response_text: 'I am speaking with you right now, so I stay focused on our chat.',
        emotion: 'happy',
        emotion_intensity: 0.75,
        gesture: 'explaining',
        gesture_intensity: 0.85,
      });
      assert.equal(rig.attention.getState(), 'SPEAKING');
      for (let i = 0; i < 60; i++) {
        rig.step(1 / 30);
        assert.equal(
          rig.scheduler.getActiveActivity(),
          null,
          'Scheduler must never start activities while SPEAKING or gesturing',
        );
      }

      // Finish speech and let conversational gesture complete
      rig.dispatcher.handleSpeechComplete();
      for (let i = 0; i < 90; i++) {
        rig.step(1 / 30);
      }
      assert.equal(rig.attention.getState(), 'ATTENTIVE');
      assert.equal(rig.gesture.getPhase(), 'idle');

      // Once conversation ends and inactivity accumulates, autonomous scheduling resumes automatically
      rig.scheduler.clearCooldowns();
      let resumedActivity: string | null = null;
      for (let i = 0; i < 18 * 30; i++) {
        rig.step(1 / 30);
        if (rig.scheduler.getActiveActivity()) {
          resumedActivity = rig.scheduler.getActiveActivity();
          break;
        }
      }
      assert.ok(resumedActivity, 'Expected autonomous activity scheduling to resume after conversation ends');
    } finally {
      rig.disposeAll();
    }
  });

  it('7. supports pause/resume, hidden browser tab suspension, return to neutral posture, and clean disposal', () => {
    const rig = createFullControllerRig(createDeterministicRng(31), 0.0);
    try {
      // Shift lower-body posture and start side stretch
      rig.naturalIdle.setPosture('weight_left', 0.3);
      for (let i = 0; i < 25; i++) {
        rig.step(1 / 60);
      }
      rig.scheduler.triggerActivity('gentle_side_stretch', { bypassCooldown: true, force: true });
      for (let i = 0; i < 30; i++) {
        rig.step(1 / 60);
      }
      const frozenPhase = rig.scheduler.getPhase();
      const frozenArmQ = rig.gesture.getBoneQuaternion('leftUpperArm');

      // Pause freezes progression
      rig.scheduler.pause();
      rig.gesture.pause();
      for (let i = 0; i < 40; i++) {
        rig.step(1 / 60);
      }
      assert.equal(rig.scheduler.getPhase(), frozenPhase);
      assert.ok(quatAngleRad(frozenArmQ, rig.gesture.getBoneQuaternion('leftUpperArm')) < 1e-6);

      // Resume continues smoothly
      rig.scheduler.resume();
      rig.gesture.resume();
      rig.step(0.2);

      // Reset to neutral posture smoothly restores neutral_stand and resting limbs
      rig.scheduler.resetToNeutral();
      for (let i = 0; i < 90; i++) {
        rig.step(1 / 60);
      }
      assert.equal(rig.scheduler.getPhase(), 'idle');
      assert.equal(rig.naturalIdle.getSnapshot().currentPosture, 'neutral_stand');
      assert.equal(rig.gesture.areLimbsAtRest(1e-2), true);

      // Browser tab hidden pauses autonomous scheduling completely
      rig.scheduler.clearCooldowns();
      rig.scheduler.setTabHidden(true);
      assert.equal(rig.scheduler.isTabHidden, true);
      for (let i = 0; i < 30 * 30; i++) {
        rig.step(1 / 30);
        assert.equal(
          rig.scheduler.getActiveActivity(),
          null,
          'Scheduler must pause while browser tab is hidden',
        );
      }
      rig.scheduler.setTabHidden(false);
      assert.equal(rig.scheduler.isTabHidden, false);

      // Disposal clears listeners and resets all owned channels
      let notifyCalls = 0;
      rig.scheduler.subscribe(() => {
        notifyCalls += 1;
      });
      rig.scheduler.dispose();
      const countAfterDispose = notifyCalls;
      rig.scheduler.setFrequencyMultiplier(2.0);
      assert.equal(notifyCalls, countAfterDispose, 'Expected disposed scheduler to clear listeners');
    } finally {
      rig.disposeAll();
    }
  });

  it('8. renders dev-only autonomous activity controls, shares unified attentionSystem without duplicate controllers, and omits dev UI when disabled', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    let capturedSharedSystem: UseAttentionSystemResult | null = null;
    function UnifiedHarness({ showDev }: { showDev: boolean }) {
      const sys = useAttentionSystem();
      React.useEffect(() => {
        capturedSharedSystem = sys;
      });
      return React.createElement(AvatarScene, {
        attentionSystem: sys,
        controllers: sys.controllerSlots,
        showHud: true,
        showDevControls: showDev,
      });
    }

    try {
      act(() => {
        root.render(React.createElement(UnifiedHarness, { showDev: true }));
      });

      assert.ok(capturedSharedSystem, 'Expected shared attentionSystem');
      const sys = capturedSharedSystem as unknown as UseAttentionSystemResult;

      // Verify unified controller graph: playing 'shrug' updates the live BreathingController!
      act(() => {
        sys.playGesture('shrug', { priority: 'explicit', intensity: 1.0, bypassCooldown: true });
        sys.gestureController.update(1 / 60);
        sys.breathingController.update(companionVrm, 1 / 60);
      });
      assert.ok(
        sys.breathingController.getDampedGestureOffset().rightShoulderLiftRad > 0.005,
        'Expected live BreathingController to receive upper-body gesture offsets (no split-brain hijack)',
      );
      act(() => {
        sys.stopGesture({ immediate: true });
      });

      const activityPanel = host.querySelector('.avatar-scene__dev-activities');
      assert.ok(activityPanel, 'Expected .avatar-scene__dev-activities in dev mode');

      const buttons = Array.from(activityPanel.querySelectorAll('button'));
      const findButton = (text: string) =>
        buttons.find((btn) => btn.textContent?.trim().includes(text));

      // Verify manual trigger buttons for all 6 implemented activities
      for (const name of charMod.AUTONOMOUS_ACTIVITY_NAMES) {
        const label = charMod.AUTONOMOUS_ACTIVITY_DEFINITIONS[name].label;
        const btn = findButton(label);
        assert.ok(btn, `Expected manual dev trigger button '${label}'`);
      }

      // Click 'Overhead Stretch' and verify live inspector updates
      const stretchBtn = findButton('Overhead Stretch')!;
      act(() => {
        stretchBtn.click();
      });
      assert.equal(sys.activityScheduler.getActiveActivity(), 'overhead_stretch');
      const inspector = activityPanel.querySelector('[data-testid="dev-activity-inspector"]');
      assert.ok(inspector?.textContent?.includes('Overhead Stretch'));

      // Click 'Interrupt Activity' -> enters graceful recovery
      const interruptBtn = findButton('Interrupt Activity')!;
      act(() => {
        interruptBtn.click();
      });
      assert.equal(sys.activityScheduler.getPhase(), 'recovery');

      // Adjust frequency slider
      const freqSlider = activityPanel.querySelector('input[type="range"]') as HTMLInputElement | null;
      assert.ok(freqSlider, 'Expected Activity Frequency range input');
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(
          happyWindow.HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(freqSlider, '2.25');
        freqSlider.dispatchEvent(new happyWindow.Event('input', { bubbles: true }) as unknown as Event);
      });
      assert.equal(sys.activityScheduler.getFrequencyMultiplier(), 2.25);

      // Enable / Disable toggle
      const toggleBtn = findButton('Auto Activity:')!;
      act(() => {
        toggleBtn.click();
      });
      assert.equal(sys.activityScheduler.isEnabled, false);
      assert.ok(toggleBtn.textContent?.includes('Auto Activity: Off'));

      // Reset Posture button
      const resetBtn = findButton('Reset Posture')!;
      act(() => {
        resetBtn.click();
      });
      assert.equal(sys.naturalIdleController.getSnapshot().targetPosture, 'neutral_stand');

      // Omitted when showDevControls={false}
      act(() => {
        root.render(React.createElement(UnifiedHarness, { showDev: false }));
      });
      assert.equal(host.querySelector('.avatar-scene__dev-activities'), null);
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });
});
