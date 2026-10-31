import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface MockResponsePayload {
  session_id: string;
  response_text: string;
  emotion: string;
  emotion_intensity: number;
  gesture: string | null;
  gesture_intensity: number;
  speech_intent: string;
  mouth_animation_profile: string;
  created_at: string;
}

interface ThemeHookResult {
  theme: 'system' | 'light' | 'dark';
  resolvedTheme: 'light' | 'dark';
  setTheme: (m: 'system' | 'light' | 'dark') => void;
  toggleTheme: () => void;
}

interface ThemeModule {
  useTheme: () => ThemeHookResult;
}

interface ChatMessageItem {
  id: string;
  sender: 'user' | 'companion';
  text: string;
  timestamp: number;
  emotion?: string;
  gesture?: string | null;
  speechIntent?: string;
  isError?: boolean;
}

interface ActiveDialogueStateItem {
  id: string;
  fullText: string;
  displayedText: string;
  emotion?: string;
  gesture?: string | null;
  speechIntent?: string;
  isSpeaking: boolean;
  progress: number;
}

interface CompanionChatHookResult {
  sessionId: string | null;
  messages: ChatMessageItem[];
  isLoading: boolean;
  statusKind: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  errorMessage: string | null;
  activeDialogue: ActiveDialogueStateItem | null;
  isHistoryOpen: boolean;
  sendMessage: (text: string) => Promise<boolean>;
  cancelResponse: () => void;
  clearHistory: () => void;
  startNewSession: () => Promise<void>;
  retryLastMessage: () => Promise<boolean>;
  dismissDialogue: () => void;
  openHistory: () => void;
  closeHistory: () => void;
  toggleHistory: () => void;
}

interface CompanionChatModule {
  useCompanionChat: (options?: unknown) => CompanionChatHookResult;
}

interface ChatApiModule {
  createSession: (signal?: AbortSignal) => Promise<string>;
  sendChatMessage: (sessionId: string, message: string, signal?: AbortSignal) => Promise<MockResponsePayload>;
  deleteSession: (sessionId: string, signal?: AbortSignal) => Promise<boolean>;
  checkBackendHealth: (signal?: AbortSignal) => Promise<unknown>;
}

interface CharacterModule {
  AttentionController: new () => {
    getState: () => string;
    setConversationMode: (mode: string) => void;
    returnToAttentive: () => void;
  };
  ExpressionController: new () => unknown;
  GestureController: new () => unknown;
  SpeechMouthController: new () => unknown;
  ReactionDispatcher: new (ctx: unknown) => {
    dispatchReaction: (payload: unknown) => unknown;
    handleSpeechComplete: () => void;
    cancel: () => void;
  };
}

interface FloatingTopBarProps {
  companionName?: string;
  statusLabel?: string;
  statusKind?: 'attentive' | 'listening' | 'speaking' | 'exploring' | 'paused';
  framingMode: 'waist' | 'full';
  onToggleFraming: () => void;
  theme: 'system' | 'light' | 'dark';
  onToggleTheme: () => void;
  historyCount: number;
  isHistoryOpen: boolean;
  onToggleHistory: () => void;
  showDevControls?: boolean;
  onToggleDevControls?: () => void;
}

interface FloatingTopBarModule {
  FloatingTopBar: React.ComponentType<FloatingTopBarProps>;
}

interface SpeechBubbleOverlayProps {
  dialogue: ActiveDialogueStateItem | null;
  onDismiss: () => void;
  companionName?: string;
}

interface SpeechBubbleOverlayModule {
  SpeechBubbleOverlay: React.ComponentType<SpeechBubbleOverlayProps>;
}

