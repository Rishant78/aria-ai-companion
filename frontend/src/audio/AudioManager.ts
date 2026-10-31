/**
 * ==============================================================================
 * AudioManager — Web Audio API Service for Companion Voice Playback
 * Milestone 7, Stage 2
 * ==============================================================================
 */

export interface AudioPlaybackState {
  isPlaying: boolean;
  currentId: string | null;
  contextState: AudioContextState | 'uninitialized';
  lastPlayedId: string | null;
  hasAudioToReplay: boolean;
}

export interface PlayAudioOptions {
  id?: string;
  onEnded?: () => void;
  onError?: (err: Error) => void;
}

/**
 * Decodes a Base64 string (with or without data URI prefix) to an ArrayBuffer.
 * Handles browser window.atob and Node.js Buffer for testing environments.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('Invalid audio payload: base64 input is empty or invalid.');
  }

  // Strip data URL prefix if present e.g. "data:audio/wav;base64,"
  const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
  const trimmed = cleanBase64.trim();
  if (!trimmed) {
    throw new Error('Invalid audio payload: base64 content is empty.');
  }

  // Validate Base64 character set (A-Z, a-z, 0-9, +, /, =)
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  if (!base64Regex.test(trimmed)) {
    throw new Error('Invalid audio payload: malformed base64 character sequence.');
  }

  if (typeof atob === 'function') {
    try {
      const binaryString = atob(trimmed);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (err) {
      throw new Error(`Failed to decode base64 audio payload: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from: (str: string, enc: string) => { buffer: ArrayBufferLike; byteOffset: number; byteLength: number } };
  }).Buffer;

  if (maybeBuffer && typeof maybeBuffer.from === 'function') {
    const buf = maybeBuffer.from(trimmed, 'base64');
    const u8 = new Uint8Array(buf.byteLength);
    const src = new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
    u8.set(src);
    return u8.buffer;
  }

  throw new Error('No Base64 decoding mechanism available in current environment.');
}

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private timeDomainBuffer: Float32Array | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentId: string | null = null;
  private isPlayingState = false;

  private playbackStartTime = 0;
  private currentAudioDuration = 0;

  private lastPayload: string | ArrayBuffer | AudioBuffer | null = null;
  private lastId: string | null = null;

  private bufferCache = new Map<string, AudioBuffer>();
  private listeners = new Set<(state: AudioPlaybackState) => void>();

  // Monotonic generation counter to prevent race conditions during asynchronous decoding
  private playbackGeneration = 0;

  private stateSnapshot: AudioPlaybackState = {
    isPlaying: false,
    currentId: null,
    contextState: 'uninitialized',
    lastPlayedId: null,
    hasAudioToReplay: false,
  };

  constructor(providedContext?: AudioContext | null) {
    if (providedContext) {
      this.audioContext = providedContext;
      this.initMasterGain();
      this.updateStateSnapshot();
    }
  }

  /**
   * Lazily initializes or returns the single AudioContext instance.
   */
  public getAudioContext(): AudioContext | null {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      return this.audioContext;
    }

    if (typeof window === 'undefined') {
      return null;
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    try {
      this.audioContext = new AudioContextClass();
      this.initMasterGain();
      return this.audioContext;
    } catch (err) {
      console.warn('[AudioManager] Failed to initialize AudioContext:', err);
      return null;
    }
  }

  private initMasterGain(): void {
    if (!this.audioContext || this.audioContext.state === 'closed') return;
    try {
      if (!this.masterGainNode) {
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        this.masterGainNode.connect(this.audioContext.destination);
      }
      if (!this.analyserNode && typeof this.audioContext.createAnalyser === 'function') {
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = 512;
        this.analyserNode.smoothingTimeConstant = 0.2;
        this.timeDomainBuffer = new Float32Array(this.analyserNode.fftSize);
        if (this.masterGainNode) {
          this.analyserNode.connect(this.masterGainNode);
        }
      }
    } catch {
      // Audio graph node creation fallback
    }
  }

  /**
   * Resumes a suspended AudioContext through a genuine user gesture.
   */
  public async unlock(): Promise<boolean> {
    const ctx = this.getAudioContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('[AudioManager] Failed to resume AudioContext:', err);
        return false;
      }
    }

    this.notifyState();
    return ctx.state === 'running';
  }

  /**
   * Decodes binary audio data using AudioContext.decodeAudioData with caching support.
   */
  public async decodeAudio(data: ArrayBuffer, cacheKey?: string): Promise<AudioBuffer> {
    if (cacheKey && this.bufferCache.has(cacheKey)) {
      return this.bufferCache.get(cacheKey)!;
    }

    const ctx = this.getAudioContext();
    if (!ctx) {
      throw new Error('AudioContext is not available for audio decoding.');
    }

    // Clone the buffer slice to prevent issues with detached ArrayBuffers
    const bufferCopy = data.slice(0);

    return new Promise<AudioBuffer>((resolve, reject) => {
      // Modern promise-based decodeAudioData with legacy callback fallback
      let resolved = false;
      const onSuccess = (decoded: AudioBuffer) => {
        if (resolved) return;
        resolved = true;
        if (cacheKey) {
          this.bufferCache.set(cacheKey, decoded);
        }
        resolve(decoded);
      };

      const onError = (error: unknown) => {
        if (resolved) return;
        resolved = true;
        reject(error instanceof Error ? error : new Error(String(error || 'Audio decoding failed.')));
      };

      try {
        const promise = ctx.decodeAudioData(bufferCopy, onSuccess, onError);
        if (promise && typeof promise.then === 'function') {
          promise.then(onSuccess).catch(onError);
        }
      } catch (err) {
        onError(err);
      }
    });
  }

  /**
   * Plays decoded audio through an AudioBufferSourceNode.
   * Cancels any currently active playback before starting.
   */
  public async play(
    payload: string | ArrayBuffer | AudioBuffer,
    options: PlayAudioOptions = {},
  ): Promise<boolean> {
    // Immediately stop any existing playback before processing new audio
    this.stop();

    // Capture the new generation identifier for this playback request
    const generation = ++this.playbackGeneration;

    const ctx = this.getAudioContext();
    if (!ctx) {
      options.onError?.(new Error('AudioContext unavailable.'));
      return false;
    }

    // Resume if suspended (best effort unlock)
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Autoplay may be restricted without user interaction
      }
    }

    let audioBuffer: AudioBuffer;

    try {
      if (typeof payload === 'string') {
        const arrayBuf = base64ToArrayBuffer(payload);
        audioBuffer = await this.decodeAudio(arrayBuf, options.id);
      } else if (payload instanceof ArrayBuffer) {
        audioBuffer = await this.decodeAudio(payload, options.id);
      } else {
        audioBuffer = payload;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn('[AudioManager] Failed to decode audio payload:', error);
      options.onError?.(error);
      return false;
    }

    // Safeguard: Check if playback was stopped or superseded while decoding
    if (generation !== this.playbackGeneration) {
      return false;
    }

    // Create and configure AudioBufferSourceNode
    try {
      this.initMasterGain();

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      // Connect graph: Source -> Analyser -> MasterGain -> Destination
      if (this.analyserNode) {
        source.connect(this.analyserNode);
      } else if (this.masterGainNode) {
        source.connect(this.masterGainNode);
      } else {
        source.connect(ctx.destination);
      }

      const scheduledStartTime = ctx.currentTime;
      this.currentSource = source;
      this.currentId = options.id ?? null;
      this.isPlayingState = true;
      this.playbackStartTime = scheduledStartTime;
      this.currentAudioDuration = audioBuffer.duration;
      this.lastPayload = payload;
      this.lastId = options.id ?? null;

      source.onended = () => {
        if (this.currentSource === source) {
          this.currentSource = null;
          this.currentId = null;
          this.isPlayingState = false;
          this.playbackStartTime = 0;
          this.currentAudioDuration = 0;
          this.notifyState();
          options.onEnded?.();
        }
      };

      source.start(scheduledStartTime);
      this.notifyState();
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn('[AudioManager] Failed to start audio source:', error);
      this.currentSource = null;
      this.isPlayingState = false;
      this.currentId = null;
      this.playbackStartTime = 0;
      this.currentAudioDuration = 0;
      this.notifyState();
      options.onError?.(error);
      return false;
    }
  }

  /**
   * Replays the last played audio payload.
   */
  public async replay(): Promise<boolean> {
    if (!this.lastPayload) {
      return false;
    }
    return this.play(this.lastPayload, { id: this.lastId ?? undefined });
  }

  /**
   * Immediately stops currently active playback, releases nodes, and resets state.
   * Safe to call repeatedly and when no playback is active.
   */
  public stop(): void {
    this.playbackGeneration++;

    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop(0);
        this.currentSource.disconnect();
      } catch {
        // Safe no-op if node is already stopped or disconnected
      }
      this.currentSource = null;
    }

    this.playbackStartTime = 0;
    this.currentAudioDuration = 0;

    if (this.isPlayingState || this.currentId !== null) {
      this.isPlayingState = false;
      this.currentId = null;
      this.notifyState();
    }
  }

  /**
   * Returns current elapsed playback position in seconds on the hardware audio clock.
   * Returns 0 if idle, stopped, or completed.
   */
  public getCurrentTime(): number {
    if (!this.isPlayingState || !this.audioContext || this.playbackStartTime <= 0) {
      return 0;
    }
    const elapsed = this.audioContext.currentTime - this.playbackStartTime;
    return Math.max(0, Math.min(elapsed, this.currentAudioDuration));
  }

  /**
   * Returns duration of the currently playing audio buffer in seconds.
   */
  public getDuration(): number {
    return this.currentAudioDuration;
  }

  /**
   * Calculates and returns normalized RMS acoustic energy [0, 1] from the AnalyserNode.
   * Returns 0 if idle, uninitialized, or on silence.
   */
  public getAudioEnergy(): number {
    if (!this.isPlayingState || !this.analyserNode || !this.timeDomainBuffer) {
      return 0;
    }
    try {
      this.analyserNode.getFloatTimeDomainData(this.timeDomainBuffer as unknown as Float32Array<ArrayBuffer>);
      let sumSquares = 0;
      const len = this.timeDomainBuffer.length;
      for (let i = 0; i < len; i++) {
        const val = this.timeDomainBuffer[i];
        sumSquares += val * val;
      }
      return Math.sqrt(sumSquares / len);
    } catch {
      return 0;
    }
  }

  /**
   * Exposes whether audio is actively playing.
   */
  public get isPlaying(): boolean {
    return this.isPlayingState;
  }

  /**
   * Exposes the currently active dialogue / playback ID.
   */
  public get currentPlaybackId(): string | null {
    return this.currentId;
  }

  public getPlaybackId(): string | null {
    return this.currentId;
  }

  /**
   * Exposes the current monotonic playback generation.
   */
  public get currentGeneration(): number {
    return this.playbackGeneration;
  }

  public getPlaybackGeneration(): number {
    return this.playbackGeneration;
  }

  private updateStateSnapshot(): void {
    this.stateSnapshot = {
      isPlaying: this.isPlayingState,
      currentId: this.currentId,
      contextState: this.audioContext ? this.audioContext.state : 'uninitialized',
      lastPlayedId: this.lastId,
      hasAudioToReplay: this.lastPayload !== null,
    };
  }

  /**
   * Returns current cached playback state snapshot.
   */
  public getState(): AudioPlaybackState {
    return this.stateSnapshot;
  }

  /**
   * Subscribes to playback state transitions.
   */
  public subscribe(listener: (state: AudioPlaybackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyState(): void {
    this.updateStateSnapshot();
    const state = this.stateSnapshot;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[AudioManager] Listener notification failed:', err);
      }
    }
  }

  /**
   * Disposes all audio nodes, clears buffers/listeners, and closes AudioContext.
   */
  public async dispose(): Promise<void> {
    this.stop();
    this.bufferCache.clear();
    this.listeners.clear();
    this.lastPayload = null;
    this.lastId = null;

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.analyserNode = null;
    }
    this.timeDomainBuffer = null;

    if (this.masterGainNode) {
      try {
        this.masterGainNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.masterGainNode = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch {
        // Ignore close errors
      }
      this.audioContext = null;
    }
    this.updateStateSnapshot();
  }
}

// Global singleton instance for shared audio context and stable lifecycle
let globalAudioManager: AudioManager | null = null;

export function getAudioManager(): AudioManager {
  if (!globalAudioManager) {
    globalAudioManager = new AudioManager();
  }
  return globalAudioManager;
}

export function resetGlobalAudioManagerForTesting(): void {
  if (globalAudioManager) {
    globalAudioManager.dispose();
    globalAudioManager = null;
  }
}
