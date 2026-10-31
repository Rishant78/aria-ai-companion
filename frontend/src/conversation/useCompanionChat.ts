import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactionDispatcher } from '../character/ReactionDispatcher';
import type {
  MouthAnimationProfileName,
  SpeechIntentName,
  SpeechMouthController,
} from '../character/SpeechMouthController';
import type { AttentionController } from '../character/AttentionController';
import type { AudioManager } from '../audio/AudioManager';
import {
  createSession,
  deleteSession,
  sendChatMessage,
} from './chatApi';
import type {
  ActiveDialogueState,
  ChatMessage,
  ChatStatusKind,
  CompanionResponsePayload,
} from './ConversationTypes';

export interface UseCompanionChatOptions {
  reactionDispatcher?: ReactionDispatcher | null;
  speechMouthController?: SpeechMouthController | null;
  attentionController?: AttentionController | null;
  audioManager?: AudioManager | null;
  voiceEnabled?: boolean;
  initialSessionId?: string | null;
  autoDismissDelayMs?: number;
}

export interface UseCompanionChatResult {
  sessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  statusKind: ChatStatusKind;
  errorMessage: string | null;
  activeDialogue: ActiveDialogueState | null;
  isHistoryOpen: boolean;
  sendMessage: (text: string) => Promise<boolean>;
  replayAudio: (dialogueId?: string) => Promise<boolean>;
  cancelResponse: () => void;
  clearHistory: () => void;
  startNewSession: () => Promise<void>;
  retryLastMessage: () => Promise<boolean>;
  dismissDialogue: () => void;
  openHistory: () => void;
  closeHistory: () => void;
  toggleHistory: () => void;
}

const DEFAULT_AUTO_DISMISS_MS = 8000;

function safeRequestAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(callback);
  }
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame !== 'undefined') {
    return window.requestAnimationFrame(callback);
  }
  const timer = setTimeout(() => callback(performance.now()), 16);
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
  return timer as unknown as number;
}

function safeCancelAnimationFrame(id: number): void {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id);
    return;
  }
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame !== 'undefined') {
    window.cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
}