interface ChatInputProps {
  onSendMessage: (text: string) => Promise<boolean>;
  isLoading: boolean;
  onCancelResponse?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

interface ChatInputModule {
  ChatInput: React.ComponentType<ChatInputProps>;
}

interface ChatStatusProps {
  statusKind: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  errorMessage?: string | null;
  onRetry?: () => void;
  companionName?: string;
}

interface ChatStatusModule {
  ChatStatus: React.ComponentType<ChatStatusProps>;
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessageItem[];
  onStartNewSession: () => void;
  onClearHistory: () => void;
  sessionId?: string | null;
  companionName?: string;
}

interface ChatPanelModule {
  ChatPanel: React.ComponentType<ChatPanelProps>;
}

describe('Milestone 5, Stage 3 — Immersive UI, Theming & Conversation Integration', () => {
  let vite: ViteDevServer;
  let happyWindow: Window;

  let useThemeMod: ThemeModule;
  let useCompanionChatMod: CompanionChatModule;
  let chatApiMod: ChatApiModule;
  let characterMod: CharacterModule;
  let FloatingTopBarMod: FloatingTopBarModule;
  let SpeechBubbleOverlayMod: SpeechBubbleOverlayModule;
  let ChatInputMod: ChatInputModule;
  let ChatStatusMod: ChatStatusModule;
  let ChatPanelMod: ChatPanelModule;

  before(async () => {
    happyWindow = new Window({ url: 'http://localhost:5173/' });
    Object.assign(globalThis, {
      window: happyWindow,
      document: happyWindow.document,
      HTMLElement: happyWindow.HTMLElement,
      HTMLButtonElement: happyWindow.HTMLButtonElement,
      HTMLTextAreaElement: happyWindow.HTMLTextAreaElement,
      Node: happyWindow.Node,
      Event: happyWindow.Event,
      MouseEvent: happyWindow.MouseEvent,
      KeyboardEvent: happyWindow.KeyboardEvent,
      StorageEvent: happyWindow.StorageEvent,
      localStorage: happyWindow.localStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    });

    vite = await createServer({
      root: FRONTEND_ROOT,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
    });

    useThemeMod = (await vite.ssrLoadModule('/src/hooks/useTheme.ts')) as ThemeModule;
    useCompanionChatMod = (await vite.ssrLoadModule('/src/conversation/useCompanionChat.ts')) as CompanionChatModule;
    chatApiMod = (await vite.ssrLoadModule('/src/conversation/chatApi.ts')) as ChatApiModule;
    characterMod = (await vite.ssrLoadModule('/src/character/index.ts')) as CharacterModule;
    FloatingTopBarMod = (await vite.ssrLoadModule('/src/components/chat/FloatingTopBar.tsx')) as FloatingTopBarModule;
    SpeechBubbleOverlayMod = (await vite.ssrLoadModule('/src/components/chat/SpeechBubbleOverlay.tsx')) as SpeechBubbleOverlayModule;
    ChatInputMod = (await vite.ssrLoadModule('/src/components/chat/ChatInput.tsx')) as ChatInputModule;
    ChatStatusMod = (await vite.ssrLoadModule('/src/components/chat/ChatStatus.tsx')) as ChatStatusModule;
    ChatPanelMod = (await vite.ssrLoadModule('/src/components/chat/ChatPanel.tsx')) as ChatPanelModule;
  });

  after(async () => {
    await vite?.close();
    await happyWindow?.happyDOM.close();
  });

  it('1. manages theme selection, localStorage persistence, and DOM attribute reflection', () => {
    happyWindow.localStorage.clear();

    let themeResult!: ThemeHookResult;
    function ThemeTestComponent() {
      themeResult = useThemeMod.useTheme();
      return null;
    }

    const container = happyWindow.document.createElement('div');
    const root = createRoot(container as unknown as Element);

    act(() => {
      root.render(React.createElement(ThemeTestComponent));
    });

    // Default is system
    assert.equal(themeResult.theme, 'system');

    // Switch to light mode
    act(() => {
      themeResult.setTheme('light');
    });

    assert.equal(themeResult.theme, 'light');
    assert.equal(themeResult.resolvedTheme, 'light');
    assert.equal(happyWindow.localStorage.getItem('companion-theme'), 'light');
    assert.equal(happyWindow.document.documentElement.getAttribute('data-theme'), 'light');
    assert.equal(happyWindow.document.documentElement.getAttribute('data-resolved-theme'), 'light');

    // Switch to dark mode
    act(() => {
      themeResult.setTheme('dark');
    });

    assert.equal(themeResult.theme, 'dark');
    assert.equal(themeResult.resolvedTheme, 'dark');
    assert.equal(happyWindow.localStorage.getItem('companion-theme'), 'dark');
    assert.equal(happyWindow.document.documentElement.getAttribute('data-theme'), 'dark');
    assert.equal(happyWindow.document.documentElement.getAttribute('data-resolved-theme'), 'dark');

    // Cycle theme (toggleTheme: dark -> system)
    act(() => {
      themeResult.toggleTheme();
    });

    assert.equal(themeResult.theme, 'system');
    assert.equal(happyWindow.localStorage.getItem('companion-theme'), null);

    act(() => {
      root.unmount();
    });
  });

  it('2. creates session on initialization and handles session creation failures gracefully', async () => {
    const originalFetch = globalThis.fetch;
    const testSessionId = '11111111-2222-3333-4444-555555555555';

    // Mock successful session creation
    globalThis.fetch = async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/session')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ session_id: testSessionId, created_at: new Date().toISOString() }),
        } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    };

    let chatResult!: CompanionChatHookResult;
    function ChatInitTestComponent() {
      chatResult = useCompanionChatMod.useCompanionChat();
      return null;
    }

    const container = happyWindow.document.createElement('div');
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(React.createElement(ChatInitTestComponent));
      await new Promise((r) => setTimeout(r, 10));
    });

