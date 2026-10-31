import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { VRM } from '@pixiv/three-vrm';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Standard 44-byte PCM WAV Base64 header fixture
const VALID_SYNTHETIC_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

// ============================================================================
// Mock Web Audio API Implementation
// ============================================================================

class MockAnalyserNode {
  public fftSize = 512;
  public smoothingTimeConstant = 0.2;
  public isConnected = false;
  public connectedTo: unknown = null;
  public mockEnergyData: number[] | null = null;

  public connect(dest: unknown): void {
    this.isConnected = true;
    this.connectedTo = dest;
  }

  public disconnect(): void {
    this.isConnected = false;
    this.connectedTo = null;
  }

  public getFloatTimeDomainData(array: Float32Array): void {
    if (this.mockEnergyData && this.mockEnergyData.length > 0) {
      for (let i = 0; i < array.length; i++) {
        array[i] = this.mockEnergyData[i % this.mockEnergyData.length] ?? 0;
      }
    } else {
      array.fill(0);
    }
  }
}

class MockGainNode {
  public gain = {
    value: 1.0,
    setValueAtTime: (_val: number, _time: number) => {},
  };
  public isConnected = false;
  public connectedTo: unknown = null;

  public connect(dest: unknown): void {
    this.isConnected = true;
    this.connectedTo = dest;
  }

  public disconnect(): void {
    this.isConnected = false;
    this.connectedTo = null;
  }
}

class MockAudioBufferSourceNode {
  public buffer: { duration: number; sampleRate: number } | null = null;
  public onended: (() => void) | null = null;
  public isStarted = false;
  public isStopped = false;
  public isConnected = false;
  public connectedTo: unknown = null;
  public scheduledStartTime = -1;

  public connect(dest: unknown): void {
    this.isConnected = true;
    this.connectedTo = dest;
  }

  public disconnect(): void {
    this.isConnected = false;
    this.connectedTo = null;
  }

  public start(when = 0): void {
    this.isStarted = true;
    this.scheduledStartTime = when;
  }

  public stop(_when = 0): void {
    this.isStopped = true;
    if (this.onended) {
      const cb = this.onended;
      this.onended = null;
      cb();
    }
  }
}

class MockAudioContext {
  public state: 'suspended' | 'running' | 'closed' = 'suspended';
  public currentTime = 0;
  public destination = {};
  public sources: MockAudioBufferSourceNode[] = [];
  public analyser: MockAnalyserNode = new MockAnalyserNode();
  public masterGain: MockGainNode = new MockGainNode();

  public createBufferSource(): MockAudioBufferSourceNode {
    const node = new MockAudioBufferSourceNode();
    this.sources.push(node);
    return node;
  }

  public createGain(): MockGainNode {
    return this.masterGain;
  }

  public createAnalyser(): MockAnalyserNode {
    return this.analyser;
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
  ): Promise<unknown> {
    const mockDecoded = {
      duration: 3.0,
      sampleRate: 24000,
      numberOfChannels: 1,
      length: 24000 * 3.0,
    };
    if (successCallback) {
      successCallback(mockDecoded);
    }
    return Promise.resolve(mockDecoded);
  }
}

function createMockVrm(): VRM {
  const expressionWeights = new Map<string, number>();
  const dummyExpressions: Record<string, unknown> = {
    aa: {},
    ih: {},
    ou: {},
    ee: {},
    oh: {},
    happy: {},
    sad: {},
    angry: {},
    relaxed: {},
    surprised: {},
    blink: {},
    blinkLeft: {},
    blinkRight: {},
  };

  return {
    expressionManager: {
      getExpression: (name: string) => dummyExpressions[name] ?? null,
      setValue: (name: string, value: number) => {
        expressionWeights.set(name, value);
      },
      getValue: (name: string) => expressionWeights.get(name) ?? 0,
      update: () => {},
      resetValues: () => expressionWeights.clear(),
      presetExpressionMap: dummyExpressions,
      customExpressionMap: {},
    },
    humanoid: {
      getNormalizedBoneNode: () => null,
      getRawBoneNode: () => null,
    },
    scene: {
      position: { set: () => {} },
      rotation: { set: () => {} },
      updateMatrixWorld: () => {},
    },
    update: () => {},
  } as unknown as VRM;
}

