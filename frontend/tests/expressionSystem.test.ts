import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { VRM } from '@pixiv/three-vrm';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { BlinkController as BlinkControllerType } from '../src/character/BlinkController.ts';
import type {
  EmotionName,
  ExpressionController as ExpressionControllerType,
} from '../src/character/ExpressionController.ts';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface CharacterBarrelModule {
  BlinkController: typeof BlinkControllerType;
  ExpressionController: typeof ExpressionControllerType;
  EMOTION_NAMES: readonly EmotionName[];
}

interface AvatarSceneModule {
  AvatarScene: React.ComponentType<{
    showDevControls?: boolean;
    expressionController?: ExpressionControllerType;
  }>;
}

function createExpressionTestVrm(
  presetNames: readonly string[] = [
    'neutral',
    'happy',
    'sad',
    'angry',
    'relaxed',
    'surprised',
    'aa',
    'ih',
    'ou',
    'ee',
    'oh',
    'blink',
    'blinkLeft',
    'blinkRight',
  ],
) {
  const available = new Set<string>(presetNames);
  const values = new Map<string, number>();
  const writeHistory: Array<{ name: string; weight: number }> = [];

  for (const name of available) {
    values.set(name, 0);
  }

  const expressions = Array.from(available).map((name) => ({
    expressionName: name,
    overrideBlinkAmount: 0,
  }));

  const vrm = {
    expressionManager: {
      expressions,
      getExpression: (name: string) => (available.has(name) ? { expressionName: name } : null),
      getValue: (name: string) => values.get(name) ?? null,
      setValue: (name: string, weight: number) => {
        writeHistory.push({ name, weight });
        if (available.has(name)) {
          values.set(name, weight);
        }
      },
    },
  } as unknown as VRM;

  return { vrm, values, writeHistory };
}

