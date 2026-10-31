import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import React, { act, StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

import type { UseAttentionSystemOptions, UseAttentionSystemResult } from '../src/hooks/useAttentionSystem.ts';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(TEST_DIR, '..');

interface ErrorBoundaryProps {
  name?: string;
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  children?: React.ReactNode;
}

interface ErrorBoundaryModule {
  ErrorBoundary: React.ComponentClass<ErrorBoundaryProps>;
}

interface AttentionHookModule {
  useAttentionSystem: (options?: UseAttentionSystemOptions) => UseAttentionSystemResult;
}

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

function getInternalField<T = unknown>(target: unknown, field: string): T {
  return (target as Record<string, T>)[field];
}

describe('Architecture Safety Audit — React StrictMode & Avatar Controller Lifecycle', () => {
  let vite: ViteDevServer;
  let ErrorBoundary: ErrorBoundaryModule['ErrorBoundary'];
  let useAttentionSystem: AttentionHookModule['useAttentionSystem'];
  let AvatarScene: AvatarSceneModule['AvatarScene'];
  let createRootFn: (container: Element | DocumentFragment) => Root;
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

    const reactDomClient = await import('react-dom/client');
    createRootFn = reactDomClient.createRoot;

    vite = await createServer({
      root: FRONTEND_ROOT,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
      plugins: [
        {
          name: 'mock-avatar-viewer-lifecycle',
          enforce: 'pre',
          resolveId(id) {
            if (id.endsWith('/hooks/useAvatarViewer') || id === '../hooks/useAvatarViewer') {
              return '\0virtual:useAvatarViewerLifecycle';
            }
            return null;
          },
          load(id) {
            if (id === '\0virtual:useAvatarViewerLifecycle') {
              return `
                export function useAvatarViewer() {
                  return {
                    loadState: { status: 'ready', progress: 100, errorMessage: null },
                    modelSummary: {
                      name: 'Aria',
                      specVersion: '1.0',
                      authors: ['Antigravity'],
                      presetExpressions: ['happy', 'relaxed'],
                      customExpressions: [],
                      allExpressions: ['happy', 'relaxed'],
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

    const ebMod = (await vite.ssrLoadModule('/src/components/common/ErrorBoundary.tsx')) as ErrorBoundaryModule;
    ErrorBoundary = ebMod.ErrorBoundary;

    const attMod = (await vite.ssrLoadModule('/src/hooks/useAttentionSystem.ts')) as AttentionHookModule;
    useAttentionSystem = attMod.useAttentionSystem;

    const sceneMod = (await vite.ssrLoadModule('/src/components/AvatarScene.tsx')) as AvatarSceneModule;
    AvatarScene = sceneMod.AvatarScene;
  });

  after(async () => {
    await vite?.close();
  });

  it('1. Root ErrorBoundary catches rendering exceptions and renders accessible alert card', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    function CrashingComponent(): React.ReactNode {
      throw new Error('Simulated root rendering failure');
    }

    // Suppress console.error during expected throw
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      act(() => {
        root.render(
          React.createElement(
            ErrorBoundary,
            { name: 'Root' },
            React.createElement(CrashingComponent),
          ),
        );
      });

      const alert = host.querySelector('.companion-error-boundary');
      assert.ok(alert, 'Expected .companion-error-boundary container in DOM');
      assert.equal(alert.getAttribute('role'), 'alert');

      const title = host.querySelector('.companion-error-boundary__title');
      assert.equal(title?.textContent?.trim(), 'Root Error');

      const message = host.querySelector('.companion-error-boundary__message');
      assert.ok(
        message?.textContent?.includes('Simulated root rendering failure') ||
          message?.textContent?.includes('An unexpected rendering error occurred'),
      );
    } finally {
      console.error = originalConsoleError;
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('2. AvatarStage failure does not crash ChatOverlay (isolated boundary domains)', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    function CrashingAvatarStage(): React.ReactNode {
      throw new Error('3D WebGL Context Crash');
    }

    function WorkingChatOverlay(): React.ReactNode {
      return React.createElement('div', { className: 'test-chat-overlay' }, 'Chat UI Functional');
    }

    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      act(() => {
        root.render(
          React.createElement(
            'div',
            { className: 'app-shell' },
            React.createElement(
              ErrorBoundary,
              { name: 'AvatarStage' },
              React.createElement(CrashingAvatarStage),
            ),
            React.createElement(
              ErrorBoundary,
              { name: 'ChatOverlay' },
              React.createElement(WorkingChatOverlay),
            ),
          ),
        );
      });

      const avatarError = host.querySelector('.companion-error-boundary__title');
      assert.equal(avatarError?.textContent?.trim(), 'AvatarStage Error');

      const chatUi = host.querySelector('.test-chat-overlay');
      assert.ok(chatUi, 'ChatOverlay must remain mounted and functional when AvatarStage crashes');
      assert.equal(chatUi.textContent, 'Chat UI Functional');
    } finally {
      console.error = originalConsoleError;
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('3. ChatOverlay failure does not crash AvatarStage', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    function WorkingAvatarStage(): React.ReactNode {
      return React.createElement('div', { className: 'test-avatar-stage' }, '3D Stage Rendering');
    }

    function CrashingChatOverlay(): React.ReactNode {
      throw new Error('Chat Network Stream Exception');
    }

    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      act(() => {
        root.render(
          React.createElement(
            'div',
            { className: 'app-shell' },
            React.createElement(
              ErrorBoundary,
              { name: 'AvatarStage' },
              React.createElement(WorkingAvatarStage),
            ),
            React.createElement(
              ErrorBoundary,
              { name: 'ChatOverlay' },
              React.createElement(CrashingChatOverlay),
            ),
          ),
        );
      });

      const stageUi = host.querySelector('.test-avatar-stage');
      assert.ok(stageUi, 'AvatarStage must remain mounted when ChatOverlay crashes');
      assert.equal(stageUi.textContent, '3D Stage Rendering');

      const chatError = host.querySelector('.companion-error-boundary__title');
      assert.equal(chatError?.textContent?.trim(), 'ChatOverlay Error');
    } finally {
      console.error = originalConsoleError;
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('4. Recovery remounts the failed subtree when Try Again is clicked', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    let shouldCrash = true;
    function ConditionalComponent(): React.ReactNode {
      if (shouldCrash) {
        throw new Error('Transient initialization failure');
      }
      return React.createElement('div', { className: 'recovered-content' }, 'Successfully Recovered');
    }

    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      act(() => {
        root.render(
          React.createElement(
            ErrorBoundary,
            { name: 'RecoverableSubtree' },
            React.createElement(ConditionalComponent),
          ),
        );
      });

      assert.ok(host.querySelector('.companion-error-boundary'));
      assert.equal(host.querySelector('.recovered-content'), null);

      // Fix underlying transient condition and trigger Try Again
      shouldCrash = false;
      const tryAgainBtn = host.querySelector('.companion-error-boundary__btn') as HTMLButtonElement | null;
      assert.ok(tryAgainBtn);

      act(() => {
        tryAgainBtn.click();
      });

      assert.equal(host.querySelector('.companion-error-boundary'), null);
      const recovered = host.querySelector('.recovered-content');
      assert.ok(recovered, 'Expected subtree to remount cleanly upon recovery');
      assert.equal(recovered.textContent, 'Successfully Recovered');
    } finally {
      console.error = originalConsoleError;
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('5. Error details do not expose sensitive internal details when fallback message is requested', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      act(() => {
        root.render(
          React.createElement(
            ErrorBoundary,
            {
              name: 'SecureStage',
              fallback: (_err: Error, reset: () => void) =>
                React.createElement(
                  'div',
                  { className: 'sanitized-fallback' },
                  React.createElement('span', null, 'Component unavailable'),
                  React.createElement('button', { onClick: reset }, 'Retry'),
                ),
            },
            React.createElement(() => {
              throw new Error('API Key secret_token_xyz failed at http://internal.corp');
            }),
          ),
        );
      });

      const text = host.textContent ?? '';
      assert.equal(text.includes('secret_token_xyz'), false, 'Sensitive tokens must not be exposed in DOM');
      assert.equal(text.includes('http://internal.corp'), false, 'Internal URLs must not be exposed in DOM');
      assert.ok(text.includes('Component unavailable'));
    } finally {
      console.error = originalConsoleError;
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('6. React 19 StrictMode double-mounting does not clear subscriptions or corrupt controller callbacks', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    let systemInstance!: UseAttentionSystemResult;
    function StrictModeHarness() {
      const sys = useAttentionSystem();
      React.useEffect(() => {
        systemInstance = sys;
      });
      return React.createElement('div', { 'data-state': sys.status.state }, sys.status.state);
    }

    try {
      act(() => {
        root.render(
          React.createElement(
            StrictMode,
            null,
            React.createElement(StrictModeHarness),
          ),
        );
      });

      assert.ok(systemInstance, 'Expected systemInstance');
      // Subscriptions must survive StrictMode remount without dropping
      const attListeners = getInternalField<Set<unknown>>(systemInstance.attention, 'listeners');
      const exprListeners = getInternalField<Set<unknown>>(systemInstance.expressionController, 'listeners');
      const gestListeners = getInternalField<Set<unknown>>(systemInstance.gestureController, 'listeners');

      assert.ok(attListeners.size >= 1, 'AttentionController must retain active subscribers');
      assert.ok(exprListeners.size >= 1, 'ExpressionController must retain active subscribers');
      assert.ok(gestListeners.size >= 1, 'GestureController must retain active subscribers');

      // Handlers must remain wired functions (not set to undefined by StrictMode cleanup)
      assert.equal(typeof getInternalField(systemInstance.gestureController, 'onUpperBodyOffset'), 'function');
      assert.equal(typeof getInternalField(systemInstance.gestureController, 'onHeadAccent'), 'function');
      assert.equal(typeof getInternalField(systemInstance.naturalIdleController, 'onPelvicOffset'), 'function');

      // State transitions triggered through hook propagate properly via useSyncExternalStore
      act(() => {
        systemInstance.setConversationMode('LISTENING');
      });
      assert.equal(systemInstance.status.state, 'LISTENING');
      assert.equal(host.querySelector('div')?.getAttribute('data-state'), 'LISTENING');

      act(() => {
        systemInstance.returnToAttentive();
      });
      assert.equal(systemInstance.status.state, 'ATTENTIVE');
      assert.equal(host.querySelector('div')?.getAttribute('data-state'), 'ATTENTIVE');
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('7. Unmounting and remounting AvatarScene leaves shared controller state and listeners completely intact', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    let sharedSys!: UseAttentionSystemResult;
    function ParentApp({ showScene }: { showScene: boolean }) {
      const sys = useAttentionSystem();
      React.useEffect(() => {
        sharedSys = sys;
      });
      return React.createElement(
        'div',
        null,
        React.createElement('span', { 'data-state': sys.status.state }, sys.status.state),
        showScene
          ? React.createElement(AvatarScene, {
              attentionSystem: sys,
              controllers: sys.controllerSlots,
              showHud: false,
              showDevControls: false,
            })
          : null,
      );
    }

    try {
      // 1. Initial render with AvatarScene mounted
      act(() => {
        root.render(React.createElement(ParentApp, { showScene: true }));
      });

      const initialAttentionListeners = getInternalField<Set<unknown>>(sharedSys.attention, 'listeners').size;
      const initialGestureListeners = getInternalField<Set<unknown>>(sharedSys.gestureController, 'listeners').size;
      assert.ok(initialAttentionListeners >= 1);
      assert.ok(initialGestureListeners >= 1);
      assert.equal(typeof getInternalField(sharedSys.gestureController, 'onUpperBodyOffset'), 'function');

      // 2. Unmount AvatarScene (e.g. ErrorBoundary catches error or view is toggled)
      act(() => {
        root.render(React.createElement(ParentApp, { showScene: false }));
      });

      // Crucial verification: shared controller graph must NOT have been disposed!
      const remainingGestureListeners = getInternalField<Set<unknown>>(sharedSys.gestureController, 'listeners').size;
      assert.ok(remainingGestureListeners >= 1, 'GestureController listeners must survive AvatarScene unmount');
      assert.equal(typeof getInternalField(sharedSys.gestureController, 'onUpperBodyOffset'), 'function', 'Gesture upper body offset handler must remain wired');
      assert.equal(typeof getInternalField(sharedSys.gestureController, 'onHeadAccent'), 'function', 'Gesture head accent handler must remain wired');
      assert.equal(typeof getInternalField(sharedSys.naturalIdleController, 'onPelvicOffset'), 'function', 'Pelvic offset handler must remain wired');

      // 3. Remount AvatarScene
      act(() => {
        root.render(React.createElement(ParentApp, { showScene: true }));
      });

      assert.equal(typeof getInternalField(sharedSys.gestureController, 'onUpperBodyOffset'), 'function');
      assert.equal(sharedSys.status.state, 'ATTENTIVE');
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });

  it('8. Unmounting the complete application cleanly unregisters global listeners and handlers', () => {
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRootFn(host as unknown as Element);

    let capturedSys!: UseAttentionSystemResult;
    function TestApp() {
      const sys = useAttentionSystem();
      React.useEffect(() => {
        capturedSys = sys;
      });
      return null;
    }

    act(() => {
      root.render(React.createElement(TestApp));
    });

    assert.ok(capturedSys);
    assert.equal(typeof getInternalField(capturedSys.gestureController, 'onUpperBodyOffset'), 'function');

    // Unmount the entire application
    act(() => {
      root.unmount();
    });

    // Cleanup must have detached inter-controller handlers
    assert.equal(getInternalField(capturedSys.gestureController, 'onUpperBodyOffset'), undefined);
    assert.equal(getInternalField(capturedSys.gestureController, 'onHeadAccent'), undefined);
    assert.equal(getInternalField(capturedSys.naturalIdleController, 'onPelvicOffset'), undefined);

    host.remove();
  });
});