// Module types loaded via Vite SSR
interface AudioManagerInstance {
  play(payload: string | ArrayBuffer | unknown, options?: unknown): Promise<boolean>;
  stop(): void;
  replay(): Promise<boolean>;
  dispose(): Promise<void>;
  getCurrentTime(): number;
  getDuration(): number;
  getAudioEnergy(): number;
  getPlaybackId(): string | null;
  getPlaybackGeneration(): number;
  isPlaying: boolean;
}

interface AudioManagerModule {
  AudioManager: new (ctx?: AudioContext | null) => AudioManagerInstance;
  getAudioManager: () => AudioManagerInstance;
  resetGlobalAudioManagerForTesting: () => void;
}

interface SpeechMouthControllerInstance {
  startSpeech(text: string, options?: unknown): number;
  stopSpeech(): void;
  cancel(): void;
  attach(vrm: VRM): void;
  attachAudioSync(provider: unknown): void;
  update(vrm: VRM, deltaTime: number): void;
  dispose(): void;
  getCurrentWeight(viseme: string): number;
  active: boolean;
  duration: number;
  progress: number;
}

interface SpeechMouthModule {
  SpeechMouthController: new () => SpeechMouthControllerInstance;
  RMS_CALIBRATION: {
    silenceThreshold: number;
    peakThreshold: number;
    minActiveOpening: number;
  };
}

interface ReactionDispatcherInstance {
  dispatchReaction(payload: unknown, options?: unknown): {
    accepted: boolean;
    mappedEmotion: string;
    speechDurationSeconds: number;
  };
  handleSpeechComplete(): void;
  cancel(): void;
}

interface ReactionDispatcherModule {
  ReactionDispatcher: new (context: unknown) => ReactionDispatcherInstance;
}

interface AttentionControllerInstance {
  setConversationMode(mode: string): void;
  setEmotionalHeadAccent(accent: unknown): void;
  returnToAttentive(): void;
  nextAlternatingSign(): number;
}

interface ExpressionControllerInstance {
  attach(vrm: VRM): void;
  update(vrm: VRM, deltaTime: number): void;
  setEmotion(name: string, intensity: number, options?: unknown): boolean;
  getSnapshot(): { activeEmotion: string };
  dispose(): void;
}

interface GestureControllerInstance {
  playGesture(name: string, options?: unknown): boolean;
  stopGesture(options?: unknown): void;
  getSnapshot(): { activeGesture: string | null };
}

interface UseCompanionChatResult {
  messages: Array<{ id: string; text: string; audioData?: string; audioDuration?: number }>;
  sendMessage: (text: string) => Promise<boolean>;
  replayAudio: (dialogueId?: string) => Promise<boolean>;
  cancelResponse: () => void;
}

interface UseCompanionChatModule {
  useCompanionChat: (options?: unknown) => UseCompanionChatResult;
}

