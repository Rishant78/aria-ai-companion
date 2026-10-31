import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ISpeechRecognition,
  ISpeechRecognitionConstructor,
  ISpeechRecognitionErrorEvent,
  ISpeechRecognitionEvent,
  IWindowWithSpeechRecognition,
  UseVoiceInputOptions,
  UseVoiceInputResult,
  VoiceInputError,
  VoiceInputErrorCode,
  VoiceInputState,
} from './VoiceInputTypes';

/**
 * Returns the SpeechRecognition constructor if available in global scope.
 */
export function getSpeechRecognitionConstructor(): ISpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const win = window as unknown as IWindowWithSpeechRecognition;
  return win.SpeechRecognition || win.webkitSpeechRecognition;
}

export function useVoiceInput({
  onFinalTranscript,
  onInterimTranscript,
  onStart,
  onEnd,
  onError,
  lang = 'en-US',
  continuous = false,
}: UseVoiceInputOptions = {}): UseVoiceInputResult {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<VoiceInputError | null>(null);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const isExplicitAbortRef = useRef(false);
  const hasSubmittedFinalRef = useRef(false);
  const accumulatedFinalRef = useRef('');

  // Keep callback refs fresh without causing re-subscriptions
  const callbacksRef = useRef({
    onFinalTranscript,
    onInterimTranscript,
    onStart,
    onEnd,
    onError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onFinalTranscript,
      onInterimTranscript,
      onStart,
      onEnd,
      onError,
    };
  });

  const isSupported = typeof window !== 'undefined' && Boolean(getSpeechRecognitionConstructor());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        isExplicitAbortRef.current = true;
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore errors on unmount
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setState((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  const cancelListening = useCallback(() => {
    isExplicitAbortRef.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Safe ignore
      }
      recognitionRef.current = null;
    }
    setInterimTranscript('');
    accumulatedFinalRef.current = '';
    hasSubmittedFinalRef.current = false;
    setState('idle');
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Safe ignore if already stopping
      }
    }
  }, []);

  const startListening = useCallback(() => {
    clearError();
    const RecognitionClass = getSpeechRecognitionConstructor();

    if (!RecognitionClass) {
      const err: VoiceInputError = {
        code: 'not-supported',
        message: 'Speech recognition is not supported in this browser. Please use text input.',
      };
      setError(err);
      setState('error');
      callbacksRef.current.onError?.(err);
      return;
    }

    // If an existing recognition session is running, abort it cleanly first
    if (recognitionRef.current) {
      isExplicitAbortRef.current = true;
      try {
        recognitionRef.current.abort();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }

    isExplicitAbortRef.current = false;
    hasSubmittedFinalRef.current = false;
    accumulatedFinalRef.current = '';
    setInterimTranscript('');
    setFinalTranscript('');

    // Turn-taking hook: Notify parent to immediately interrupt active speech/audio
    callbacksRef.current.onStart?.();

    let recognition: ISpeechRecognition;
    try {
      recognition = new RecognitionClass();
    } catch (e) {
      const err: VoiceInputError = {
        code: 'unknown',
        message: e instanceof Error ? e.message : 'Failed to instantiate SpeechRecognition.',
      };
      setError(err);
      setState('error');
      callbacksRef.current.onError?.(err);
      return;
    }

    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setState('listening');
    };

    recognition.onresult = (event: ISpeechRecognitionEvent) => {
      let currentInterim = '';
      let newlyFinal = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i];
        const transcriptText = item[0]?.transcript || '';
        if (item.isFinal) {
          newlyFinal += transcriptText;
        } else {
          currentInterim += transcriptText;
        }
      }

      if (newlyFinal) {
        accumulatedFinalRef.current += (accumulatedFinalRef.current ? ' ' : '') + newlyFinal.trim();
        const totalFinal = accumulatedFinalRef.current.trim();
        setFinalTranscript(totalFinal);

        // Controlled single-utterance: submit immediately on final result
        if (totalFinal && !hasSubmittedFinalRef.current) {
          hasSubmittedFinalRef.current = true;
          setInterimTranscript('');
          setState('processing');

          const submitPromise = callbacksRef.current.onFinalTranscript?.(totalFinal);
          if (submitPromise && typeof submitPromise.then === 'function') {
            submitPromise.finally(() => {
              setState('idle');
            });
          } else {
            setState('idle');
          }
        }
      } else if (currentInterim) {
        setInterimTranscript(currentInterim);
        setState('transcribing');
        callbacksRef.current.onInterimTranscript?.(currentInterim);
      }
    };

    recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
      // If user intentionally aborted, silently reset to idle
      if (isExplicitAbortRef.current && (event.error === 'aborted' || !event.error)) {
        setState('idle');
        return;
      }

      let code: VoiceInputErrorCode = 'unknown';
      let message = 'Speech recognition error. Please try again.';

      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          code = 'permission-denied';
          message = 'Microphone permission denied. Please allow microphone access in your browser.';
          break;
        case 'no-speech':
          code = 'no-speech';
          message = 'No speech detected. Please click the microphone and speak again.';
          break;
        case 'network':
          code = 'network';
          message = 'Network error during speech recognition. Please check your connection.';
          break;
        case 'audio-capture':
          code = 'audio-capture';
          message = 'No microphone was found or microphone is already in use by another application.';
          break;
        case 'aborted':
          code = 'aborted';
          message = 'Speech recognition was cancelled.';
          break;
        default:
          message = `Speech recognition error (${event.error}).`;
          break;
      }

      const err: VoiceInputError = { code, message };
      setError(err);
      setState('error');
      callbacksRef.current.onError?.(err);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      callbacksRef.current.onEnd?.();

      // If we accumulated final text but haven't submitted yet (e.g. final result arrived right before end)
      const remainingFinal = accumulatedFinalRef.current.trim();
      if (remainingFinal && !hasSubmittedFinalRef.current && !isExplicitAbortRef.current) {
        hasSubmittedFinalRef.current = true;
        setInterimTranscript('');
        setState('processing');

        const submitPromise = callbacksRef.current.onFinalTranscript?.(remainingFinal);
        if (submitPromise && typeof submitPromise.then === 'function') {
          submitPromise.finally(() => {
            setState('idle');
          });
        } else {
          setState('idle');
        }
        return;
      }

      // If recognition ended without final text or errors, return cleanly to idle
      setState((prev) => (prev === 'listening' || prev === 'transcribing' ? 'idle' : prev));
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (e) {
      const err: VoiceInputError = {
        code: 'unknown',
        message: e instanceof Error ? e.message : 'Failed to start speech recognition.',
      };
      setError(err);
      setState('error');
      callbacksRef.current.onError?.(err);
      recognitionRef.current = null;
    }
  }, [clearError, continuous, lang]);

  return {
    isSupported,
    state,
    isListening: state === 'listening' || state === 'transcribing',
    interimTranscript,
    finalTranscript,
    error,
    startListening,
    stopListening,
    cancelListening,
    clearError,
  };
}
