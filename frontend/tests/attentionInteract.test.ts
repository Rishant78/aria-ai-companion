import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type {
  AttentionController as AttentionControllerType,
  AttentionStatusSnapshot,
} from '../src/character/AttentionController.ts';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface CharacterModule {
  AttentionController: typeof AttentionControllerType;
}

interface AvatarSceneModule {
  AvatarScene: React.ComponentType;
}

function getButtonByLabel(rootEl: ParentNode, label: string): HTMLButtonElement {
  const buttons = Array.from(rootEl.querySelectorAll('button'));
  const match = buttons.find((btn) => btn.textContent?.trim() === label);
  assert.ok(match, `Expected HUD button "${label}" to exist`);
  return match as HTMLButtonElement;
}

describe('Interact button & returnToAttentive()', () => {
  let vite: ViteDevServer;
  let AttentionController: typeof AttentionControllerType;
  let AvatarScene: React.ComponentType;
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
                      presetExpressions: ['neutral', 'blink'],
                      customExpressions: [],
                      allExpressions: ['neutral', 'blink'],
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

    const charMod = (await vite.ssrLoadModule('/src/character/AttentionController.ts')) as CharacterModule;
    AttentionController = charMod.AttentionController;

    const sceneMod = (await vite.ssrLoadModule('/src/components/AvatarScene.tsx')) as AvatarSceneModule;
    AvatarScene = sceneMod.AvatarScene;
  });

  after(async () => {
    await vite?.close();
    await happyWindow?.happyDOM.close();
  });

  it('LISTENING -> returnToAttentive() -> ATTENTIVE clears conversation, resets gaze/idle, and notifies subscribers', () => {
    const controller = new AttentionController();
    controller.setConversationMode('LISTENING');
    controller.update(1 / 60);

    assert.equal(controller.getState(), 'LISTENING');
    assert.equal(controller.isConversationActive, true);

    const prevSnapshot = controller.getSnapshot();
    const notifications: AttentionStatusSnapshot[] = [];
    const unsubscribe = controller.subscribe((snap) => {
      notifications.push(snap);
    });

    controller.returnToAttentive();
    unsubscribe();

    assert.equal(notifications.length, 1, 'Expected synchronous useSyncExternalStore notification');
    const nextSnapshot = controller.getSnapshot();
    assert.notEqual(prevSnapshot, nextSnapshot, 'Expected new snapshot object reference');
    assert.equal(nextSnapshot.state, 'ATTENTIVE');
    assert.equal(nextSnapshot.isConversationActive, false);
    assert.equal(nextSnapshot.inactivitySeconds, 0);

    const frameIntent = controller.update(0);
    assert.equal(frameIntent.state, 'ATTENTIVE');
    assert.equal(frameIntent.gazeOffsetYawDeg, 0);
    assert.equal(frameIntent.gazeOffsetPitchDeg, 0);
    assert.equal(frameIntent.headTiltRollRad, 0);
    assert.equal(frameIntent.headNodPitchRad, 0);
    assert.equal(frameIntent.isRecovering, true);
  });

  it('SPEAKING -> returnToAttentive() -> ATTENTIVE clears speaking glances/cadence and notifies subscribers', () => {
    const controller = new AttentionController();
    controller.setConversationMode('SPEAKING');
    // Advance several seconds so speaking thought-glances and cadence accumulate
    for (let i = 0; i < 300; i++) {
      controller.update(1 / 60);
    }

    assert.equal(controller.getState(), 'SPEAKING');
    assert.equal(controller.isConversationActive, true);

    const prevSnapshot = controller.getSnapshot();
    const notifications: AttentionStatusSnapshot[] = [];
    const unsubscribe = controller.subscribe((snap) => {
      notifications.push(snap);
    });

    controller.returnToAttentive();
    unsubscribe();

    assert.equal(notifications.length, 1, 'Expected synchronous useSyncExternalStore notification');
    const nextSnapshot = controller.getSnapshot();
    assert.notEqual(prevSnapshot, nextSnapshot, 'Expected new snapshot object reference');
    assert.equal(nextSnapshot.state, 'ATTENTIVE');
    assert.equal(nextSnapshot.isConversationActive, false);
    assert.equal(nextSnapshot.inactivitySeconds, 0);

    const frameIntent = controller.update(0);
    assert.equal(frameIntent.state, 'ATTENTIVE');
    assert.equal(frameIntent.gazeOffsetYawDeg, 0);
    assert.equal(frameIntent.gazeOffsetPitchDeg, 0);
    assert.equal(frameIntent.headTiltRollRad, 0);
    assert.equal(frameIntent.headNodPitchRad, 0);
    assert.equal(frameIntent.isRecovering, true);
  });

  it('EXPLORING & SEEKING_ATTENTION -> returnToAttentive() -> ATTENTIVE cancels idle targets and resets timer', () => {
    const controller = new AttentionController({
      inactivityThresholdSeconds: 10,
      attentionSeekingMinInactivitySeconds: 15,
    });

    // Advance into EXPLORING (12s)
    for (let i = 0; i < 12 * 60; i++) {
      controller.update(1 / 60);
    }
    assert.equal(controller.getState(), 'EXPLORING');
    assert.equal(controller.getSnapshot().inactivitySeconds >= 12, true);

    controller.returnToAttentive();
    assert.equal(controller.getState(), 'ATTENTIVE');
    assert.equal(controller.getSnapshot().inactivitySeconds, 0);

    const intentAfterExplore = controller.update(0);
    assert.equal(intentAfterExplore.gazeOffsetYawDeg, 0);
    assert.equal(intentAfterExplore.gazeOffsetPitchDeg, 0);
    assert.equal(intentAfterExplore.headTiltRollRad, 0);
    assert.equal(intentAfterExplore.isRecovering, true);

    // Advance until SEEKING_ATTENTION triggers, then invoke returnToAttentive()
    for (let i = 0; i < 60 * 60 && controller.getState() !== 'SEEKING_ATTENTION'; i++) {
      controller.update(1 / 60);
    }
    assert.equal(controller.getState(), 'SEEKING_ATTENTION');

    controller.returnToAttentive();
    assert.equal(controller.getState(), 'ATTENTIVE');
    assert.equal(controller.getSnapshot().inactivitySeconds, 0);

    const intentAfterSeeking = controller.update(0);
    assert.equal(intentAfterSeeking.gazeOffsetYawDeg, 0);
    assert.equal(intentAfterSeeking.gazeOffsetPitchDeg, 0);
    assert.equal(intentAfterSeeking.headTiltRollRad, 0);
    assert.equal(intentAfterSeeking.headNodPitchRad, 0);
    assert.equal(intentAfterSeeking.isRecovering, true);
  });

  it('HUD DOM: LISTENING -> click Interact -> immediately renders "Attentive"', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      act(() => {
        root.render(React.createElement(AvatarScene));
      });

      const badge = host.querySelector('.avatar-scene__state-badge');
      assert.ok(badge, 'Expected HUD state badge');
      assert.equal(badge.textContent?.trim(), 'Attentive');

      const listenBtn = getButtonByLabel(host as unknown as ParentNode, 'Listen');
      const interactBtn = getButtonByLabel(host as unknown as ParentNode, 'Interact');

      act(() => {
        listenBtn.click();
      });
      assert.equal(badge.textContent?.trim(), 'Listening');
      assert.equal(listenBtn.getAttribute('aria-pressed'), 'true');

      act(() => {
        interactBtn.click();
      });
      assert.equal(badge.textContent?.trim(), 'Attentive');
      assert.equal(listenBtn.getAttribute('aria-pressed'), 'false');
      assert.match(host.querySelector('.avatar-scene__meta-detail')?.textContent ?? '', /Idle 0s \/ 30s/);
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('HUD DOM: SPEAKING -> click Interact -> immediately renders "Attentive"', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      act(() => {
        root.render(React.createElement(AvatarScene));
      });

      const badge = host.querySelector('.avatar-scene__state-badge');
      assert.ok(badge, 'Expected HUD state badge');
      assert.equal(badge.textContent?.trim(), 'Attentive');

      const speakBtn = getButtonByLabel(host as unknown as ParentNode, 'Speak');
      const interactBtn = getButtonByLabel(host as unknown as ParentNode, 'Interact');

      act(() => {
        speakBtn.click();
      });
      assert.equal(badge.textContent?.trim(), 'Speaking');
      assert.equal(speakBtn.getAttribute('aria-pressed'), 'true');

      act(() => {
        interactBtn.click();
      });
      assert.equal(badge.textContent?.trim(), 'Attentive');
      assert.equal(speakBtn.getAttribute('aria-pressed'), 'false');
      assert.match(host.querySelector('.avatar-scene__meta-detail')?.textContent ?? '', /Idle 0s \/ 30s/);
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });
});
