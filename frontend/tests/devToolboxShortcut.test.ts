import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(TEST_DIR, '..');

interface FloatingTopBarProps {
  framingMode: 'waist' | 'full';
  onToggleFraming: () => void;
  theme: 'system' | 'light' | 'dark';
  onToggleTheme: () => void;
  historyCount: number;
  isHistoryOpen: boolean;
  onToggleHistory: () => void;
  showDevControls?: boolean;
  onToggleDevControls?: () => void;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  isAudioPlaying?: boolean;
}

interface FloatingTopBarModule {
  FloatingTopBar: React.ComponentType<FloatingTopBarProps>;
}

describe('Final Developer Toolbox Access Modification', () => {
  let vite: ViteDevServer;
  let happyWindow: Window;
  let AppComp: React.ComponentType;
  let FloatingTopBarComp: React.ComponentType<FloatingTopBarProps>;

  before(async () => {
    happyWindow = new Window({ url: 'http://localhost:5173/' });
    Object.assign(globalThis, {
      window: happyWindow,
      document: happyWindow.document,
      HTMLElement: happyWindow.HTMLElement,
      HTMLButtonElement: happyWindow.HTMLButtonElement,
      HTMLInputElement: happyWindow.HTMLInputElement,
      HTMLTextAreaElement: happyWindow.HTMLTextAreaElement,
      HTMLSelectElement: happyWindow.HTMLSelectElement,
      Node: happyWindow.Node,
      Event: happyWindow.Event,
      MouseEvent: happyWindow.MouseEvent,
      KeyboardEvent: happyWindow.KeyboardEvent,
      StorageEvent: happyWindow.StorageEvent,
      localStorage: happyWindow.localStorage,
      fetch: async () => ({
        ok: true,
        json: async () => ({ session_id: 'test-dev-toolbox-sess' }),
      }),
      IS_REACT_ACT_ENVIRONMENT: true,
    });

    vite = await createServer({
      root: FRONTEND_ROOT,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
      plugins: [
        {
          name: 'mock-avatar-viewer-for-dev-toolbox',
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
                const stableToggle = () => {};
                const stableReset = () => {};
                const stableRef = { current: null };
                const stableLoadState = { status: 'ready', progress: 100, errorMessage: null };
                const stableSummary = {
                  name: 'Aria Avatar',
                  specVersion: '1.0',
                  authors: ['Aria Team'],
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
                };

                export function useAvatarViewer() {
                  return {
                    loadState: stableLoadState,
                    modelSummary: stableSummary,
                    containerRef: stableRef,
                    framingMode: 'full',
                    toggleFramingMode: stableToggle,
                    resetFraming: stableReset,
                    retryLoad: stableReset,
                  };
                }
              `;
            }
            return null;
          },
        },
      ],
    });

    const appMod = (await vite.ssrLoadModule('/src/App.tsx')) as { App: React.ComponentType };
    AppComp = appMod.App;

    const topBarMod = (await vite.ssrLoadModule('/src/components/chat/FloatingTopBar.tsx')) as FloatingTopBarModule;
    FloatingTopBarComp = topBarMod.FloatingTopBar;
  });

  after(async () => {
    await vite?.close();
  });

  it('1. Completely removes visible Dev gear button from top-right FloatingTopBar', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      act(() => {
        root.render(
          React.createElement(FloatingTopBarComp, {
            framingMode: 'full',
            onToggleFraming: () => {},
            theme: 'dark',
            onToggleTheme: () => {},
            historyCount: 0,
            isHistoryOpen: false,
            onToggleHistory: () => {},
            showDevControls: true,
            onToggleDevControls: () => {},
          }),
        );
      });

      // Assert no button with Dev controls aria-label exists
      const devBtnByAria = host.querySelector('[aria-label="Toggle Developer Controls"]');
      assert.equal(devBtnByAria, null, 'Visible Dev button with aria-label="Toggle Developer Controls" must not exist');

      // Assert no button with "Dev" text exists
      const allButtons = Array.from(host.querySelectorAll('button'));
      const devBtnByText = allButtons.find((btn) => btn.textContent?.trim().includes('Dev'));
      assert.equal(devBtnByText, undefined, 'No button containing "Dev" text should be displayed in the top bar');

      // Ensure public UI actions still include Framing, Theme, History
      const framingBtn = host.querySelector('[aria-label="Switch to Waist Up Framing"]');
      const themeBtn = host.querySelector('[aria-label^="Change theme"]');
      const historyBtn = host.querySelector('[aria-label="Toggle Conversation History"]');
      assert.ok(framingBtn, 'Camera framing button must be present');
      assert.ok(themeBtn, 'Theme button must be present');
      assert.ok(historyBtn, 'Conversation history button must be present');
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('2. Pressing Ctrl + Shift + D opens developer toolbox, and pressing again toggles it closed', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      // Ensure window is focused
      happyWindow.document.hasFocus = () => true;

      act(() => {
        root.render(React.createElement(AppComp));
      });

      // Initially, developer toolbox must NOT be rendered
      assert.equal(
        host.querySelector('.avatar-scene__dev-stack'),
        null,
        'Developer toolbox should initially be closed',
      );

      // Press Ctrl + Shift + D -> opens developer toolbox
      let event1!: InstanceType<typeof happyWindow.KeyboardEvent>;
      act(() => {
        event1 = new happyWindow.KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        happyWindow.dispatchEvent(event1);
      });

      assert.equal(event1.defaultPrevented, true, 'Shortcut must prevent browser default');
      const devStackOpen = host.querySelector('.avatar-scene__dev-stack');
      assert.ok(devStackOpen, 'Developer toolbox should open upon pressing Ctrl + Shift + D');

      // Verify developer panels are present
      assert.ok(host.querySelector('.avatar-scene__dev-panel'), 'Dev idle/posture panel should be present');
      assert.ok(host.querySelector('.avatar-scene__dev-expressions'), 'Dev expressions panel should be present');
      assert.ok(host.querySelector('.avatar-scene__dev-gestures'), 'Dev gestures panel should be present');
      assert.ok(host.querySelector('.avatar-scene__dev-activities'), 'Dev activities panel should be present');

      // Press Ctrl + Shift + D again -> toggles closed
      let event2!: InstanceType<typeof happyWindow.KeyboardEvent>;
      act(() => {
        event2 = new happyWindow.KeyboardEvent('keydown', {
          key: 'd',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        happyWindow.dispatchEvent(event2);
      });

      assert.equal(event2.defaultPrevented, true, 'Toggle-close shortcut must prevent browser default');
      assert.equal(
        host.querySelector('.avatar-scene__dev-stack'),
        null,
        'Developer toolbox should close upon pressing Ctrl + Shift + D again',
      );
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('3. Pressing Escape closes developer toolbox when open, and does nothing when closed', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      happyWindow.document.hasFocus = () => true;

      act(() => {
        root.render(React.createElement(AppComp));
      });

      // Open developer toolbox with Ctrl + Shift + D
      act(() => {
        const openEvent = new happyWindow.KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        happyWindow.dispatchEvent(openEvent);
      });

      assert.ok(host.querySelector('.avatar-scene__dev-stack'), 'Developer toolbox should be open');

      // Press Escape -> closes toolbox
      act(() => {
        const escapeEvent = new happyWindow.KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
        });
        happyWindow.dispatchEvent(escapeEvent);
      });

      assert.equal(
        host.querySelector('.avatar-scene__dev-stack'),
        null,
        'Pressing Escape must close the developer toolbox',
      );

      // Press Escape again while closed -> remains closed with no errors
      act(() => {
        const escapeEvent2 = new happyWindow.KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
        });
        happyWindow.dispatchEvent(escapeEvent2);
      });

      assert.equal(host.querySelector('.avatar-scene__dev-stack'), null);
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('4. Shortcut works only when the application window is focused', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      // Simulate blurred / unfocused window
      happyWindow.document.hasFocus = () => false;

      act(() => {
        root.render(React.createElement(AppComp));
      });

      // Press Ctrl + Shift + D while unfocused
      let unfocusedEvent!: InstanceType<typeof happyWindow.KeyboardEvent>;
      act(() => {
        unfocusedEvent = new happyWindow.KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        happyWindow.dispatchEvent(unfocusedEvent);
      });

      assert.equal(unfocusedEvent.defaultPrevented, false, 'Shortcut must not prevent default when window unfocused');
      assert.equal(
        host.querySelector('.avatar-scene__dev-stack'),
        null,
        'Developer toolbox must not open when document is not focused',
      );

      // Now restore focus
      happyWindow.document.hasFocus = () => true;

      act(() => {
        const focusedEvent = new happyWindow.KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        happyWindow.dispatchEvent(focusedEvent);
      });

      assert.ok(
        host.querySelector('.avatar-scene__dev-stack'),
        'Developer toolbox should open once document has focus',
      );
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('5. Ignores shortcut when user is typing in input, textarea, select, or contenteditable elements', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    try {
      happyWindow.document.hasFocus = () => true;

      act(() => {
        root.render(React.createElement(AppComp));
      });

      // A. Text input
      const inputEl = happyWindow.document.createElement('input');
      host.appendChild(inputEl);
      let inputEvent!: InstanceType<typeof happyWindow.KeyboardEvent>;
      act(() => {
        inputEvent = new happyWindow.KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        inputEl.dispatchEvent(inputEvent);
      });
      assert.equal(inputEvent.defaultPrevented, false);
      assert.equal(host.querySelector('.avatar-scene__dev-stack'), null, 'Must ignore shortcut in <input>');

      // B. Textarea
      const textareaEl = happyWindow.document.createElement('textarea');
      host.appendChild(textareaEl);
      let textareaEvent!: InstanceType<typeof happyWindow.KeyboardEvent>;
      act(() => {
        textareaEvent = new happyWindow.KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        textareaEl.dispatchEvent(textareaEvent);
      });
      assert.equal(textareaEvent.defaultPrevented, false);
      assert.equal(host.querySelector('.avatar-scene__dev-stack'), null, 'Must ignore shortcut in <textarea>');

      // C. Select
      const selectEl = happyWindow.document.createElement('select');
      host.appendChild(selectEl);
      let selectEvent!: InstanceType<typeof happyWindow.KeyboardEvent>;
      act(() => {
        selectEvent = new happyWindow.KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        selectEl.dispatchEvent(selectEvent);
      });
      assert.equal(selectEvent.defaultPrevented, false);
      assert.equal(host.querySelector('.avatar-scene__dev-stack'), null, 'Must ignore shortcut in <select>');

      // D. ContentEditable
      const editableEl = happyWindow.document.createElement('div');
      editableEl.setAttribute('contenteditable', 'true');
      host.appendChild(editableEl);
      let editableEvent!: InstanceType<typeof happyWindow.KeyboardEvent>;
      act(() => {
        editableEvent = new happyWindow.KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        editableEl.dispatchEvent(editableEvent);
      });
      assert.equal(editableEvent.defaultPrevented, false);
      assert.equal(host.querySelector('.avatar-scene__dev-stack'), null, 'Must ignore shortcut in contenteditable');
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('6. Cleans up event listeners cleanly on unmount without leaking handlers', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    happyWindow.document.hasFocus = () => true;

    act(() => {
      root.render(React.createElement(AppComp));
    });

    // Unmount component
    act(() => {
      root.unmount();
    });
    host.remove();

    // Dispatching shortcut after unmount must not trigger errors or side effects
    let afterUnmountEvent!: InstanceType<typeof happyWindow.KeyboardEvent>;
    act(() => {
      afterUnmountEvent = new happyWindow.KeyboardEvent('keydown', {
        key: 'D',
        code: 'KeyD',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      happyWindow.dispatchEvent(afterUnmountEvent);
    });

    assert.equal(
      afterUnmountEvent.defaultPrevented,
      false,
      'Listener must have been removed from window on unmount',
    );
  });
});
