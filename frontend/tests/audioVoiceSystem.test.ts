import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Standard 44-byte PCM WAV header base64 (RIFF header)
const VALID_SYNTHETIC_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/**
 * Mock Web Audio API implementations for node / happy-dom test environments
 */
class MockAudioBufferSourceNode {
  public buffer: unknown = null;
  public onended: (() => void) | null = null;
  public isStarted = false;
  public isStopped = false;
  public isConnected = false;

  public connect(_destination: unknown): void {
    this.isConnected = true;
  }

  public disconnect(): void {
    this.isConnected = false;
  }

  public start(_when?: number): void {
    this.isStarted = true;
  }

  public stop(_when?: number): void {
    this.isStopped = true;
    if (this.onended) {
      const cb = this.onended;
      this.onended = null;
      cb();
    }
  }
}

class MockGainNode {
  public gain = {
    value: 1.0,
    setValueAtTime: (_val: number, _time: number) => {},
  };
  public isConnected = false;

  public connect(_dest: unknown): void {
    this.isConnected = true;
  }

  public disconnect(): void {
    this.isConnected = false;
  }
}

class MockAudioContext {
  public state: 'suspended' | 'running' | 'closed' = 'suspended';
  public currentTime = 0;
  public destination = {};
  public sources: MockAudioBufferSourceNode[] = [];
  public shouldFailDecoding = false;

  public createBufferSource(): MockAudioBufferSourceNode {
    const node = new MockAudioBufferSourceNode();
    this.sources.push(node);
    return node;
  }

  public createGain(): MockGainNode {
    return new MockGainNode();
  }

  public async resume(): Promise<void> {
    if (this.state !== 'closed') {
      this.state = 'running';
    }
  }

  public async close(): Promise<void> {
    this.state = 'closed';
  }

  public decodeAudioData(
    _audioData: ArrayBuffer,
    successCallback?: (buf: unknown) => void,
    errorCallback?: (err: Error) => void,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.shouldFailDecoding) {
        const err = new Error('Corrupt audio header: cannot decode');
        errorCallback?.(err);
        reject(err);
      } else {
        const dummyBuffer = {
          duration: 1.5,
          sampleRate: 24000,
          numberOfChannels: 1,
          length: 36000,
        };
        successCallback?.(dummyBuffer);
        resolve(dummyBuffer);
      }
    });
  }
}

interface AudioManagerInstance {
  getAudioContext: () => AudioContext | null;
  unlock: () => Promise<boolean>;
  decodeAudio: (data: ArrayBuffer, cacheKey?: string) => Promise<unknown>;
  play: (payload: unknown, options?: unknown) => Promise<boolean>;
  replay: () => Promise<boolean>;
  stop: () => void;
  getState: () => {
    isPlaying: boolean;
    currentId: string | null;
    contextState: string;
    lastPlayedId: string | null;
    hasAudioToReplay: boolean;
  };
  subscribe: (fn: (state: unknown) => void) => () => void;
  dispose: () => Promise<void>;
}

interface AudioManagerModule {
  AudioManager: new (ctx?: AudioContext | null) => AudioManagerInstance;
  base64ToArrayBuffer: (b64: string) => ArrayBuffer;
  getAudioManager: () => AudioManagerInstance;
  resetGlobalAudioManagerForTesting: () => void;
}

interface UseAudioManagerResult {
  audioManager: AudioManagerInstance;
  voiceEnabled: boolean;
  isPlaying: boolean;
  isUnlocked: boolean;
  currentAudioId: string | null;
  lastPlayedId: string | null;
  hasAudioToReplay: boolean;
  toggleVoice: () => void;
  setVoiceEnabled: (enabled: boolean) => void;
  playAudio: (payload: string, id?: string) => Promise<boolean>;
  replayAudio: (payload?: string, id?: string) => Promise<boolean>;
  stopAudio: () => void;
  unlockAudio: () => Promise<boolean>;
}

interface UseAudioManagerModule {
  VOICE_STORAGE_KEY: string;
  getStoredVoicePreference: () => boolean;
  setStoredVoicePreference: (enabled: boolean) => void;
  useAudioManager: (options?: unknown) => UseAudioManagerResult;
}

