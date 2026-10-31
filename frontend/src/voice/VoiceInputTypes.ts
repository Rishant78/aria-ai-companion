/**
 * ==============================================================================
 * VoiceInputTypes — Type Definitions for Browser Web Speech Recognition
 * Aria Voice Interaction & Natural Turn-Taking
 * ==============================================================================
 */

export type VoiceInputState = 'idle' | 'listening' | 'transcribing' | 'processing' | 'error';

export type VoiceInputErrorCode =
  | 'not-supported'
  | 'permission-denied'
  | 'no-speech'
  | 'network'
  | 'aborted'
  | 'audio-capture'
  | 'unknown';

export interface VoiceInputError {
  code: VoiceInputErrorCode;
  message: string;
}

export interface UseVoiceInputOptions {
  /** Called when a non-empty final transcript has been recognized and is ready for submission */
  onFinalTranscript?: (text: string) => void | Promise<void>;
  /** Called whenever interim (in-progress) transcript updates are available */
  onInterimTranscript?: (text: string) => void;
  /** Called immediately when recognition starts (used for turn-taking interruption) */
  onStart?: () => void;
  /** Called when recognition ends */
  onEnd?: () => void;
  /** Called when recognition encounters an error */
  onError?: (error: VoiceInputError) => void;
  /** Language tag for recognition, default 'en-US' */
  lang?: string;
  /** Whether recognition should be continuous, default false (single utterance) */
  continuous?: boolean;
}

export interface UseVoiceInputResult {
  /** Whether the browser supports the Web Speech API */
  isSupported: boolean;
  /** Current state of voice recognition */
  state: VoiceInputState;
  /** Convenience flag: true when listening or transcribing */
  isListening: boolean;
  /** Current interim transcript in progress */
  interimTranscript: string;
  /** Last finalized transcript */
  finalTranscript: string;
  /** Current voice error if any */
  error: VoiceInputError | null;
  /** Start listening for user speech */
  startListening: () => void;
  /** Stop listening and finalize any recognized speech */
  stopListening: () => void;
  /** Cancel listening and discard any recognized speech without submitting */
  cancelListening: () => void;
  /** Clear any active error message */
  clearError: () => void;
}

export interface ISpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export interface ISpeechRecognitionResult {
  readonly length: number;
  [index: number]: ISpeechRecognitionAlternative;
  isFinal: boolean;
}

export interface ISpeechRecognitionResultList {
  readonly length: number;
  [index: number]: ISpeechRecognitionResult;
}

export interface ISpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: ISpeechRecognitionResultList;
}

export interface ISpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

export interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
}

export type ISpeechRecognitionConstructor = new () => ISpeechRecognition;

/**
 * Minimal Web Speech API typing for cross-browser support (SpeechRecognition / webkitSpeechRecognition)
 */
export interface IWindowWithSpeechRecognition {
  SpeechRecognition?: ISpeechRecognitionConstructor;
  webkitSpeechRecognition?: ISpeechRecognitionConstructor;
}