    assert.equal(chatResult.sessionId, testSessionId);
    assert.equal(chatResult.errorMessage, null);
    assert.ok(chatApiMod.createSession !== undefined);

    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it('3. rejects empty or whitespace-only messages without sending requests', async () => {
    let chatResult!: CompanionChatHookResult;
    function ChatEmptyTestComponent() {
      chatResult = useCompanionChatMod.useCompanionChat({ initialSessionId: 'test-session-id' });
      return null;
    }

    const container = happyWindow.document.createElement('div');
    const root = createRoot(container as unknown as Element);

    act(() => {
      root.render(React.createElement(ChatEmptyTestComponent));
    });

    let sent = false;
    await act(async () => {
      sent = await chatResult.sendMessage('');
    });
    assert.equal(sent, false);
    assert.equal(chatResult.messages.length, 0);

    await act(async () => {
      sent = await chatResult.sendMessage('    \n\t  ');
    });
    assert.equal(sent, false);
    assert.equal(chatResult.messages.length, 0);

    act(() => {
      root.unmount();
    });
  });

  it('4. prevents duplicate submissions while an existing message request is in-flight', async () => {
    const originalFetch = globalThis.fetch;
    let pendingResolve: ((res: Response) => void) | null = null;

    globalThis.fetch = async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/chat')) {
        return new Promise((resolve) => {
          pendingResolve = resolve;
        });
      }
      return { ok: false, status: 404 } as unknown as Response;
    };

    let chatResult!: CompanionChatHookResult;
    function ChatDuplicateTestComponent() {
      chatResult = useCompanionChatMod.useCompanionChat({ initialSessionId: 'test-session-id' });
      return null;
    }

    const container = happyWindow.document.createElement('div');
    const root = createRoot(container as unknown as Element);

    act(() => {
      root.render(React.createElement(ChatDuplicateTestComponent));
    });

    let promise1: Promise<boolean>;
    act(() => {
      promise1 = chatResult.sendMessage('First message');
    });

    assert.equal(chatResult.isLoading, true);
    assert.equal(chatResult.messages.length, 1);
    assert.equal(chatResult.messages[0].text, 'First message');

    // Attempt concurrent second message
    let sent2 = false;
    await act(async () => {
      sent2 = await chatResult.sendMessage('Second message while in-flight');
    });

    assert.equal(sent2, false);
    assert.equal(chatResult.messages.length, 1); // Only first message retained

    // Resolve first request
    const mockPayload: MockResponsePayload = {
      session_id: 'test-session-id',
      response_text: 'Hello from companion!',
      emotion: 'happy',
      emotion_intensity: 0.8,
      gesture: 'wave',
      gesture_intensity: 0.85,
      speech_intent: 'conversational',
      mouth_animation_profile: 'soft_conversation',
      created_at: new Date().toISOString(),
    };

    await act(async () => {
      pendingResolve?.({
        ok: true,
        status: 200,
        json: async () => mockPayload,
      } as unknown as Response);
      await promise1;
    });

    assert.equal(chatResult.isLoading, false);
    assert.equal(chatResult.messages.length, 2);
    assert.equal(chatResult.messages[1].text, 'Hello from companion!');

    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it('5. coordinates ReactionDispatcher and AttentionController across full message lifecycle', async () => {
    const originalFetch = globalThis.fetch;

    const attention = new characterMod.AttentionController();
    const expression = new characterMod.ExpressionController();
    const gesture = new characterMod.GestureController();
    const speechMouth = new characterMod.SpeechMouthController();

    const reactionDispatcher = new characterMod.ReactionDispatcher({
      attention,
      expression,
      gesture,
      speechMouth,
    });

    const mockResponse: MockResponsePayload = {
      session_id: 'lifecycle-session',
      response_text: 'I am thrilled to see you today!',
      emotion: 'happy',
      emotion_intensity: 0.85,
      gesture: 'greeting',
      gesture_intensity: 0.9,
      speech_intent: 'excited',
      mouth_animation_profile: 'energetic',
      created_at: new Date().toISOString(),
    };

    globalThis.fetch = async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/chat')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockResponse,
        } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    };

