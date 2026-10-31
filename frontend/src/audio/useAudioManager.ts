/**
 * ==============================================================================
 * useAudioManager — React Integration Hook for Voice Preferences & Audio Playback
 * Milestone 7, Stage 2
 * ==============================================================================
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AudioManager, getAudioManager } from './AudioManager';
import type { AudioPlaybackState } from './AudioManager';

export const VOICE_STORAGE_KEY = 'companion-voice-enabled';

/**
 * Reads persistent voice preference from localStorage.
 * Defaults to true (voice ON) if not configured.
 */
export function getStoredVoicePreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(VOICE_STORAGE_KEY);
    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
    // Ignore storage restrictions (incognito / blocked cookies)
  }
  return true;
}

/**
 * Saves persistent voice preference to localStorage.
 */
export function setStoredVoicePreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(VOICE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage restrictions
  }
}

export interface UseAudioManagerOptions {
  audioManager?: AudioManager | null;
  initialVoiceEnabled?: boolean;
}

export interface UseAudioManagerResult {
  audioManager: AudioManager;
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

export function useAudioManager(options: UseAudioManagerOptions = {}): UseAudioManagerResult {
  const manager = useMemo(() => {
    return options.audioManager ?? getAudioManager();
  }, [options.audioManager]);

  const [voiceEnabled, setVoiceEnabledState] = useState<boolean>(() => {
    return options.initialVoiceEnabled ?? getStoredVoicePreference();
  });

  // Subscribe to AudioManager state using useSyncExternalStore for tear-free updates
  const playbackState = useSyncExternalStore<AudioPlaybackState>(
    useCallback(
      (notify) => manager.subscribe(notify),
      [manager],
    ),
    useCallback(
      () => manager.getState(),
      [manager],
    ),
    useCallback(
      () => manager.getState(),
      [manager],
    ),
  );

  const setVoiceEnabled = useCallback(
    (enabled: boolean) => {
      setVoiceEnabledState(enabled);
      setStoredVoicePreference(enabled);
      if (!enabled) {
        manager.stop();
      }
    },
    [manager],
  );

  const toggleVoice = useCallback(() => {
    setVoiceEnabledState((prev) => {
      const next = !prev;
      setStoredVoicePreference(next);
      if (!next) {
        manager.stop();
      }
      return next;
    });
  }, [manager]);

  const playAudio = useCallback(
    async (payload: string, id?: string): Promise<boolean> => {
      if (!voiceEnabled) {
        return false;
      }
      return manager.play(payload, { id });
    },
    [manager, voiceEnabled],
  );

  const replayAudio = useCallback(
    async (payload?: string, id?: string): Promise<boolean> => {
      if (!voiceEnabled) {
        return false;
      }
      if (payload) {
        return manager.play(payload, { id });
      }
      return manager.replay();
    },
    [manager, voiceEnabled],
  );

  const stopAudio = useCallback(() => {
    manager.stop();
  }, [manager]);

  const unlockAudio = useCallback(async (): Promise<boolean> => {
    return manager.unlock();
  }, [manager]);

  // Window gesture listener to attempt early AudioContext unlock on first interaction
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFirstGesture = () => {
      manager.unlock().catch(() => {});
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };

    window.addEventListener('pointerdown', handleFirstGesture, { passive: true, once: true });
    window.addEventListener('keydown', handleFirstGesture, { passive: true, once: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
      window.removeEventListener('keydown', handleFirstGesture);
    };
  }, [manager]);

  return {
    audioManager: manager,
    voiceEnabled,
    isPlaying: playbackState.isPlaying,
    isUnlocked: playbackState.contextState === 'running',
    currentAudioId: playbackState.currentId,
    lastPlayedId: playbackState.lastPlayedId,
    hasAudioToReplay: playbackState.hasAudioToReplay,
    toggleVoice,
    setVoiceEnabled,
    playAudio,
    replayAudio,
    stopAudio,
    unlockAudio,
  };
}