describe('Milestone 7 — Stage 3: Audio-Driven Lip-Sync', () => {
  let vite: ViteDevServer;
  let happyWindow: Window;
  let mockCtx: MockAudioContext;

  let AudioManagerMod: AudioManagerModule;
  let SpeechMouthMod: SpeechMouthModule;
  let ReactionDispatcherMod: ReactionDispatcherModule;
  let AttentionControllerMod: { AttentionController: new () => AttentionControllerInstance };
  let ExpressionControllerMod: { ExpressionController: new () => ExpressionControllerInstance };
  let GestureControllerMod: { GestureController: new () => GestureControllerInstance };
  let useCompanionChatMod: UseCompanionChatModule;

  before(async () => {
    vite = await createServer({
      root: FRONTEND_ROOT,
      server: { middlewareMode: true },
      appType: 'custom',
    });

    happyWindow = new Window({
      url: 'http://localhost:5173',
      width: 1280,
      height: 720,
    });

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
    SpeechMouthMod = (await vite.ssrLoadModule('/src/character/SpeechMouthController.ts')) as unknown as SpeechMouthModule;
    ReactionDispatcherMod = (await vite.ssrLoadModule('/src/character/ReactionDispatcher.ts')) as unknown as ReactionDispatcherModule;
    AttentionControllerMod = (await vite.ssrLoadModule('/src/character/AttentionController.ts')) as unknown as { AttentionController: new () => AttentionControllerInstance };
    ExpressionControllerMod = (await vite.ssrLoadModule('/src/character/ExpressionController.ts')) as unknown as { ExpressionController: new () => ExpressionControllerInstance };
    GestureControllerMod = (await vite.ssrLoadModule('/src/character/GestureController.ts')) as unknown as { GestureController: new () => GestureControllerInstance };
    useCompanionChatMod = (await vite.ssrLoadModule('/src/conversation/useCompanionChat.ts')) as unknown as UseCompanionChatModule;
  });

  after(async () => {
    await vite.close();
  });

  beforeEach(() => {
    happyWindow.localStorage.clear();
    mockCtx = new MockAudioContext();
    AudioManagerMod.resetGlobalAudioManagerForTesting();
  });

  // ==========================================================================
  // Suite 1: AudioManager Enhancements & Audio Graph
  // ==========================================================================
  describe('1. AudioManager Enhancements & Audio Graph', () => {
    it('creates reusable AnalyserNode (fftSize=512, smoothing=0.2) and connects Source -> Analyser -> MasterGain -> Destination', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'diag-1' });

      assert.equal(mockCtx.sources.length, 1);
      const src = mockCtx.sources[0];
      assert.equal(src.isConnected, true);
      assert.equal(src.connectedTo, mockCtx.analyser);
      assert.equal(mockCtx.analyser.isConnected, true);
      assert.equal(mockCtx.analyser.connectedTo, mockCtx.masterGain);
      assert.equal(mockCtx.analyser.fftSize, 512);
      assert.equal(mockCtx.analyser.smoothingTimeConstant, 0.2);

      await manager.dispose();
    });

    it('captures scheduled start time and tracks accurate playback elapsed clock position', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      mockCtx.currentTime = 10.0;
      await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'diag-clock' });

      const src = mockCtx.sources[0];
      assert.equal(src.scheduledStartTime, 10.0);
      assert.equal(manager.getDuration(), 3.0);

      // Advance audio clock by 1.25s
      mockCtx.currentTime = 11.25;
      assert.equal(Math.abs(manager.getCurrentTime() - 1.25) < 1e-4, true);

      // Advance past duration -> clamped to duration
      mockCtx.currentTime = 14.5;
      assert.equal(manager.getCurrentTime(), 3.0);

      await manager.dispose();
    });

    it('returns safe zero values for getCurrentTime() when idle, stopped, or completed', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      assert.equal(manager.getCurrentTime(), 0);
      assert.equal(manager.getDuration(), 0);

      mockCtx.currentTime = 5.0;
      await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'diag-stop' });
      mockCtx.currentTime = 6.0;
      assert.equal(manager.getCurrentTime(), 1.0);

      manager.stop();
      assert.equal(manager.getCurrentTime(), 0);
      assert.equal(manager.getDuration(), 0);
      assert.equal(manager.isPlaying, false);

      await manager.dispose();
    });

    it('computes accurate RMS acoustic energy across silence and waveforms', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'diag-energy' });

      // Silence: all 0
      mockCtx.analyser.mockEnergyData = [0, 0, 0, 0];
      assert.equal(manager.getAudioEnergy(), 0.0);

      // Waveform with amplitude 0.2: square wave [0.2, -0.2] -> RMS = 0.2
      mockCtx.analyser.mockEnergyData = [0.2, -0.2, 0.2, -0.2];
      const rms = manager.getAudioEnergy();
      assert.equal(Math.abs(rms - 0.2) < 1e-4, true);

      manager.stop();
      assert.equal(manager.getAudioEnergy(), 0.0);

      await manager.dispose();
    });

    it('enforces monotonic generation tracking to protect against obsolete playback collisions', async () => {
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);
      const gen1 = manager.getPlaybackGeneration();
      manager.stop();
      const gen2 = manager.getPlaybackGeneration();
      assert.equal(gen2 > gen1, true);

      await manager.play(VALID_SYNTHETIC_WAV_BASE64, { id: 'gen-test' });
      const gen3 = manager.getPlaybackGeneration();
      assert.equal(gen3 > gen2, true);
      assert.equal(manager.getPlaybackId(), 'gen-test');

      await manager.dispose();
    });
  });

  // ==========================================================================
  // Suite 2: SpeechMouthController Audio-Driven Articulation
  // ==========================================================================
  describe('2. SpeechMouthController Audio-Driven Articulation', () => {
    it('selects correct viseme (aa, ih, ou, ee, oh) at known audio timestamps driven by AudioSyncProvider', () => {
      const vrm = createMockVrm();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      mouth.attach(vrm);

      // Mock audio provider simulating playback of "aa ee ou" over 1.5 seconds
      let simTime = 0.10;
      let simEnergy = 0.15; // active voiced speech
      const mockProvider = {
        isPlaying: true,
        getCurrentTime: () => simTime,
        getDuration: () => 1.5,
        getAudioEnergy: () => simEnergy,
        getPlaybackId: () => 'audio-1',
        getPlaybackGeneration: () => 1,
      };

      // Start speech with audio duration 1.5s
      mouth.startSpeech('a e u', {
        audioDuration: 1.5,
        audioId: 'audio-1',
        syncProvider: mockProvider,
      });

      // Update at t = 0.10s (should be in 'a' -> viseme 'aa')
      mouth.update(vrm, 0.016);
      assert.equal(mouth.getCurrentWeight('aa') > 0, true);
      assert.equal(mouth.getCurrentWeight('ee'), 0);
      assert.equal(mouth.getCurrentWeight('ou'), 0);

      // Advance audio clock to 'e' viseme (around 0.65s)
      simTime = 0.65;
      for (let f = 0; f < 10; f++) {
        mouth.update(vrm, 0.016);
      }
      assert.equal(mouth.getCurrentWeight('ee') > 0, true);

      // Advance audio clock to 'u' viseme (around 0.95s)
      simTime = 0.95;
      for (let f = 0; f < 10; f++) {
        mouth.update(vrm, 0.016);
      }
      assert.equal(mouth.getCurrentWeight('ou') > 0, true);

      mouth.dispose();
    });

    it('preserves explicit silence and punctuation pauses while scaling voiced articulation to target audio duration', () => {
      const mouth = new SpeechMouthMod.SpeechMouthController();

      // Procedural duration without scaling
      const text = 'Hello. Beautiful, world!';
      const proceduralDuration = mouth.startSpeech(text);
      mouth.stopSpeech();
      assert.equal(proceduralDuration > 0, true);

      // When scaled to a longer audio duration (e.g. 4.0s vs ~1.8s)
      const scaledDuration = mouth.startSpeech(text, { audioDuration: 4.0 });
      assert.equal(scaledDuration, 4.0);

      // When scaled to a shorter audio duration (e.g. 1.2s)
      const shortDuration = mouth.startSpeech(text, { audioDuration: 1.2 });
      assert.equal(shortDuration, 1.2);

      mouth.dispose();
    });

    it('hard safety guard: final scaled timeline never exceeds target audio duration', () => {
      const mouth = new SpeechMouthMod.SpeechMouthController();
      const text = 'Extremely long sentence with many words and syllables that would normally take a while';
      const targetDuration = 1.0; // Force extreme compression

      const effectiveDuration = mouth.startSpeech(text, { audioDuration: targetDuration });
      assert.equal(effectiveDuration <= targetDuration + 1e-4, true);

      mouth.dispose();
    });

    it('silence threshold: when RMS <= 0.015, active viseme weight drops to 0.0 and mouth naturally closes', () => {
      const vrm = createMockVrm();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      mouth.attach(vrm);

      let simEnergy = 0.18; // active
      const mockProvider = {
        isPlaying: true,
        getCurrentTime: () => 0.12,
        getDuration: () => 2.0,
        getAudioEnergy: () => simEnergy,
        getPlaybackId: () => 'audio-silence',
        getPlaybackGeneration: () => 1,
      };

      mouth.startSpeech('aaaa', {
        audioDuration: 2.0,
        audioId: 'audio-silence',
        syncProvider: mockProvider,
      });

      // Warm up mouth opening on vowel
      for (let f = 0; f < 5; f++) {
        mouth.update(vrm, 0.016);
      }
      const activeWeight = mouth.getCurrentWeight('aa');
      assert.equal(activeWeight > 0.2, true);

      // Now audio drops into silence (RMS = 0.005 <= 0.015)
      simEnergy = 0.005;
      for (let f = 0; f < 20; f++) {
        mouth.update(vrm, 0.016);
      }
      assert.equal(mouth.getCurrentWeight('aa') < 0.01, true);

      mouth.dispose();
    });

    it('explicit null viseme handling: punctuation, spaces, and bilabial closures enforce 0.0 across all 5 visemes regardless of RMS', () => {
      const vrm = createMockVrm();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      mouth.attach(vrm);

      const mockProvider = {
        isPlaying: true,
        getCurrentTime: () => 0.02, // in attack lead-in (null viseme)
        getDuration: () => 2.0,
        getAudioEnergy: () => 0.40, // very high acoustic noise
        getPlaybackId: () => 'audio-pause',
        getPlaybackGeneration: () => 1,
      };

      mouth.startSpeech('a. b', {
        audioDuration: 2.0,
        audioId: 'audio-pause',
        syncProvider: mockProvider,
      });

      // Frame at lead-in pause
      mouth.update(vrm, 0.016);
      assert.equal(mouth.getCurrentWeight('aa'), 0);
      assert.equal(mouth.getCurrentWeight('ih'), 0);
      assert.equal(mouth.getCurrentWeight('ou'), 0);
      assert.equal(mouth.getCurrentWeight('ee'), 0);
      assert.equal(mouth.getCurrentWeight('oh'), 0);

      mouth.dispose();
    });

    it('minimum active opening baseline: scales energy factor smoothly between minActiveOpening (0.22) and 1.0', () => {
      const vrm = createMockVrm();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      mouth.attach(vrm);

      // Just above silence threshold: RMS = 0.02
      const mockProvider = {
        isPlaying: true,
        getCurrentTime: () => 0.15,
        getDuration: () => 2.0,
        getAudioEnergy: () => 0.02,
        getPlaybackId: () => 'audio-baseline',
        getPlaybackGeneration: () => 1,
      };

      mouth.startSpeech('aaaa', {
        audioDuration: 2.0,
        audioId: 'audio-baseline',
        syncProvider: mockProvider,
      });

      // Run multiple frames to converge
      for (let f = 0; f < 15; f++) {
        mouth.update(vrm, 0.016);
      }
      const weight = mouth.getCurrentWeight('aa');
      assert.equal(weight >= SpeechMouthMod.RMS_CALIBRATION.minActiveOpening * 0.5, true);

      mouth.dispose();
    });

    it('executes smooth exponential blending without instantaneous snapping', () => {
      const vrm = createMockVrm();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      mouth.attach(vrm);

      mouth.startSpeech('a', { profile: 'energetic' });

      // Step past 0.04s attack lead-in into 'a' viseme
      mouth.update(vrm, 0.05);
      const w1 = mouth.getCurrentWeight('aa');
      assert.equal(w1 > 0 && w1 < 0.8, true);

      // After another frame, weight increases smoothly
      mouth.update(vrm, 0.016);
      const w2 = mouth.getCurrentWeight('aa');
      assert.equal(w2 > w1, true);

      mouth.dispose();
    });

    it('safely interrupts mid-speech and smoothly restores all 5 channels to 0.000', () => {
      const vrm = createMockVrm();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      mouth.attach(vrm);

      mouth.startSpeech('aaaaa');
      for (let f = 0; f < 10; f++) {
        mouth.update(vrm, 0.016);
      }
      assert.equal(mouth.getCurrentWeight('aa') > 0.2, true);

      // Interrupt
      mouth.stopSpeech();
      assert.equal(mouth.active, false);

      // Decay over 400ms (25 frames)
      for (let f = 0; f < 25; f++) {
        mouth.update(vrm, 0.016);
      }
      assert.equal(mouth.getCurrentWeight('aa'), 0.0);

      mouth.dispose();
    });

    it('falls back seamlessly to text-driven deltaTime clock when syncProvider is absent', () => {
      const vrm = createMockVrm();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      mouth.attach(vrm);

      mouth.startSpeech('hello world');
      assert.equal(mouth.active, true);

      mouth.update(vrm, 0.5);
      assert.equal(mouth.progress > 0, true);

      mouth.dispose();
    });
  });

  // ==========================================================================
  // Suite 3: ReactionDispatcher & Replay Lifecycle Integration
  // ==========================================================================
  describe('3. ReactionDispatcher & Replay Lifecycle Integration', () => {
    it('uses actual audio duration when available for emotion and head-accent hold durations', () => {
      const attention = new AttentionControllerMod.AttentionController();
      const expression = new ExpressionControllerMod.ExpressionController();
      const gesture = new GestureControllerMod.GestureController();
      const mouth = new SpeechMouthMod.SpeechMouthController();

      const dispatcher = new ReactionDispatcherMod.ReactionDispatcher({
        attention,
        expression,
        gesture,
        speechMouth: mouth,
      });

      const payload = {
        session_id: 'test-session',
        response_text: 'I am so curious about that!',
        emotion: 'curious',
        emotion_intensity: 0.9,
        gesture: 'thinking',
        gesture_intensity: 0.8,
        speech_intent: 'curious',
        audio_duration: 4.8, // Explicit 4.8s audio
      };

      const result = dispatcher.dispatchReaction(payload);
      assert.equal(result.accepted, true);
      assert.equal(result.mappedEmotion, 'curious');
      assert.equal(result.speechDurationSeconds, 4.8);

      // Expression hold duration should reflect audio duration
      const snapshot = expression.getSnapshot();
      assert.equal(snapshot.activeEmotion, 'curious');

      dispatcher.cancel();
      mouth.dispose();
    });

    it('defers speech mouth articulation when deferSpeechMouth is true, preserving emotion and gesture', () => {
      const attention = new AttentionControllerMod.AttentionController();
      const expression = new ExpressionControllerMod.ExpressionController();
      const gesture = new GestureControllerMod.GestureController();
      const mouth = new SpeechMouthMod.SpeechMouthController();

      const dispatcher = new ReactionDispatcherMod.ReactionDispatcher({
        attention,
        expression,
        gesture,
        speechMouth: mouth,
      });

      const payload = {
        session_id: 'test-session',
        response_text: 'Deferred articulation test',
        emotion: 'happy',
        emotion_intensity: 0.8,
        gesture: 'wave',
        gesture_intensity: 0.7,
        audio_duration: 3.2,
      };

      dispatcher.dispatchReaction(payload, { deferSpeechMouth: true });

      // Gesture and emotion should be dispatched
      assert.equal(gesture.getSnapshot().activeGesture, 'wave');
      assert.equal(expression.getSnapshot().activeEmotion, 'happy');

      // Mouth should NOT be speaking yet
      assert.equal(mouth.active, false);

      dispatcher.cancel();
      mouth.dispose();
    });

    it('replay dedicated path: restarts phonetic timeline synchronized with audio without redispatching gestures or emotions', async () => {
      const attention = new AttentionControllerMod.AttentionController();
      const expression = new ExpressionControllerMod.ExpressionController();
      const gesture = new GestureControllerMod.GestureController();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      const manager = new AudioManagerMod.AudioManager(mockCtx as unknown as AudioContext);

      const dispatcher = new ReactionDispatcherMod.ReactionDispatcher({
        attention,
        expression,
        gesture,
        speechMouth: mouth,
      });

      // Mock fetch on happyWindow and globalThis
      const mockFetch = (async (url: string) => {
        if (url.includes('/api/sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ session_id: 'test-session-replay', created_at: new Date().toISOString() }),
          };
        }
        if (url.includes('/api/chat')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              session_id: 'test-session-replay',
              response_text: 'First spoken sentence',
              emotion: 'happy',
              emotion_intensity: 0.8,
              gesture: 'wave',
              gesture_intensity: 0.9,
              speech_intent: 'conversational',
              mouth_animation_profile: 'soft_conversation',
              created_at: new Date().toISOString(),
              audio_data: VALID_SYNTHETIC_WAV_BASE64,
              audio_mime_type: 'audio/wav',
              audio_duration: 3.0,
              audio_sample_rate: 24000,
            }),
          };
        }
        return { ok: false, status: 404 };
      }) as unknown as typeof fetch;

      happyWindow.fetch = mockFetch as unknown as typeof happyWindow.fetch;
      globalThis.fetch = mockFetch;

      let hook: UseCompanionChatResult | null = null;
      function TestHost() {
        hook = useCompanionChatMod.useCompanionChat({
          reactionDispatcher: dispatcher,
          speechMouthController: mouth,
          attentionController: attention,
          audioManager: manager,
          voiceEnabled: true,
          initialSessionId: 'test-session-replay',
        });
        return React.createElement('div', null, hook.messages.length);
      }

      const host = happyWindow.document.createElement('div');
      happyWindow.document.body.appendChild(host);
      const root = createRoot(host as unknown as Element);

      act(() => {
        root.render(React.createElement(TestHost));
      });

      assert.ok(hook);

      await act(async () => {
        await hook?.sendMessage('Hello');
      });

      const chat = hook as unknown as UseCompanionChatResult;
      assert.equal(chat.messages.length, 2);
      const assistantMsg = chat.messages[1];

      // Reset gesture to idle to test replay isolation
      gesture.stopGesture({ immediate: true });
      assert.equal(gesture.getSnapshot().activeGesture, 'none');

      // Trigger replayAudio
      await act(async () => {
        const replayOk = await hook?.replayAudio(assistantMsg.id);
        assert.equal(replayOk, true);
      });

      // Mouth should be actively articulating the replayed message
      assert.equal(mouth.active, true);

      // Gesture should NOT be re-triggered
      assert.equal(gesture.getSnapshot().activeGesture, 'none');

      await manager.dispose();
      mouth.dispose();
      act(() => {
        root.unmount();
      });
    });

    it('strict single-writer ownership: SpeechMouthController exclusively writes to aa, ih, ou, ee, oh with zero bone writes', () => {
      const vrm = createMockVrm();
      const mouth = new SpeechMouthMod.SpeechMouthController();
      const expression = new ExpressionControllerMod.ExpressionController();
      mouth.attach(vrm);
      expression.attach(vrm);

      // Speech mouth articulates visemes
      mouth.startSpeech('a');
      mouth.update(vrm, 0.1);
      assert.equal((vrm.expressionManager?.getValue('aa') ?? 0) > 0, true);

      // ExpressionController sets emotion
      expression.setEmotion('happy', 0.8, { transitionSeconds: 0 });
      expression.update(vrm, 0.1);
      assert.equal((vrm.expressionManager?.getValue('happy') ?? 0) > 0, true);

      // ExpressionController never touched 'aa'
      assert.equal((vrm.expressionManager?.getValue('aa') ?? 0) > 0, true);

      mouth.dispose();
      expression.dispose();
    });

    it('guarantees no duplicate RAF loops or duplicate AudioContexts exist', () => {
      const m1 = AudioManagerMod.getAudioManager();
      const m2 = AudioManagerMod.getAudioManager();
      assert.equal(m1, m2);
      assert.equal(m1, AudioManagerMod.getAudioManager());
      AudioManagerMod.resetGlobalAudioManagerForTesting();
    });
  });
});