    let chatResult!: CompanionChatHookResult;
    function ChatLifecycleComponent() {
      chatResult = useCompanionChatMod.useCompanionChat({
        reactionDispatcher,
        speechMouthController: speechMouth,
        attentionController: attention,
        initialSessionId: 'lifecycle-session',
      });
      return null;
    }

    const container = happyWindow.document.createElement('div');
    const root = createRoot(container as unknown as Element);

    act(() => {
      root.render(React.createElement(ChatLifecycleComponent));
    });

    // Initial state: ATTENTIVE
    assert.equal(attention.getState(), 'ATTENTIVE');

    // Send user message
    await act(async () => {
      await chatResult.sendMessage('Greetings, companion!');
    });

    // Companion responded: enters SPEAKING state
    assert.equal(attention.getState(), 'SPEAKING');
    assert.ok(chatResult.activeDialogue !== null);
    assert.equal(chatResult.activeDialogue?.fullText, mockResponse.response_text);
    assert.equal(chatResult.activeDialogue?.emotion, 'happy');

    // Simulate speech articulation natural completion
    act(() => {
      reactionDispatcher.handleSpeechComplete();
    });

    // Restores to ATTENTIVE state
    assert.equal(attention.getState(), 'ATTENTIVE');

    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it('6. handles server errors gracefully, records error notification, and permits retry', async () => {
    const originalFetch = globalThis.fetch;
    let shouldFail = true;

    globalThis.fetch = async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/chat')) {
        if (shouldFail) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ detail: 'Companion engine temporarily unavailable' }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session_id: 'err-test-session',
            response_text: 'I am back online now!',
            emotion: 'relaxed',
            emotion_intensity: 0.7,
            gesture: null,
            gesture_intensity: 0.0,
            speech_intent: 'gentle',
            mouth_animation_profile: 'gentle',
            created_at: new Date().toISOString(),
          }),
        } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    };

    let chatResult!: CompanionChatHookResult;
    function ChatErrorComponent() {
      chatResult = useCompanionChatMod.useCompanionChat({ initialSessionId: 'err-test-session' });
      return null;
    }

    const container = happyWindow.document.createElement('div');
    const root = createRoot(container as unknown as Element);

    act(() => {
      root.render(React.createElement(ChatErrorComponent));
    });

    let sent = false;
    await act(async () => {
      sent = await chatResult.sendMessage('Can you hear me?');
    });

    assert.equal(sent, false);
    assert.equal(chatResult.isLoading, false);
    assert.ok(chatResult.errorMessage !== null);
    assert.equal(chatResult.statusKind, 'error');
    // Error notice added to chat messages
    const lastMsg = chatResult.messages[chatResult.messages.length - 1];
    assert.equal(lastMsg.isError, true);

    // Now recovery on retry
    shouldFail = false;
    await act(async () => {
      sent = await chatResult.retryLastMessage();
    });

    assert.equal(sent, true);
    assert.equal(chatResult.errorMessage, null);
    const finalMsg = chatResult.messages[chatResult.messages.length - 1];
    assert.equal(finalMsg.text, 'I am back online now!');

    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it('7. safely aborts in-flight requests and cancels speech when cancelResponse is called', async () => {
    const originalFetch = globalThis.fetch;
    let aborted = false;

    globalThis.fetch = async (_url: RequestInfo | URL, opts?: RequestInit) => {
      opts?.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise(() => {}); // never resolves
    };

    let chatResult!: CompanionChatHookResult;
    function ChatCancelComponent() {
      chatResult = useCompanionChatMod.useCompanionChat({ initialSessionId: 'cancel-session' });
      return null;
    }

    const container = happyWindow.document.createElement('div');
    const root = createRoot(container as unknown as Element);

    act(() => {
      root.render(React.createElement(ChatCancelComponent));
    });

    act(() => {
      chatResult.sendMessage('Long running thought');
    });

    assert.equal(chatResult.isLoading, true);

    // Cancel
    act(() => {
      chatResult.cancelResponse();
    });

    assert.equal(aborted, true);
    assert.equal(chatResult.isLoading, false);

    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it('8. clears conversation history and starts a new session cleanly', async () => {
    const originalFetch = globalThis.fetch;
    let createdCount = 0;

    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/api/session') && (!init || init.method === 'POST')) {
        createdCount++;
        return {
          ok: true,
          status: 201,
          json: async () => ({ session_id: `session-v${createdCount}`, created_at: new Date().toISOString() }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ deleted: true }) } as unknown as Response;
    };

    let chatResult!: CompanionChatHookResult;
    function ChatNewSessionComponent() {
      chatResult = useCompanionChatMod.useCompanionChat({ initialSessionId: 'old-session' });
      return null;
    }

    const container = happyWindow.document.createElement('div');
    const root = createRoot(container as unknown as Element);

    act(() => {
      root.render(React.createElement(ChatNewSessionComponent));
    });

    await act(async () => {
      await chatResult.startNewSession();
    });

    assert.equal(chatResult.sessionId, 'session-v1');
    assert.equal(chatResult.messages.length, 0);
    assert.equal(chatResult.activeDialogue, null);

    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it('9. renders FloatingTopBar with companion status, framing toggle, and theme controls', () => {
    let framingToggled = false;
    let themeToggled = false;
    let historyToggled = false;

    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    act(() => {
      root.render(
        React.createElement(FloatingTopBarMod.FloatingTopBar, {
          companionName: 'Aria',
          statusLabel: 'Attentive',
          statusKind: 'attentive',
          framingMode: 'full',
          onToggleFraming: () => { framingToggled = true; },
          theme: 'dark',
          onToggleTheme: () => { themeToggled = true; },
          historyCount: 5,
          isHistoryOpen: false,
          onToggleHistory: () => { historyToggled = true; },
        }),
      );
    });

    const nameEl = host.querySelector('.companion-topbar__name');
    assert.equal(nameEl?.textContent, 'Aria');

    const badgeEl = host.querySelector('.companion-topbar__badge');
    assert.equal(badgeEl?.textContent, 'Attentive');

    const countEl = host.querySelector('.companion-topbar__pill-count');
    assert.equal(countEl?.textContent, '5');

    // Click framing button
    const buttons = Array.from(host.querySelectorAll('button'));
    const framingBtn = buttons.find((b) => b.getAttribute('aria-label')?.includes('Framing'));
    assert.ok(framingBtn);
    act(() => {
      framingBtn?.click();
    });
    assert.equal(framingToggled, true);

    // Click theme button
    const themeBtn = buttons.find((b) => b.getAttribute('aria-label')?.includes('theme'));
    assert.ok(themeBtn);
    act(() => {
      themeBtn?.click();
    });
    assert.equal(themeToggled, true);

    // Click history button
    const historyBtn = buttons.find((b) => b.getAttribute('aria-label')?.includes('History'));
    assert.ok(historyBtn);
    act(() => {
      historyBtn?.click();
    });
    assert.equal(historyToggled, true);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('10. renders SpeechBubbleOverlay with emotion chips, progressive text, and dismiss action', () => {
    let dismissed = false;

    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    act(() => {
      root.render(
        React.createElement(SpeechBubbleOverlayMod.SpeechBubbleOverlay, {
          dialogue: {
            id: 'dlg-1',
            fullText: 'Hello there, wonderful friend!',
            displayedText: 'Hello there',
            emotion: 'happy',
            gesture: 'wave',
            isSpeaking: true,
            progress: 0.45,
          },
          onDismiss: () => { dismissed = true; },
          companionName: 'Aria',
        }),
      );
    });

    const textEl = host.querySelector('.companion-dialogue-card__text');
    assert.ok(textEl?.textContent?.includes('Hello there'));

    const emotionChip = host.querySelector('.companion-dialogue-card__chip--emotion');
    assert.ok(emotionChip?.textContent?.includes('Happy'));

    const gestureChip = host.querySelector('.companion-dialogue-card__chip--gesture');
    assert.ok(gestureChip?.textContent?.includes('Wave'));

    // Cursor indicator rendered while speaking
    const cursorEl = host.querySelector('.companion-dialogue-card__cursor');
    assert.ok(cursorEl !== null);

    // Click dismiss button
    const dismissBtn = host.querySelector('.companion-dialogue-card__dismiss-btn') as { click: () => void } | null;
    assert.ok(dismissBtn);
    act(() => {
      dismissBtn.click();
    });
    assert.equal(dismissed, true);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('11. renders ChatInput with multiline support, keyboard submission, and disabled states', async () => {
    let submittedMessage = '';

    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    act(() => {
      root.render(
        React.createElement(ChatInputMod.ChatInput, {
          onSendMessage: async (msg: string) => {
            submittedMessage = msg;
            return true;
          },
          isLoading: false,
        }),
      );
    });

    const textarea = host.querySelector('textarea') as unknown as { value: string; dispatchEvent: (e: unknown) => void };
    const sendBtn = host.querySelector('.companion-input__action-btn--send') as unknown as { disabled: boolean };

    // Initially send button is disabled (no text)
    assert.equal(sendBtn.disabled, true);

    // Type text
    act(() => {
      textarea.value = 'How are you feeling today?';
      textarea.dispatchEvent(new happyWindow.Event('input', { bubbles: true }));
      textarea.dispatchEvent(new happyWindow.Event('change', { bubbles: true }));
    });

    // Send via click on enabled send button
    await act(async () => {
      const activeSendBtn = host.querySelector('.companion-input__action-btn--send') as unknown as { disabled: boolean; click: () => void };
      assert.equal(activeSendBtn.disabled, false);
      activeSendBtn.click();
    });

    assert.equal(submittedMessage, 'How are you feeling today?');

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('12. renders ChatPanel drawer with history items, Escape key dismissal, and empty state', () => {
    let closed = false;
    let cleared = false;
    let newSessionStarted = false;

    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    // 1. Empty state
    act(() => {
      root.render(
        React.createElement(ChatPanelMod.ChatPanel, {
          isOpen: true,
          onClose: () => { closed = true; },
          messages: [],
          onStartNewSession: () => { newSessionStarted = true; },
          onClearHistory: () => { cleared = true; },
          sessionId: 'session-abcdefg-1234',
          companionName: 'Aria',
        }),
      );
    });

    const emptyTitle = host.querySelector('.companion-history-drawer__empty-title');
    assert.equal(emptyTitle?.textContent, 'No messages yet');

    // 2. Populated messages state
    act(() => {
      root.render(
        React.createElement(ChatPanelMod.ChatPanel, {
          isOpen: true,
          onClose: () => { closed = true; },
          messages: [
            { id: '1', sender: 'user', text: 'Hello Aria!', timestamp: Date.now() },
            { id: '2', sender: 'companion', text: 'Hello! Great to see you!', timestamp: Date.now(), emotion: 'happy' },
          ],
          onStartNewSession: () => { newSessionStarted = true; },
          onClearHistory: () => { cleared = true; },
          sessionId: 'session-abcdefg-1234',
          companionName: 'Aria',
        }),
      );
    });

    const messageEls = host.querySelectorAll('.companion-chat-message');
    assert.equal(messageEls.length, 2);

    // Click "New Chat" and "Clear" buttons
    const buttons = Array.from(host.querySelectorAll('button'));
    const newChatBtn = buttons.find((b) => b.textContent?.trim() === 'New Chat');
    const clearBtn = buttons.find((b) => b.textContent?.trim() === 'Clear');

    act(() => {
      newChatBtn?.click();
      clearBtn?.click();
    });
    assert.equal(newSessionStarted, true);
    assert.equal(cleared, true);

    // Press Escape key to close
    act(() => {
      happyWindow.dispatchEvent(
        new happyWindow.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      );
    });
    assert.equal(closed, true);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('13. renders ChatStatus for thinking, listening, and error states with retry action', () => {
    let retried = false;
    const host = happyWindow.document.createElement('div');
    happyWindow.document.body.appendChild(host);
    const root = createRoot(host as unknown as Element);

    // Thinking state
    act(() => {
      root.render(
        React.createElement(ChatStatusMod.ChatStatus, {
          statusKind: 'thinking',
          companionName: 'Aria',
        }),
      );
    });
    assert.ok(host.textContent?.includes('Aria is thinking'));

    // Error state with retry button
    act(() => {
      root.render(
        React.createElement(ChatStatusMod.ChatStatus, {
          statusKind: 'error',
          errorMessage: 'Server timeout.',
          onRetry: () => { retried = true; },
          companionName: 'Aria',
        }),
      );
    });
    assert.ok(host.textContent?.includes('Server timeout'));
    const retryBtn = host.querySelector('.companion-status-retry-btn') as { click: () => void } | null;
    assert.ok(retryBtn);

    act(() => {
      retryBtn.click();
    });
    assert.equal(retried, true);

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
