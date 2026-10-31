import type { VRM } from '@pixiv/three-vrm';
import type { AvatarController } from './types';

export const VISEME_NAMES = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;
export type VisemeName = (typeof VISEME_NAMES)[number];

export const MOUTH_PROFILES = [
  'soft_conversation',
  'energetic',
  'gentle',
  'deliberate',
  'minimal',
] as const;
export type MouthAnimationProfileName = (typeof MOUTH_PROFILES)[number];

export const SPEECH_INTENTS = [
  'conversational',
  'excited',
  'playful',
  'gentle',
  'reassuring',
  'curious',
  'serious',
  'surprised',
] as const;
export type SpeechIntentName = (typeof SPEECH_INTENTS)[number];

export interface ProfileSpec {
  syllableDurationBase: number;
  peakAmplitude: number;
  pauseCommaSeconds: number;
  pausePeriodSeconds: number;
  interWordDipSeconds: number;
}

export const PROFILE_SPECS: Readonly<Record<MouthAnimationProfileName, ProfileSpec>> = {
  soft_conversation: {
    syllableDurationBase: 0.13,
    peakAmplitude: 0.65,
    pauseCommaSeconds: 0.20,
    pausePeriodSeconds: 0.35,
    interWordDipSeconds: 0.05,
  },
  energetic: {
    syllableDurationBase: 0.095,
    peakAmplitude: 0.85,
    pauseCommaSeconds: 0.14,
    pausePeriodSeconds: 0.25,
    interWordDipSeconds: 0.04,
  },
  gentle: {
    syllableDurationBase: 0.17,
    peakAmplitude: 0.42,
    pauseCommaSeconds: 0.24,
    pausePeriodSeconds: 0.40,
    interWordDipSeconds: 0.06,
  },
  deliberate: {
    syllableDurationBase: 0.15,
    peakAmplitude: 0.75,
    pauseCommaSeconds: 0.22,
    pausePeriodSeconds: 0.42,
    interWordDipSeconds: 0.05,
  },
  minimal: {
    syllableDurationBase: 0.14,
    peakAmplitude: 0.25,
    pauseCommaSeconds: 0.16,
    pausePeriodSeconds: 0.28,
    interWordDipSeconds: 0.04,
  },
};

export const SPEECH_INTENT_AMPLITUDE_MULTIPLIERS: Readonly<Record<SpeechIntentName, number>> = {
  conversational: 1.0,
  excited: 1.15,
  playful: 1.10,
  gentle: 0.85,
  reassuring: 0.85,
  curious: 1.05,
  serious: 0.90,
  surprised: 1.20,
};

/**
 * Minimal audio synchronization interface for driving viseme articulation from
 * the hardware audio clock and real-time RMS acoustic energy.
 */
export interface AudioSyncProvider {
  readonly isPlaying: boolean;
  getCurrentTime(): number;
  getDuration(): number;
  getAudioEnergy(): number;
  getPlaybackId(): string | null;
  getPlaybackGeneration(): number;
}

/**
 * Calibrated energy envelope thresholds for speech RMS viseme modulation.
 */
export const RMS_CALIBRATION = {
  silenceThreshold: 0.015,
  peakThreshold: 0.18,
  minActiveOpening: 0.22,
} as const;

export interface StartSpeechOptions {
  profile?: MouthAnimationProfileName;
  speechIntent?: SpeechIntentName;
  intensity?: number;
  audioDuration?: number | null;
  audioId?: string | null;
  syncProvider?: AudioSyncProvider | null;
  onComplete?: () => void;
}

interface ArticulationSegment {
  viseme: VisemeName | null;
  duration: number;
  intensity: number;
}

export class SpeechMouthController implements AvatarController {
  public readonly id = 'speechMouth';

  private vrm: VRM | null = null;
  private paused = false;

  // Audio synchronization references
  private syncProvider: AudioSyncProvider | null = null;
  private activeAudioId: string | null = null;
  private activeAudioGeneration = -1;

  // Live expression weights (zero-allocation fixed fields)
  private currentWeights: Record<VisemeName, number> = {
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
  };

  private targetWeights: Record<VisemeName, number> = {
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
  };