export function useCompanionChat({
  reactionDispatcher,
  speechMouthController,
  attentionController,
  audioManager,
  voiceEnabled = true,
  initialSessionId = null,
  autoDismissDelayMs = DEFAULT_AUTO_DISMISS_MS,
}: UseCompanionChatOptions = {}): UseCompanionChatResult {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeDialogue, setActiveDialogue] = useState<ActiveDialogueState | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealAnimFrameRef = useRef<number | null>(null);
  const isLoadingRef = useRef(false);
  const responseSeqRef = useRef<number>(0);

  // Initialize session on mount if not provided
  useEffect(() => {
    let isCancelled = false;
    if (!sessionId) {
      createSession()
        .then((newId) => {
          if (!isCancelled) {
            setSessionId(newId);
          }
        })
        .catch((err) => {
          if (!isCancelled) {
            setErrorMessage(err instanceof Error ? err.message : 'Unable to connect to companion service.');
          }
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [sessionId]);

  // Clean up timers and audio on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
      }
      if (revealAnimFrameRef.current) {
        safeCancelAnimationFrame(revealAnimFrameRef.current);
      }
      audioManager?.stop();
    };
  }, [audioManager]);

  // Compute status kind
  let statusKind: ChatStatusKind = 'idle';
  if (errorMessage) {
    statusKind = 'error';
  } else if (isLoading) {
    statusKind = 'thinking';
  } else if (activeDialogue?.isSpeaking) {
    statusKind = 'speaking';
  } else if (attentionController?.getState() === 'LISTENING') {
    statusKind = 'listening';
  }

  // Clear auto-dismiss timer helper
  const clearAutoDismiss = useCallback(() => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
  }, []);

  // Schedule auto-dismiss helper
  const scheduleAutoDismiss = useCallback(() => {
    clearAutoDismiss();
    const timer = setTimeout(() => {
      setActiveDialogue(null);
    }, autoDismissDelayMs);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    autoDismissTimerRef.current = timer;
  }, [autoDismissDelayMs, clearAutoDismiss]);

  const dismissDialogue = useCallback(() => {
    clearAutoDismiss();
    setActiveDialogue(null);
  }, [clearAutoDismiss]);

  // Progressive text reveal loop synced with speech articulation
  const startProgressiveReveal = useCallback(
    (dialogueId: string, fullText: string) => {
      clearAutoDismiss();
      if (revealAnimFrameRef.current) {
        safeCancelAnimationFrame(revealAnimFrameRef.current);
      }

      const totalChars = fullText.length;
      if (totalChars === 0) {
        setActiveDialogue((prev) =>
          prev && prev.id === dialogueId ? { ...prev, displayedText: '', isSpeaking: false, progress: 1.0 } : prev,
        );
        scheduleAutoDismiss();
        return;
      }

      const mouth = speechMouthController;
      const startTime = performance.now();
      const estimatedDuration = mouth?.duration && mouth.duration > 0 ? mouth.duration : Math.max(1.5, totalChars * 0.05);

      const tick = () => {
        const now = performance.now();
        const elapsed = (now - startTime) / 1000;

        let mouthProgress = 0;
        let isStillSpeaking = false;

        if (mouth && mouth.active && mouth.duration > 0) {
          mouthProgress = Math.max(mouth.progress, Math.min(1.0, elapsed / mouth.duration));
          isStillSpeaking = mouth.active && mouthProgress < 1.0 && elapsed < (mouth.duration + 0.5);
        } else {
          mouthProgress = Math.min(1.0, elapsed / estimatedDuration);
          isStillSpeaking = mouthProgress < 1.0;
        }

        const charCount = Math.min(totalChars, Math.max(1, Math.floor(mouthProgress * totalChars)));
        const slice = fullText.slice(0, charCount);

        setActiveDialogue((prev) => {
          if (!prev || prev.id !== dialogueId) return prev;
          return {
            ...prev,
            displayedText: slice,
            progress: mouthProgress,
            isSpeaking: isStillSpeaking,
          };
        });

        if (isStillSpeaking && mouthProgress < 1.0) {
          revealAnimFrameRef.current = safeRequestAnimationFrame(tick);
        } else {
          setActiveDialogue((prev) => {
            if (!prev || prev.id !== dialogueId) return prev;
            return {
              ...prev,
              displayedText: fullText,
              progress: 1.0,
              isSpeaking: false,
              completedAt: Date.now(),
            };
          });
          scheduleAutoDismiss();
        }
      };

      revealAnimFrameRef.current = safeRequestAnimationFrame(tick);
    },
    [clearAutoDismiss, scheduleAutoDismiss, speechMouthController],
  );

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || isLoadingRef.current) {
        return false;
      }

      // Stop any active audio playback immediately when the user speaks / sends
      audioManager?.stop();
      const currentSeq = ++responseSeqRef.current;

      isLoadingRef.current = true;
      setIsLoading(true);
      setErrorMessage(null);
      clearAutoDismiss();

      // Ensure we have a valid session ID
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        try {
          currentSessionId = await createSession();
          setSessionId(currentSessionId);
        } catch (err) {
          isLoadingRef.current = false;
          setIsLoading(false);
          const msg = err instanceof Error ? err.message : 'Failed to establish conversation session.';
          setErrorMessage(msg);
          return false;
        }
      }

      lastUserMessageRef.current = trimmed;

      // 1. Append user message optimistically
      const userMessage: ChatMessage = {
        id: crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}-${Math.random()}`,
        sender: 'user',
        text: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // 2. Avatar reaction: onUserMessageSubmitted() -> enters LISTENING
      reactionDispatcher?.onUserMessageSubmitted();
      reactionDispatcher?.onWaitingForResponse();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response: CompanionResponsePayload = await sendChatMessage(
          currentSessionId,
          trimmed,
          controller.signal,
          voiceEnabled,
        );

        // Discard stale responses if newer message was sent or interaction was cancelled
        if (responseSeqRef.current !== currentSeq) {
          return false;
        }

        isLoadingRef.current = false;
        setIsLoading(false);
        abortControllerRef.current = null;

        // 3. Append companion message to history
        const companionMessage: ChatMessage = {
          id: crypto.randomUUID ? crypto.randomUUID() : `comp-${Date.now()}-${Math.random()}`,
          sender: 'companion',
          text: response.response_text,
          timestamp: Date.now(),
          emotion: response.emotion,
          gesture: response.gesture,
          speechIntent: response.speech_intent,
          audioData: response.audio_data,
          audioMimeType: response.audio_mime_type,
          audioDuration: response.audio_duration,
        };
        setMessages((prev) => [...prev, companionMessage]);

        // 4. Dispatch reaction to avatar controllers (emotion, gesture, SPEAKING state)
        // If voice is enabled and audio payload is present, defer mouth articulation until audio playback is scheduled
        const hasPlayableAudio = Boolean(voiceEnabled && response.audio_data && audioManager);

        reactionDispatcher?.dispatchReaction(response, {
          deferSpeechMouth: hasPlayableAudio,
        });

        // 5. Initialize dialogue display
        const dialogueId = companionMessage.id;
        setActiveDialogue({
          id: dialogueId,
          fullText: response.response_text,
          displayedText: '',
          emotion: response.emotion,
          gesture: response.gesture,
          speechIntent: response.speech_intent,
          isSpeaking: true,
          progress: 0,
          audioData: response.audio_data,
          audioMimeType: response.audio_mime_type,
          audioDuration: response.audio_duration,
        });

        // 6. Schedule audio playback and activate audio-clock-driven articulation
        if (hasPlayableAudio && audioManager) {
          const started = await audioManager.play(response.audio_data!, { id: dialogueId });

          // Reject if interaction was cancelled or superseded while decoding
          if (responseSeqRef.current !== currentSeq) {
            audioManager.stop();
            speechMouthController?.stopSpeech();
            return false;
          }

          if (started) {
            // Audio playback is now officially scheduled on the audio clock
            speechMouthController?.startSpeech(response.response_text, {
              profile: (response.mouth_animation_profile as MouthAnimationProfileName) ?? 'soft_conversation',
              speechIntent: (response.speech_intent as SpeechIntentName) ?? 'conversational',
              intensity: 1.0,
              audioDuration: response.audio_duration ?? audioManager.getDuration(),
              audioId: dialogueId,
              syncProvider: audioManager,
              onComplete: () => {
                reactionDispatcher?.handleSpeechComplete();
              },
            });
          } else {
            // Fallback immediately to text-driven speech if playback fails to schedule
            speechMouthController?.startSpeech(response.response_text, {
              profile: (response.mouth_animation_profile as MouthAnimationProfileName) ?? 'soft_conversation',
              speechIntent: (response.speech_intent as SpeechIntentName) ?? 'conversational',
              intensity: 1.0,
              onComplete: () => {
                reactionDispatcher?.handleSpeechComplete();
              },
            });
          }
        }

        startProgressiveReveal(dialogueId, response.response_text);

        return true;
      } catch (err: unknown) {
        if (responseSeqRef.current !== currentSeq) {
          return false;
        }

        isLoadingRef.current = false;
        setIsLoading(false);
        abortControllerRef.current = null;

        if (err instanceof DOMException && err.name === 'AbortError') {
          reactionDispatcher?.cancel();
          return false;
        }

        const msg = err instanceof Error ? err.message : 'Error communicating with companion.';
        setErrorMessage(msg);

        // Cancel avatar reaction safely and restore attentive state
        reactionDispatcher?.cancel();

        // Append error notice in chat history
        const errorMessageItem: ChatMessage = {
          id: crypto.randomUUID ? crypto.randomUUID() : `err-${Date.now()}-${Math.random()}`,
          sender: 'companion',
          text: `[Error: ${msg}]`,
          timestamp: Date.now(),
          isError: true,
        };
        setMessages((prev) => [...prev, errorMessageItem]);
        return false;
      }
    },
    [
      audioManager,
      clearAutoDismiss,
      reactionDispatcher,
      sessionId,
      speechMouthController,
      startProgressiveReveal,
      voiceEnabled,
    ],
  );

  const retryLastMessage = useCallback(async (): Promise<boolean> => {
    if (lastUserMessageRef.current) {
      return sendMessage(lastUserMessageRef.current);
    }
    return false;
  }, [sendMessage]);

  const cancelResponse = useCallback(() => {
    responseSeqRef.current++;
    audioManager?.stop();
    speechMouthController?.stopSpeech();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    clearAutoDismiss();
    reactionDispatcher?.cancel();
    if (activeDialogue) {
      setActiveDialogue((prev) => (prev ? { ...prev, isSpeaking: false, progress: 1.0 } : null));
      scheduleAutoDismiss();
    }
  }, [activeDialogue, audioManager, clearAutoDismiss, reactionDispatcher, scheduleAutoDismiss, speechMouthController]);

  const replayAudio = useCallback(
    async (dialogueId?: string): Promise<boolean> => {
      if (!voiceEnabled || !audioManager) {
        return false;
      }

      let payload: string | null = null;
      let targetId = dialogueId;
      let messageText = '';
      let audioDuration: number | null = null;
      let speechIntent: string | undefined;

      if (dialogueId) {
        const found = messages.find((m) => m.id === dialogueId);
        payload = found?.audioData ?? null;
        messageText = found?.text ?? '';
        audioDuration = found?.audioDuration ?? null;
        speechIntent = found?.speechIntent;
      } else if (activeDialogue?.audioData) {
        payload = activeDialogue.audioData;
        targetId = activeDialogue.id;
        messageText = activeDialogue.fullText;
        audioDuration = activeDialogue.audioDuration ?? null;
        speechIntent = activeDialogue.speechIntent;
      }

      if (!payload) {
        return false;
      }

      // 1. Immediately stop any active audio and speech articulation
      audioManager.stop();
      speechMouthController?.stopSpeech();

      // 2. Schedule replay on audio manager
      const success = await audioManager.play(payload, { id: targetId });
      if (!success) {
        return false;
      }

      // 3. Restart phonetic timeline synchronized with replayed audio clock
      // Dedicated replay path: does NOT redispatch gestures, emotions, attention transitions, or head accents
      if (speechMouthController && messageText) {
        speechMouthController.startSpeech(messageText, {
          profile: 'soft_conversation',
          speechIntent: (speechIntent as SpeechIntentName) ?? 'conversational',
          intensity: 1.0,
          audioDuration: audioDuration ?? audioManager.getDuration(),
          audioId: targetId,
          syncProvider: audioManager,
        });
      }

      return true;
    },
    [activeDialogue, audioManager, messages, speechMouthController, voiceEnabled],
  );

  const clearHistory = useCallback(() => {
    audioManager?.stop();
    setMessages([]);
    setErrorMessage(null);
    dismissDialogue();
  }, [audioManager, dismissDialogue]);

  const startNewSession = useCallback(async () => {
    cancelResponse();
    clearAutoDismiss();
    audioManager?.stop();

    const oldSessionId = sessionId;
    if (oldSessionId) {
      // Best-effort delete old session on server
      deleteSession(oldSessionId).catch(() => {});
    }

    setMessages([]);
    setErrorMessage(null);
    setActiveDialogue(null);

    try {
      const newId = await createSession();
      setSessionId(newId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to create a new session.');
    }
  }, [audioManager, cancelResponse, clearAutoDismiss, sessionId]);

  const openHistory = useCallback(() => setIsHistoryOpen(true), []);
  const closeHistory = useCallback(() => setIsHistoryOpen(false), []);
  const toggleHistory = useCallback(() => setIsHistoryOpen((prev) => !prev), []);

  return {
    sessionId,
    messages,
    isLoading,
    statusKind,
    errorMessage,
    activeDialogue,
    isHistoryOpen,
    sendMessage,
    replayAudio,
    cancelResponse,
    clearHistory,
    startNewSession,
    retryLastMessage,
    dismissDialogue,
    openHistory,
    closeHistory,
    toggleHistory,
  };
}