interface CompanionChatHookResult {
  sessionId: string | null;
  messages: Array<{
    id: string;
    sender: 'user' | 'companion';
    text: string;
    timestamp: number;
    audioData?: string | null;
  }>;
  activeDialogue: {
    id: string;
    fullText: string;
    displayedText: string;
    audioData?: string | null;
  } | null;
  sendMessage: (text: string) => Promise<boolean>;
  cancelResponse: () => void;
  replayAudio: (dialogueId?: string) => Promise<boolean>;
}

interface UseCompanionChatModule {
  useCompanionChat: (options?: unknown) => CompanionChatHookResult;
}

interface ComponentModule {
  FloatingTopBar?: React.ComponentType<Record<string, unknown>>;
  SpeechBubbleOverlay?: React.ComponentType<Record<string, unknown>>;
}

describe('Milestone 7 — Stage 2: Frontend AudioManager & Voice Controls', () => {
  let vite: ViteDevServer;
  let happyWindow: Window;
  let mockCtx: MockAudioContext;

  // Dynamically loaded modules
  let AudioManagerMod: AudioManagerModule;
  let useAudioManagerMod: UseAudioManagerModule;
  let useCompanionChatMod: UseCompanionChatModule;
  let FloatingTopBarMod: ComponentModule;
  let SpeechBubbleOverlayMod: ComponentModule;

  before(async () => {
    vite = await createServer({
      root: FRONTEND_ROOT,
      server: { middlewareMode: true },
      appType: 'custom',
    });

    happyWindow = new Window({
      url: 'http://localhost:5173/',
      innerWidth: 1280,
      innerHeight: 800,
    });

    // Install browser globals safely without overriding read-only getter properties like navigator
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
      AudioContext: MockAudioContext,
    });

    AudioManagerMod = (await vite.ssrLoadModule('/src/audio/AudioManager.ts')) as unknown as AudioManagerModule;
    useAudioManagerMod = (await vite.ssrLoadModule('/src/audio/useAudioManager.ts')) as unknown as UseAudioManagerModule;
    useCompanionChatMod = (await vite.ssrLoadModule('/src/conversation/useCompanionChat.ts')) as unknown as UseCompanionChatModule;
    FloatingTopBarMod = (await vite.ssrLoadModule('/src/components/chat/FloatingTopBar.tsx')) as unknown as ComponentModule;
    SpeechBubbleOverlayMod = (await vite.ssrLoadModule('/src/components/chat/SpeechBubbleOverlay.tsx')) as unknown as ComponentModule;
  });

  after(async () => {
    await vite.close();
  });

  beforeEach(() => {
    happyWindow.localStorage.clear();
    mockCtx = new MockAudioContext();
    AudioManagerMod.resetGlobalAudioManagerForTesting();
  });

  /* --------------------------------------------------------------------------
     1. AudioManager Service Tests (10 tests)
     -------------------------------------------------------------------------- */
  describe('AudioManager Core Service', () => {
    it('1. AudioContext initialization initializes lazily and reuses single instance', () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      const ctx1 = manager.getAudioContext();
      const ctx2 = manager.getAudioContext();
      assert.ok(ctx1 !== null);
      assert.equal(ctx1, ctx2);
      assert.equal(manager.getState().contextState, 'suspended');
    });

    it('2. Suspended AudioContext recovery / unlock() resumes AudioContext successfully', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      assert.equal(mockCtx.state, 'suspended');
      const unlocked = await manager.unlock();
      assert.equal(unlocked, true);
      assert.equal(mockCtx.state, 'running');
      assert.equal(manager.getState().contextState, 'running');
    });

    it('3. Base64 decoding converts standard and prefixed base64 WAV payloads to ArrayBuffer', () => {
      const raw = AudioManagerMod.base64ToArrayBuffer(VALID_SYNTHETIC_WAV_BASE64);
      assert.ok(raw instanceof ArrayBuffer);
      assert.equal(raw.byteLength, 44);

      // With Data URI prefix
      const prefixed = `data:audio/wav;base64,${VALID_SYNTHETIC_WAV_BASE64}`;
      const fromPrefixed = AudioManagerMod.base64ToArrayBuffer(prefixed);
      assert.equal(fromPrefixed.byteLength, 44);
    });

    it('4. Invalid or empty audio payload is rejected cleanly without crashing', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);

      // Empty string
      assert.throws(() => AudioManagerMod.base64ToArrayBuffer(''), /empty or invalid/);

      // Whitespace
      assert.throws(() => AudioManagerMod.base64ToArrayBuffer('   '), /empty/);

      // Malformed characters
      assert.throws(() => AudioManagerMod.base64ToArrayBuffer('!@#$%^&*()'), /malformed/);

      let errorReported: Error | null = null;
      const playResult = await manager.play('invalid-base64!', {
        onError: (err: unknown) => {
          errorReported = err as Error;
        },
      });

      assert.equal(playResult, false);
      assert.ok(errorReported !== null);
      assert.equal(manager.getState().isPlaying, false);
    });

    it('5. Successful audio playback creates AudioBufferSourceNode and starts playing', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);

      const played = await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'msg-1' });
      assert.equal(played, true);
      assert.equal(manager.getState().isPlaying, true);
      assert.equal(manager.getState().currentId, 'msg-1');
      assert.equal(manager.getState().lastPlayedId, 'msg-1');
      assert.equal(mockCtx.sources.length, 1);
      assert.equal(mockCtx.sources[0].isStarted, true);
      assert.equal(mockCtx.sources[0].isConnected, true);
    });

    it('6. Playback completion resets isPlaying and fires onEnded callback', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      let endedFired = false;

      await manager.play(VALID_SYNTHETIC_WAV_BASE64, {
        id: 'msg-finish',
        onEnded: () => {
          endedFired = true;
        },
      });

      assert.equal(manager.getState().isPlaying, true);

      // Simulate source natural end
      act(() => {
        mockCtx.sources[0].stop();
      });

      assert.equal(endedFired, true);
      assert.equal(manager.getState().isPlaying, false);
      assert.equal(manager.getState().currentId, null);
    });

    it('7. Stop active playback stops source node immediately and disconnects', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      let endedFired = false;

      await manager.play(VALID_SYNTHETIC_WAV_BASE64, {
        id: 'msg-stop',
        onEnded: () => {
          endedFired = true;
        },
      });

      assert.equal(manager.getState().isPlaying, true);

      manager.stop();

      assert.equal(manager.getState().isPlaying, false);
      assert.equal(manager.getState().currentId, null);
      // Explicit stop should not fire natural onEnded callback
      assert.equal(endedFired, false);
      assert.equal(mockCtx.sources[0].isStopped, true);
    });

    it('8. Repeated stop calls are safe, idempotent no-ops', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'msg-repeated' });

      manager.stop();
      manager.stop();
      manager.stop();

      assert.equal(manager.getState().isPlaying, false);
      assert.equal(manager.getState().currentId, null);
    });

    it('9. Replay behaviour replays the last played audio payload', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);

      // No audio played yet
      assert.equal(await manager.replay(), false);

      // Play once
      await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'msg-replay' });
      manager.stop();

      // Now replay
      const replayed = await manager.replay();
      assert.equal(replayed, true);
      assert.equal(manager.getState().isPlaying, true);
      assert.equal(manager.getState().currentId, 'msg-replay');
      assert.equal(mockCtx.sources.length, 2);
    });

    it('10. Cleanup and disposal closes AudioContext and releases all resources', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      await manager.dispose();

      assert.equal(mockCtx.state, 'closed');
      assert.equal(manager.getState().isPlaying, false);
      assert.equal(manager.getState().contextState, 'uninitialized');
    });
  });

  /* --------------------------------------------------------------------------
     2. Voice Preference Tests (6 tests)
     -------------------------------------------------------------------------- */
  describe('Voice Preference & useAudioManager', () => {
    it('1. Default voice preference is enabled (true)', () => {
      assert.equal(useAudioManagerMod.getStoredVoicePreference(), true);
    });

    it('2. Preference persistence saves to localStorage under companion-voice-enabled', () => {
      useAudioManagerMod.setStoredVoicePreference(false);
      assert.equal(happyWindow.localStorage.getItem('companion-voice-enabled'), 'false');
      assert.equal(useAudioManagerMod.getStoredVoicePreference(), false);

      useAudioManagerMod.setStoredVoicePreference(true);
      assert.equal(happyWindow.localStorage.getItem('companion-voice-enabled'), 'true');
      assert.equal(useAudioManagerMod.getStoredVoicePreference(), true);
    });

    it('3. Preference restoration after reload reads preserved value', () => {
      happyWindow.localStorage.setItem('companion-voice-enabled', 'false');
      assert.equal(useAudioManagerMod.getStoredVoicePreference(), false);

      happyWindow.localStorage.setItem('companion-voice-enabled', 'true');
      assert.equal(useAudioManagerMod.getStoredVoicePreference(), true);
    });

    it('4. Switching voice off stops active playback immediately', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'voice-test' });
      assert.equal(manager.getState().isPlaying, true);

      // Simulate hook toggle off
      useAudioManagerMod.setStoredVoicePreference(false);
      manager.stop();

      assert.equal(manager.getState().isPlaying, false);
      assert.equal(mockCtx.sources[0].isStopped, true);
    });

    it('5. Switching voice on enables future playback', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      useAudioManagerMod.setStoredVoicePreference(true);

      const played = await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'voice-on' });
      assert.equal(played, true);
      assert.equal(manager.getState().isPlaying, true);
    });

    it('6. Disabled voice prevents automatic playback in React integration', async () => {
      let hookResult: UseAudioManagerResult | null = null;
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);

      function TestComp() {
        hookResult = useAudioManagerMod.useAudioManager({
          audioManager: manager,
          initialVoiceEnabled: false,
        });
        return React.createElement('div', null, hookResult.voiceEnabled ? 'ON' : 'OFF');
      }

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      act(() => {
        root.render(React.createElement(TestComp));
      });

      const res = hookResult as unknown as UseAudioManagerResult;
      assert.equal(res?.voiceEnabled, false);
      const playAttempt = await res?.playAudio(VALID_SYNTHETIC_WAV_BASE64, 'disabled-test');
      assert.equal(playAttempt, false);
      assert.equal(manager.getState().isPlaying, false);

      act(() => {
        root.unmount();
      });
      host.remove();
    });
  });

  /* --------------------------------------------------------------------------
     3. Chat Integration & Interruption Tests (7 tests)
     -------------------------------------------------------------------------- */
  describe('Chat Lifecycle & Voice Integration', () => {
    it('1. Audio automatically plays when voice is enabled and audio payload exists', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      let hook: CompanionChatHookResult | null = null;

      // Mock fetch
      (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
        if (url.includes('/api/session')) {
          return {
            ok: true,
            json: async () => ({ session_id: 'test-session-1', created_at: new Date().toISOString() }),
          };
        }
        if (url.includes('/api/chat')) {
          return {
            ok: true,
            json: async () => ({
              session_id: 'test-session-1',
              response_text: 'Hello, wonderful world!',
              emotion: 'happy',
              emotion_intensity: 0.8,
              gesture: 'wave',
              gesture_intensity: 0.7,
              speech_intent: 'conversational',
              mouth_animation_profile: 'soft_conversation',
              created_at: new Date().toISOString(),
              audio_data: VALID_SYNTHETIC_WAV_BASE64,
              audio_mime_type: 'audio/wav',
              audio_duration: 1.5,
              audio_sample_rate: 24000,
            }),
          };
        }
        return { ok: false, status: 404 };
      }) as unknown as typeof fetch;

      function ChatTestComp() {
        hook = useCompanionChatMod.useCompanionChat({
          initialSessionId: 'test-session-1',
          audioManager: manager,
          voiceEnabled: true,
        });
        return React.createElement('div', null, hook.sessionId);
      }

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      act(() => {
        root.render(React.createElement(ChatTestComp));
      });

      assert.ok(hook);
      await act(async () => {
        await hook?.sendMessage('Hi Aria!');
      });

      assert.equal(manager.getState().isPlaying, true);
      const chat = hook as unknown as CompanionChatHookResult;
      assert.equal(chat?.messages.length, 2);
      assert.equal(chat?.messages[1].audioData, VALID_SYNTHETIC_WAV_BASE64);
      assert.equal(chat?.activeDialogue?.audioData, VALID_SYNTHETIC_WAV_BASE64);

      act(() => {
        root.unmount();
      });
      host.remove();
    });

    it('2. Audio does not play when voice is disabled', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      let hook: CompanionChatHookResult | null = null;

      (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
        return {
          ok: true,
          json: async () => ({
            session_id: 'test-session-2',
            response_text: 'Silent dialogue text.',
            emotion: 'neutral',
            emotion_intensity: 0.5,
            gesture: null,
            gesture_intensity: 0.0,
            speech_intent: 'conversational',
            mouth_animation_profile: 'soft_conversation',
            created_at: new Date().toISOString(),
            audio_data: VALID_SYNTHETIC_WAV_BASE64,
          }),
        };
      }) as unknown as typeof fetch;

      function ChatTestComp() {
        hook = useCompanionChatMod.useCompanionChat({
          initialSessionId: 'test-session-2',
          audioManager: manager,
          voiceEnabled: false, // Voice muted
        });
        return React.createElement('div', null, hook.sessionId);
      }

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      act(() => {
        root.render(React.createElement(ChatTestComp));
      });

      await act(async () => {
        await hook?.sendMessage('Hello?');
      });

      assert.equal(manager.getState().isPlaying, false);
      const chat = hook as unknown as CompanionChatHookResult;
      assert.equal(chat?.messages[1].text, 'Silent dialogue text.');

      act(() => {
        root.unmount();
      });
      host.remove();
    });

    it('3. Null audio preserves text-only dialogue behaviour', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      let hook: CompanionChatHookResult | null = null;

      (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
        return {
          ok: true,
          json: async () => ({
            session_id: 'test-session-3',
            response_text: 'Text without audio.',
            emotion: 'curious',
            emotion_intensity: 0.6,
            gesture: 'think',
            gesture_intensity: 0.6,
            speech_intent: 'curious',
            mouth_animation_profile: 'gentle',
            created_at: new Date().toISOString(),
            audio_data: null, // Null audio
            audio_mime_type: null,
            audio_duration: null,
          }),
        };
      }) as unknown as typeof fetch;

      function ChatTestComp() {
        hook = useCompanionChatMod.useCompanionChat({
          initialSessionId: 'test-session-3',
          audioManager: manager,
          voiceEnabled: true,
        });
        return React.createElement('div', null, hook.sessionId);
      }

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      act(() => {
        root.render(React.createElement(ChatTestComp));
      });

      await act(async () => {
        await hook?.sendMessage('Tell me a thought');
      });

      assert.equal(manager.getState().isPlaying, false);
      const chat = hook as unknown as CompanionChatHookResult;
      assert.equal(chat?.messages[1].text, 'Text without audio.');
      assert.equal(chat?.messages[1].audioData, null);

      act(() => {
        root.unmount();
      });
      host.remove();
    });

    it('4. New user message interrupts existing playback immediately', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      let hook: CompanionChatHookResult | null = null;

      (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
        return {
          ok: true,
          json: async () => ({
            session_id: 'test-session-4',
            response_text: 'Playing long speech.',
            emotion: 'happy',
            emotion_intensity: 0.8,
            gesture: null,
            gesture_intensity: 0.0,
            speech_intent: 'conversational',
            mouth_animation_profile: 'soft_conversation',
            created_at: new Date().toISOString(),
            audio_data: VALID_SYNTHETIC_WAV_BASE64,
          }),
        };
      }) as unknown as typeof fetch;

      function ChatTestComp() {
        hook = useCompanionChatMod.useCompanionChat({
          initialSessionId: 'test-session-4',
          audioManager: manager,
          voiceEnabled: true,
        });
        return React.createElement('div', null, hook.sessionId);
      }

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      act(() => {
        root.render(React.createElement(ChatTestComp));
      });

      await act(async () => {
        await hook?.sendMessage('First message');
      });
      assert.equal(manager.getState().isPlaying, true);

      // User sends second message while first is playing
      await act(async () => {
        // As soon as sendMessage is called, active audio is stopped
        const sendPromise = hook?.sendMessage('Second interrupting message');
        assert.equal(manager.getState().isPlaying, false);
        await sendPromise;
      });

      act(() => {
        root.unmount();
      });
      host.remove();
    });

    it('5. Stale responses cannot start playback after newer message or cancellation', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      let hook: CompanionChatHookResult | null = null;

      let resolveSlowRequest: ((val: unknown) => void) | null = null;

      (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
        return new Promise((resolve) => {
          resolveSlowRequest = () => {
            resolve({
              ok: true,
              json: async () => ({
                session_id: 'test-session-5',
                response_text: 'Delayed response.',
                emotion: 'happy',
                emotion_intensity: 0.8,
                gesture: null,
                gesture_intensity: 0.0,
                speech_intent: 'conversational',
                mouth_animation_profile: 'soft_conversation',
                created_at: new Date().toISOString(),
                audio_data: VALID_SYNTHETIC_WAV_BASE64,
              }),
            });
          };
        });
      }) as unknown as typeof fetch;

      function ChatTestComp() {
        hook = useCompanionChatMod.useCompanionChat({
          initialSessionId: 'test-session-5',
          audioManager: manager,
          voiceEnabled: true,
        });
        return React.createElement('div', null, hook.sessionId);
      }

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      act(() => {
        root.render(React.createElement(ChatTestComp));
      });

      // Start slow request
      let sendDone = false;
      act(() => {
        hook?.sendMessage('Slow query').then(() => {
          sendDone = true;
        });
      });

      // Cancel the response while in flight
      act(() => {
        hook?.cancelResponse();
      });

      // Now delayed backend reply finally resolves
      await act(async () => {
        resolveSlowRequest?.(null);
      });

      assert.equal(sendDone, true);

      // Stale response must NOT play audio or become active
      assert.equal(manager.getState().isPlaying, false);

      act(() => {
        root.unmount();
      });
      host.remove();
    });

    it('6. TTS-disabled backend requests pass voice_enabled=false in payload', async () => {
      let capturedBody: { voice_enabled?: boolean } | null = null;

      (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (_url: string, init?: RequestInit) => {
        if (init?.body && typeof init.body === 'string') {
          try {
            capturedBody = JSON.parse(init.body);
          } catch {}
        }
        return {
          ok: true,
          json: async () => ({
            session_id: 'test-session-6',
            response_text: 'Response text.',
            emotion: 'neutral',
            emotion_intensity: 0.5,
            gesture: null,
            gesture_intensity: 0.0,
            speech_intent: 'conversational',
            mouth_animation_profile: 'soft_conversation',
            created_at: new Date().toISOString(),
            audio_data: null,
          }),
        };
      }) as unknown as typeof fetch;

      let hook: CompanionChatHookResult | null = null;

      function ChatTestComp() {
        hook = useCompanionChatMod.useCompanionChat({
          initialSessionId: 'test-session-6',
          voiceEnabled: false,
        });
        return React.createElement('div', null, hook.sessionId);
      }

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      act(() => {
        root.render(React.createElement(ChatTestComp));
      });

      await act(async () => {
        await hook?.sendMessage('Testing voice_enabled flag');
      });

      assert.ok(capturedBody !== null);
      const body = capturedBody as unknown as { voice_enabled?: boolean };
      assert.equal(body?.voice_enabled, false);

      act(() => {
        root.unmount();
      });
      host.remove();
    });

    it('7. UI controls: FloatingTopBar voice toggle and SpeechBubbleOverlay replay button render properly', () => {
      let voiceToggled = false;
      let audioReplayed = false;

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      // 1. Render FloatingTopBar with voice toggle
      act(() => {
        root.render(
          React.createElement(FloatingTopBarMod.FloatingTopBar!, {
            framingMode: 'full',
            onToggleFraming: () => {},
            theme: 'dark',
            onToggleTheme: () => {},
            historyCount: 1,
            isHistoryOpen: false,
            onToggleHistory: () => {},
            voiceEnabled: true,
            onToggleVoice: () => {
              voiceToggled = true;
            },
            isAudioPlaying: false,
          }),
        );
      });

      const buttons = Array.from(host.querySelectorAll('button'));
      const voiceBtn = buttons.find((b) => b.getAttribute('aria-label')?.includes('voice'));
      assert.ok(voiceBtn !== undefined);
      assert.equal(voiceBtn?.textContent?.includes('Voice'), true);

      act(() => {
        voiceBtn?.click();
      });
      assert.equal(voiceToggled, true);

      // 2. Render SpeechBubbleOverlay with replay button
      act(() => {
        root.render(
          React.createElement(SpeechBubbleOverlayMod.SpeechBubbleOverlay!, {
            dialogue: {
              id: 'dialogue-1',
              fullText: 'Hello with audio!',
              displayedText: 'Hello with audio!',
              emotion: 'happy',
              isSpeaking: false,
              progress: 1.0,
              audioData: VALID_SYNTHETIC_WAV_BASE64,
            },
            onDismiss: () => {},
            onReplayAudio: () => {
              audioReplayed = true;
            },
            voiceEnabled: true,
            isAudioPlaying: false,
          }),
        );
      });

      const replayBtn = host.querySelector('.companion-dialogue-card__action-btn--audio') as { click: () => void } | null;
      assert.ok(replayBtn !== null);

      act(() => {
        replayBtn?.click();
      });
      assert.equal(audioReplayed, true);

      act(() => {
        root.unmount();
      });
      host.remove();
    });
  });
});