  // Timeline playback state
  private isSpeaking = false;
  private elapsedSpeechSeconds = 0;
  private totalSpeechDuration = 0;
  private segments: ArticulationSegment[] = [];
  private onCompleteCallback: (() => void) | null = null;

  // Smoothing parameter (lambda in s^-1)
  private readonly blendRate = 22.0;

  public attach(vrm: VRM): void {
    this.vrm = vrm;
    this.resetChannelsToZero();
  }

  public attachAudioSync(provider: AudioSyncProvider | null): void {
    this.syncProvider = provider;
  }

  public getAudioSync(): AudioSyncProvider | null {
    return this.syncProvider;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public get active(): boolean {
    return this.isSpeaking;
  }

  public get duration(): number {
    return this.totalSpeechDuration;
  }

  public get progress(): number {
    if (this.totalSpeechDuration <= 0) return 1.0;
    return Math.min(1.0, this.elapsedSpeechSeconds / this.totalSpeechDuration);
  }

  public getCurrentWeight(viseme: VisemeName): number {
    return this.currentWeights[viseme];
  }

  public startSpeech(text: string, options: StartSpeechOptions = {}): number {
    // 1. Cancel any active speech cleanly without snapping
    if (this.isSpeaking && this.onCompleteCallback) {
      const prevCallback = this.onCompleteCallback;
      this.onCompleteCallback = null;
      prevCallback();
    }

    const trimmed = text ? text.trim() : '';
    if (!trimmed) {
      this.stopSpeech();
      if (options.onComplete) {
        options.onComplete();
      }
      return 0;
    }

    const profileName = options.profile ?? 'soft_conversation';
    const profile = PROFILE_SPECS[profileName] ?? PROFILE_SPECS.soft_conversation;

    const intent = options.speechIntent ?? 'conversational';
    const intentMult = SPEECH_INTENT_AMPLITUDE_MULTIPLIERS[intent] ?? 1.0;

    const userIntensity = Math.max(0.0, Math.min(1.0, options.intensity ?? 1.0));
    const effectivePeak = profile.peakAmplitude * intentMult * userIntensity;

    const targetAudioDuration =
      options.audioDuration && options.audioDuration > 0
        ? options.audioDuration
        : null;

    if (options.syncProvider !== undefined) {
      this.syncProvider = options.syncProvider;
    }
    this.activeAudioId = options.audioId ?? (this.syncProvider?.getPlaybackId() ?? null);
    this.activeAudioGeneration = this.syncProvider?.getPlaybackGeneration() ?? -1;

    // 2. Parse text into procedural articulation segments with audio duration scaling
    this.segments = this.parseTextToSegments(trimmed, profile, effectivePeak, targetAudioDuration);
    this.totalSpeechDuration = targetAudioDuration ?? this.segments.reduce((sum, seg) => sum + seg.duration, 0);
    this.elapsedSpeechSeconds = 0;
    this.isSpeaking = true;
    this.onCompleteCallback = options.onComplete ?? null;

    return this.totalSpeechDuration;
  }

  public stopSpeech(): void {
    if (this.isSpeaking) {
      this.isSpeaking = false;
      this.segments = [];
      this.activeAudioId = null;
      this.activeAudioGeneration = -1;
      const cb = this.onCompleteCallback;
      this.onCompleteCallback = null;
      if (cb) {
        cb();
      }
    }
    // Set all target weights to zero for smooth decay
    for (const v of VISEME_NAMES) {
      this.targetWeights[v] = 0;
    }
  }

  public cancel(): void {
    this.stopSpeech();
    this.resetChannelsToZero();
  }

  public update(vrm: VRM, deltaTime: number): void {
    const targetVrm = vrm ?? this.vrm;
    if (!targetVrm || this.paused || !Number.isFinite(deltaTime) || deltaTime <= 0) {
      return;
    }

    // 1. Evaluate articulation timeline if actively speaking
    if (this.isSpeaking) {
      const isAudioActive =
        Boolean(this.syncProvider) &&
        Boolean(this.syncProvider?.isPlaying) &&
        (this.activeAudioId === null || this.syncProvider?.getPlaybackId() === this.activeAudioId) &&
        (this.activeAudioGeneration === -1 || this.syncProvider?.getPlaybackGeneration() === this.activeAudioGeneration);

      if (isAudioActive && this.syncProvider) {
        // Audio-clock-driven segment selection
        this.elapsedSpeechSeconds = this.syncProvider.getCurrentTime();
      } else {
        // Text-driven fallback
        this.elapsedSpeechSeconds += deltaTime;
      }

      if (this.elapsedSpeechSeconds >= this.totalSpeechDuration) {
        this.stopSpeech();
      } else {
        // Find current active segment
        let accum = 0;
        let activeSeg: ArticulationSegment | null = null;
        for (let i = 0; i < this.segments.length; i++) {
          const seg = this.segments[i];
          if (this.elapsedSpeechSeconds >= accum && this.elapsedSpeechSeconds < accum + seg.duration) {
            activeSeg = seg;
            break;
          }
          accum += seg.duration;
        }

        // Set target viseme weights
        if (!activeSeg || activeSeg.viseme === null) {
          // Explicit pause / silence segment -> force all visemes to 0 regardless of RMS energy
          for (const v of VISEME_NAMES) {
            this.targetWeights[v] = 0;
          }
        } else {
          const targetViseme = activeSeg.viseme;
          let intensity = activeSeg.intensity;

          // Modulate with RMS energy if audio is actively driving this speech
          if (isAudioActive && this.syncProvider) {
            const rms = this.syncProvider.getAudioEnergy();
            if (rms <= RMS_CALIBRATION.silenceThreshold) {
              // Below silence threshold in audio -> mouth naturally closes
              intensity = 0;
            } else {
              const normalized = Math.min(
                1.0,
                Math.max(
                  0.0,
                  (rms - RMS_CALIBRATION.silenceThreshold) /
                    (RMS_CALIBRATION.peakThreshold - RMS_CALIBRATION.silenceThreshold),
                ),
              );
              // Minimum opening baseline during active articulation + dynamic opening
              const energyFactor =
                RMS_CALIBRATION.minActiveOpening +
                (1.0 - RMS_CALIBRATION.minActiveOpening) * normalized;
              intensity = activeSeg.intensity * energyFactor;
            }
          }

          // Single active viseme receives modulated intensity; all other 4 channels remain strictly zero
          for (const v of VISEME_NAMES) {
            this.targetWeights[v] = v === targetViseme ? intensity : 0;
          }
        }
      }
    }

    // 2. Exponentially smooth current weights towards target weights
    const factor = 1.0 - Math.exp(-this.blendRate * deltaTime);

    for (const v of VISEME_NAMES) {
      const cur = this.currentWeights[v];
      const target = this.targetWeights[v];
      const next = cur + (target - cur) * factor;

      if (Math.abs(next) < 1e-4 && target === 0) {
        this.currentWeights[v] = 0;
      } else {
        this.currentWeights[v] = Math.max(0.0, Math.min(1.0, next));
      }

      // Apply strictly to the 5 viseme expression presets
      targetVrm.expressionManager?.setValue(v, this.currentWeights[v]);
    }
  }

  public dispose(): void {
    this.cancel();
    this.vrm = null;
  }

  private resetChannelsToZero(): void {
    for (const v of VISEME_NAMES) {
      this.currentWeights[v] = 0;
      this.targetWeights[v] = 0;
      this.vrm?.expressionManager?.setValue(v, 0);
    }
  }

  /**
   * Procedural text-to-viseme parser.
   * Maps vowels to visemes, recognizes bilabial closures (m, b, p),
   * and introduces punctuation pauses.
   */
  private parseTextToSegments(
    text: string,
    spec: ProfileSpec,
    peakAmplitude: number,
    targetAudioDuration?: number | null,
  ): ArticulationSegment[] {
    const segments: ArticulationSegment[] = [];
    const len = text.length;
    let i = 0;

    // Attack lead-in (quick smooth opening)
    segments.push({
      viseme: null,
      duration: 0.04,
      intensity: 0,
    });

    while (i < len) {
      const ch = text[i].toLowerCase();

      // Punctuation pause checks
      if (ch === '.' || ch === '!' || ch === '?') {
        segments.push({
          viseme: null,
          duration: spec.pausePeriodSeconds,
          intensity: 0,
        });
        i++;
        continue;
      }

      if (ch === ',' || ch === ';' || ch === ':' || ch === '-') {
        segments.push({
          viseme: null,
          duration: spec.pauseCommaSeconds,
          intensity: 0,
        });
        i++;
        continue;
      }

      if (ch === ' ' || ch === '\t' || ch === '\n') {
        segments.push({
          viseme: null,
          duration: spec.interWordDipSeconds,
          intensity: 0,
        });
        i++;
        continue;
      }

      // Bilabial consonants (m, b, p) produce momentary mouth closure
      if (ch === 'm' || ch === 'b' || ch === 'p') {
        segments.push({
          viseme: null,
          duration: spec.syllableDurationBase * 0.65,
          intensity: 0,
        });
        i++;
        continue;
      }

      // Vowel mapping
      let viseme: VisemeName | null = null;
      let durationFactor = 1.0;

      if (ch === 'a') {
        viseme = 'aa';
      } else if (ch === 'e') {
        viseme = 'ee';
      } else if (ch === 'i' || ch === 'y') {
        viseme = 'ih';
      } else if (ch === 'o') {
        viseme = 'oh';
      } else if (ch === 'u' || ch === 'w') {
        viseme = 'ou';
      }

      if (viseme) {
        // Look ahead for extended vowel (e.g., "aa", "oo", "ee")
        if (i + 1 < len && text[i + 1].toLowerCase() === ch) {
          durationFactor = 1.6;
          i++;
        }
        segments.push({
          viseme,
          duration: spec.syllableDurationBase * durationFactor,
          intensity: peakAmplitude,
        });
      } else {
        // Consonant transitions: dental/fricative narrow opening
        const isNarrowConsonant = 'sztdkgjcf'.includes(ch);
        if (isNarrowConsonant) {
          segments.push({
            viseme: 'ee',
            duration: spec.syllableDurationBase * 0.45,
            intensity: peakAmplitude * 0.35,
          });
        }
      }

      i++;
    }

    // Release lead-out
    segments.push({
      viseme: null,
      duration: 0.08,
      intensity: 0,
    });

    // If target audio duration is specified and valid, scale voiced segments preserving explicit pauses
    if (targetAudioDuration && targetAudioDuration > 0 && segments.length > 0) {
      let pauseDuration = 0;
      let voicedDuration = 0;

      for (const seg of segments) {
        if (seg.viseme === null) {
          pauseDuration += seg.duration;
        } else {
          voicedDuration += seg.duration;
        }
      }

      if (voicedDuration > 0) {
        // Attempt to preserve explicit pause durations and fit voiced segments into remainder
        const remainingForVoiced = targetAudioDuration - pauseDuration;
        if (remainingForVoiced >= 0.15 * targetAudioDuration) {
          // Voiced segments get the remaining audio time
          const scale = remainingForVoiced / voicedDuration;
          // Clamp extreme scale factor (0.4 to 2.5) to avoid unnatural robotic distortion
          const clampedScale = Math.max(0.4, Math.min(2.5, scale));
          for (const seg of segments) {
            if (seg.viseme !== null) {
              seg.duration *= clampedScale;
            }
          }
        } else {
          // If pauses alone take up almost the entire audio duration, scale everything proportionally
          const totalProcedural = pauseDuration + voicedDuration;
          if (totalProcedural > 0) {
            const uniformScale = Math.max(0.3, Math.min(3.0, targetAudioDuration / totalProcedural));
            for (const seg of segments) {
              seg.duration *= uniformScale;
            }
          }
        }
      }

      // Hard safety guard: ensure final timeline duration does not exceed the target audio duration
      let finalTotal = 0;
      for (const seg of segments) {
        finalTotal += seg.duration;
      }
      if (finalTotal > targetAudioDuration) {
        const shrinkFactor = targetAudioDuration / finalTotal;
        for (const seg of segments) {
          seg.duration *= shrinkFactor;
        }
      }
    }

    return segments;
  }
}