describe('Milestone 3 — Emotional Expression Engine', () => {
  let vite: ViteDevServer;
  let charMod: CharacterBarrelModule;
  let AvatarScene: AvatarSceneModule['AvatarScene'];
  let happyWindow: Window;

  before(async () => {
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
          name: 'mock-avatar-viewer-ready-m3',
          enforce: 'pre',
          resolveId(id) {
            if (id.endsWith('/hooks/useAvatarViewer') || id === '../hooks/useAvatarViewer') {
              return '\0virtual:useAvatarViewerM3';
            }
            return null;
          },
          load(id) {
            if (id === '\0virtual:useAvatarViewerM3') {
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
  });

  after(async () => {
    await vite?.close();
    await happyWindow?.happyDOM.close();
  });

  it('1. clamps intensity strictly to [0.0, 1.0] and scales subtle/medium/strong & composite weights', () => {
    const { ExpressionController } = charMod;
    const { vrm, values } = createExpressionTestVrm();
    const controller = new ExpressionController({ defaultTransitionSeconds: 0 });
    controller.attach(vrm);

    // Above 1.0 -> clamped to 1.0
    assert.equal(controller.setEmotion('happy', 1.85), true);
    assert.equal(controller.getTargetIntensity(), 1.0);
    assert.equal(values.get('happy'), 1.0);

    // Subtle (0.2) and clear (0.6) intensities
    controller.setEmotion('happy', 0.2);
    assert.ok(Math.abs((values.get('happy') ?? 0) - 0.2) < 1e-6);

    controller.setEmotion('happy', 0.6);
    assert.ok(Math.abs((values.get('happy') ?? 0) - 0.6) < 1e-6);

    // Composite 'shy' scales constituent presets proportionally and stays <= 1.0
    controller.setEmotion('shy', 0.5);
    assert.equal(values.get('happy'), 0);
    assert.ok(Math.abs((values.get('relaxed') ?? 0) - 0.275) < 1e-6);
    assert.ok(Math.abs((values.get('sad') ?? 0) - 0.175) < 1e-6);

    // Below 0.0 and NaN -> clamped to 0.0 (resting neutral)
    controller.setEmotion('angry', -0.4);
    assert.equal(controller.getTargetIntensity(), 0);
    assert.equal(controller.getActiveEmotion(), 'neutral');
    assert.equal(values.get('angry'), 0);
    assert.equal(values.get('relaxed'), 0);

    controller.setEmotion('surprised', Number.NaN);
    assert.equal(controller.getTargetIntensity(), 0);
    assert.equal(values.get('surprised'), 0);
  });

  it('2. interpolates smoothly via deltaTime with cubic easing and zero timer APIs', () => {
    const src = fs.readFileSync(
      path.join(FRONTEND_ROOT, 'src/character/ExpressionController.ts'),
      'utf8',
    );
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    assert.equal(
      /setInterval|setTimeout|requestAnimationFrame/.test(codeOnly),
      false,
      'ExpressionController must be purely deltaTime-driven',
    );

    const { ExpressionController } = charMod;
    const { vrm, values } = createExpressionTestVrm();
    const controller = new ExpressionController({ defaultTransitionSeconds: 0.4 });
    controller.attach(vrm);

    controller.setTransitionDuration(0.5);
    assert.equal(controller.getTransitionDuration(), 0.5);

    controller.setEmotion('happy', 1.0);
    // Immediately after setEmotion (before any deltaTime tick), weight must NOT snap to 1.0
    assert.equal(controller.getChannelWeight('happy'), 0);

    let prev = 0;
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      controller.update(0.05); // 10 * 0.05s = 0.50s
      const w = values.get('happy') ?? 0;
      assert.ok(w >= prev, `Expected monotonic rise at step ${i}: ${w} >= ${prev}`);
      samples.push(w);
      prev = w;
    }

    // Midpoint (t = 0.25s, step index 4) of symmetric smoothstep should equal 0.5
    assert.ok(Math.abs(samples[4] - 0.5) < 1e-6, `Expected smoothstep midpoint 0.5, got ${samples[4]}`);
    // Ease-in check: first 0.05s step (u=0.1 -> 0.028) is gentler than linear 0.1
    assert.ok(samples[0] > 0 && samples[0] < 0.05, `Expected gentle ease-in start, got ${samples[0]}`);
    assert.equal(samples[9], 1.0, 'Expected exact convergence to 1.0 at transition end');
  });

  it('3. handles mid-transition interruptions seamlessly without facial snapping', () => {
    const { ExpressionController } = charMod;
    const { vrm, values } = createExpressionTestVrm();
    const controller = new ExpressionController({ defaultTransitionSeconds: 0.4 });
    controller.attach(vrm);

    controller.setEmotion('happy', 1.0);
    controller.update(vrm, 0.2); // Halfway -> happy = 0.5
    const midHappy = values.get('happy') ?? 0;
    assert.ok(Math.abs(midHappy - 0.5) < 1e-6);

    // Interrupt mid-flight with 'sad' (0.8) BEFORE 'happy' finishes
    assert.equal(controller.setEmotion('sad', 0.8), true);

    // Zero snap right at retarget moment
    assert.ok(Math.abs(controller.getChannelWeight('happy') - 0.5) < 1e-6);
    assert.equal(controller.getChannelWeight('sad'), 0);

    // Next 60Hz frame moves gradually from { happy: 0.5, sad: 0.0 }
    controller.update(vrm, 1 / 60);
    const nextHappy = values.get('happy') ?? 0;
    const nextSad = values.get('sad') ?? 0;
    assert.ok(nextHappy < 0.5 && nextHappy > 0.48, `Expected smooth happy decay from 0.5, got ${nextHappy}`);
    assert.ok(nextSad > 0 && nextSad < 0.02, `Expected smooth sad onset from 0, got ${nextSad}`);

    // Finish remaining transition -> converges cleanly to { happy: 0, sad: 0.8 }
    controller.update(vrm, 0.45);
    assert.equal(values.get('happy'), 0);
    assert.ok(Math.abs((values.get('sad') ?? 0) - 0.8) < 1e-6);
  });

  it('4. enforces expression priorities so conversational/strong emotions block low-priority idle updates', () => {
    const { ExpressionController } = charMod;
    const { vrm, values } = createExpressionTestVrm();
    const controller = new ExpressionController({ defaultTransitionSeconds: 0.1 });
    controller.attach(vrm);

    // 1. Idle expression starts first
    assert.equal(controller.setEmotion('relaxed', 0.35, { priority: 'idle' }), true);
    controller.update(vrm, 0.1);
    assert.ok(Math.abs((values.get('relaxed') ?? 0) - 0.35) < 1e-6);

    // 2. Conversational instruction overrides lower-priority idle expression
    assert.equal(controller.setEmotion('angry', 0.9, { priority: 'conversation' }), true);
    controller.update(vrm, 0.1);
    assert.ok(Math.abs((values.get('angry') ?? 0) - 0.9) < 1e-6);
    assert.equal(values.get('relaxed'), 0);

    // 3. Low-priority idle OR accidental idle 'neutral' cannot overwrite active strong/conversational emotion
    assert.equal(controller.setEmotion('relaxed', 0.3, { priority: 'idle' }), false);
    assert.equal(controller.setEmotion('neutral', 0, { priority: 'idle' }), false);
    assert.equal(controller.setEmotion('happy', 0.5, { priority: 'reaction' }), false);
    controller.update(vrm, 0.1);
    assert.equal(controller.getActiveEmotion(), 'angry');
    assert.ok(Math.abs((values.get('angry') ?? 0) - 0.9) < 1e-6);

    // 4. Newer conversational or higher override instruction CAN replace it
    assert.equal(controller.setEmotion('happy', 0.75, { priority: 'conversation' }), true);
    controller.update(vrm, 0.1);
    assert.equal(controller.getActiveEmotion(), 'happy');
    assert.ok(Math.abs((values.get('happy') ?? 0) - 0.75) < 1e-6);

    // 5. clearEmotion() unconditionally resets priority lock so idle expressions work again
    controller.clearEmotion({ transitionSeconds: 0.1 });
    controller.update(vrm, 0.1);
    assert.equal(controller.getActiveEmotion(), 'neutral');
    assert.equal(values.get('happy'), 0);
    assert.equal(controller.setEmotion('relaxed', 0.25, { priority: 'idle' }), true);
  });

  it('5. automatically decays temporary holdSeconds expressions smoothly back to neutral', () => {
    const { ExpressionController } = charMod;
    const { vrm, values } = createExpressionTestVrm();
    const controller = new ExpressionController({ defaultTransitionSeconds: 0.2 });
    controller.attach(vrm);

    assert.equal(
      controller.setEmotion('surprised', 0.8, {
        priority: 'conversation',
        holdSeconds: 0.5,
      }),
      true,
    );

    // 0.2s attack -> reaches 0.8
    controller.update(vrm, 0.2);
    assert.ok(Math.abs((values.get('surprised') ?? 0) - 0.8) < 1e-6);
    assert.equal(controller.getActiveEmotion(), 'surprised');

    // Hold for 0.4s (still within 0.5s sustain window) -> remains 0.8
    controller.update(vrm, 0.4);
    assert.ok(Math.abs((values.get('surprised') ?? 0) - 0.8) < 1e-6);

    // Advance 0.2s -> 0.1s finishes hold + 0.1s halfway through 0.2s smooth decay (-> 0.4)
    controller.update(vrm, 0.2);
    assert.equal(controller.getActiveEmotion(), 'neutral');
    assert.equal(controller.getActivePriority(), 0, 'Priority must release on decay');
    const midDecay = values.get('surprised') ?? 0;
    assert.ok(Math.abs(midDecay - 0.4) < 1e-6, `Expected smooth midpoint decay 0.4, got ${midDecay}`);

    // Final 0.1s completes decay to 0.0
    controller.update(vrm, 0.1);
    assert.equal(values.get('surprised'), 0);

    // Lower-priority idle emotion is now accepted again after decay
    assert.equal(controller.setEmotion('relaxed', 0.3, { priority: 'idle' }), true);
  });

  it('6. preserves BlinkController single ownership of blink presets and coordinates happy/relaxed blinking', () => {
    const { BlinkController, ExpressionController } = charMod;
    const { vrm, values, writeHistory } = createExpressionTestVrm();

    const expression = new ExpressionController({ defaultTransitionSeconds: 0.1 });
    const blink = new BlinkController({ doubleBlinkProbability: 0, intervalRange: [10, 10] });

    expression.attach(vrm);
    blink.attach(vrm);
    writeHistory.length = 0;

    // Exercise every supported emotion + clear + dispose check on ExpressionController alone
    for (const emotion of expression.getSupportedEmotions()) {
      expression.setEmotion(emotion, 0.9);
      expression.update(vrm, 0.1);
    }
    expression.clearEmotion({ transitionSeconds: 0.05 });
    expression.update(vrm, 0.05);

    const forbiddenBlinkOrVisemeWrites = writeHistory.filter((entry) =>
      ['blink', 'blinkLeft', 'blinkRight', 'aa', 'ih', 'ou', 'ee', 'oh'].includes(entry.name),
    );
    assert.equal(
      forbiddenBlinkOrVisemeWrites.length,
      0,
      'ExpressionController must NEVER write blink or mouth viseme presets',
    );

    // Coexistence 1: Happy 1.0 closes eyes into joyful crescents -> BlinkController attenuates blink to 0 (no mesh clipping)
    expression.setEmotion('happy', 1.0, { transitionSeconds: 0 });
    blink.triggerManualBlink();
    let maxHappyBlink = 0;
    for (let i = 0; i < 18; i++) {
      expression.update(vrm, 1 / 60);
      blink.update(vrm, 1 / 60);
      maxHappyBlink = Math.max(maxHappyBlink, values.get('blink') ?? 0);
    }
    assert.equal(maxHappyBlink, 0, 'Happy 1.0 must fully attenuate blink to prevent eyelid folding');
    assert.equal(values.get('happy'), 1.0, 'BlinkController must not alter happy weight');

    // Coexistence 2: Relaxed 1.0 keeps eyes open (~89%) -> BlinkController still blinks naturally (~0.75 peak)
    expression.setEmotion('relaxed', 1.0, { transitionSeconds: 0 });
    blink.triggerManualBlink();
    let maxRelaxedBlink = 0;
    for (let i = 0; i < 18; i++) {
      expression.update(vrm, 1 / 60);
      blink.update(vrm, 1 / 60);
      maxRelaxedBlink = Math.max(maxRelaxedBlink, values.get('blink') ?? 0);
    }
    assert.ok(
      maxRelaxedBlink > 0.7 && maxRelaxedBlink <= 0.7501,
      `Expected natural softened blink (~0.75) during Relaxed 1.0, got ${maxRelaxedBlink}`,
    );
    assert.equal(values.get('relaxed'), 1.0, 'BlinkController must not alter relaxed weight');
  });

  it('7. freezes transitions and hold timers on pause() and continues smoothly on resume()', () => {
    const { ExpressionController } = charMod;
    const { vrm, values } = createExpressionTestVrm();
    const controller = new ExpressionController({ defaultTransitionSeconds: 0.4 });
    controller.attach(vrm);

    controller.setEmotion('happy', 1.0, { holdSeconds: 0.5 });
    controller.update(vrm, 0.2); // Halfway -> 0.5
    const frozenWeight = values.get('happy') ?? 0;
    assert.ok(Math.abs(frozenWeight - 0.5) < 1e-6);

    controller.pause();
    assert.equal(controller.isPaused, true);

    // 5 full seconds of updates while paused must neither advance transition nor expire holdSeconds
    for (let i = 0; i < 300; i++) {
      controller.update(vrm, 1 / 60);
    }
    assert.equal(values.get('happy'), frozenWeight, 'Expression weight must stay frozen while paused');
    assert.equal(controller.getActiveEmotion(), 'happy');

    controller.resume();
    assert.equal(controller.isPaused, false);

    // Remaining 0.2s completes attack to 1.0, and hold timer is still intact (0.5s left)
    controller.update(vrm, 0.2);
    assert.equal(values.get('happy'), 1.0);
    assert.equal(controller.getActiveEmotion(), 'happy');
  });

  it('8. safely handles unsupported expressions, custom VRM overrides, and dev-only toolbar rendering', () => {
    const { ExpressionController } = charMod;

    // A. Minimal VRM supporting only 'neutral', 'happy', and 'blink'
    const minimalRig = createExpressionTestVrm(['neutral', 'happy', 'blink']);
    const minimalCtrl = new ExpressionController({ defaultTransitionSeconds: 0 });
    minimalCtrl.attach(minimalRig.vrm);

    assert.deepEqual(minimalCtrl.getSupportedEmotions(), ['neutral', 'happy']);
    assert.equal(minimalCtrl.setEmotion('happy', 0.7), true);
    assert.equal(minimalCtrl.setEmotion('angry', 0.9), false, 'Missing preset must return false');
    assert.equal(minimalCtrl.setEmotion('shy', 0.8), false, 'Missing composite presets must return false');
    assert.equal(
      minimalCtrl.setEmotion('unknown_emotion' as unknown as EmotionName, 1.0),
      false,
      'Unknown runtime emotion string must return false without throwing',
    );
    assert.ok(
      Math.abs((minimalRig.values.get('happy') ?? 0) - 0.7) < 1e-6,
      'Rejected unsupported emotions must not disturb active expression',
    );

    // B. VRM with native custom 'shy' expression binds directly to custom 'shy'
    const customShyRig = createExpressionTestVrm(['neutral', 'happy', 'shy', 'blink']);
    const customShyCtrl = new ExpressionController({ defaultTransitionSeconds: 0 });
    customShyCtrl.attach(customShyRig.vrm);
    assert.equal(customShyCtrl.isSupportedEmotion('shy'), true);
    assert.equal(customShyCtrl.setEmotion('shy', 0.85), true);
    assert.ok(Math.abs((customShyRig.values.get('shy') ?? 0) - 0.85) < 1e-6);

    // C. Dev-only expression toolbar renders in dev mode and is omitted when showDevControls={false}
    const uiCtrl = new ExpressionController();
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      act(() => {
        root.render(
          React.createElement(AvatarScene, {
            showDevControls: true,
            expressionController: uiCtrl,
          }),
        );
      });

      const exprPanel = host.querySelector('.avatar-scene__dev-expressions');
      assert.ok(exprPanel, 'Expected development expression toolbar when showDevControls={true}');

      const buttonLabels = Array.from(exprPanel.querySelectorAll('button')).map((b) =>
        (b.textContent ?? '').trim(),
      );
      for (const expected of [
        'Neutral',
        'Happy',
        'Sad',
        'Angry',
        'Relaxed',
        'Surprised',
        'Shy',
        'Clear / Reset',
      ]) {
        assert.ok(
          buttonLabels.includes(expected),
          `Expected "${expected}" button in dev toolbar, got: ${buttonLabels.join(', ')}`,
        );
      }

      const sliders = Array.from(exprPanel.querySelectorAll('input[type="range"]'));
      assert.equal(sliders.length, 2, 'Expected Intensity and Transition range sliders');

      const happyBtn = Array.from(exprPanel.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === 'Happy',
      ) as unknown as HTMLButtonElement;
      const resetBtn = Array.from(exprPanel.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === 'Clear / Reset',
      ) as unknown as HTMLButtonElement;

      act(() => {
        happyBtn.click();
      });
      assert.equal(uiCtrl.getActiveEmotion(), 'happy');
      assert.equal(happyBtn.getAttribute('aria-pressed'), 'true');

      act(() => {
        resetBtn.click();
      });
      assert.equal(uiCtrl.getActiveEmotion(), 'neutral');

      // Production gate check
      act(() => {
        root.render(
          React.createElement(AvatarScene, {
            showDevControls: false,
            expressionController: uiCtrl,
          }),
        );
      });
      assert.equal(host.querySelector('.avatar-scene__dev-expressions'), null);
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });
});

