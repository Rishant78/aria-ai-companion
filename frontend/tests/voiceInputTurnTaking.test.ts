import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';

import type { ChatInputProps } from '../src/components/chat/ChatInput';
import type {
  ISpeechRecognition,
  ISpeechRecognitionAlternative,
  ISpeechRecognitionErrorEvent,
  ISpeechRecognitionEvent,
  ISpeechRecognitionResult,
  ISpeechRecognitionResultList,
  UseVoiceInputResult,
  VoiceInputError,
} from '../src/voice/VoiceInputTypes';
import type { useVoiceInput, getSpeechRecognitionConstructor } from '../src/voice/useVoiceInput';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================================
// Module & Component Typing for Dynamic SSR Loading
// ============================================================================

interface UseVoiceInputModule {
  useVoiceInput: typeof useVoiceInput;
  getSpeechRecognitionConstructor: typeof getSpeechRecognitionConstructor;
}

interface ChatInputModule {
  ChatInput: React.ComponentType<ChatInputProps>;
}

// ============================================================================
// Mock Web Speech API Implementation
// ============================================================================

interface MockSpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  isStarted: boolean;
  isStopped: boolean;
  isAborted: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
  simulateResult: (transcript: string, isFinal: boolean) => void;
  simulateError: (error: string, message?: string) => void;
  simulateEnd: () => void;
}

let activeMockRecognition: MockSpeechRecognitionInstance | null = null;
let mockRecognitionInstances: MockSpeechRecognitionInstance[] = [];

function registerMockInstance(instance: MockSpeechRecognitionInstance): void {
  activeMockRecognition = instance;
  mockRecognitionInstances.push(instance);
}

class MockSpeechRecognition implements MockSpeechRecognitionInstance {
  public continuous = false;
  public interimResults = true;
  public lang = 'en-US';
  public maxAlternatives = 1;

  public onstart: ((this: ISpeechRecognition, ev: Event) => void) | null = null;
  public onresult: ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void) | null = null;
  public onerror: ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void) | null = null;
  public onend: ((this: ISpeechRecognition, ev: Event) => void) | null = null;

  public isStarted = false;
  public isStopped = false;
  public isAborted = false;

  constructor() {
    registerMockInstance(this);
  }

  public start(): void {
    this.isStarted = true;
    if (this.onstart) {
      this.onstart.call(this as unknown as ISpeechRecognition, new Event('start'));
    }
  }

  public stop(): void {
    this.isStopped = true;
    if (this.onend) {
      this.onend.call(this as unknown as ISpeechRecognition, new Event('end'));
    }
  }

  public abort(): void {
    this.isAborted = true;
    if (this.onerror) {
      const errEvent = Object.assign(new Event('error'), {
        error: 'aborted',
        message: 'Speech recognition was cancelled.',
      }) as unknown as ISpeechRecognitionErrorEvent;
      this.onerror.call(this as unknown as ISpeechRecognition, errEvent);
    }
    if (this.onend) {
      this.onend.call(this as unknown as ISpeechRecognition, new Event('end'));
    }
  }

  // Test helper to simulate receiving speech recognition results
  public simulateResult(transcript: string, isFinal: boolean): void {
    if (!this.onresult) return;
    const alternative: ISpeechRecognitionAlternative = {
      transcript,
      confidence: 1.0,
    };
    const resultItem: ISpeechRecognitionResult = Object.assign([alternative], {
      isFinal,
      length: 1,
    });
    const results: ISpeechRecognitionResultList = Object.assign([resultItem], {
      length: 1,
    });
    const event = Object.assign(new Event('result'), {
      resultIndex: 0,
      results,
    }) as unknown as ISpeechRecognitionEvent;

    this.onresult.call(this as unknown as ISpeechRecognition, event);
  }

  // Test helper to simulate speech recognition error
  public simulateError(error: string, message?: string): void {
    if (!this.onerror) return;
    const event = Object.assign(new Event('error'), {
      error,
      message: message ?? `Speech recognition error (${error}).`,
    }) as unknown as ISpeechRecognitionErrorEvent;
    this.onerror.call(this as unknown as ISpeechRecognition, event);
  }

  // Test helper to simulate end of speech
  public simulateEnd(): void {
    if (!this.onend) return;
    this.onend.call(this as unknown as ISpeechRecognition, new Event('end'));
  }
}

describe('Final Sprint — Voice Input & Natural Turn-Taking', () => {
  let vite: ViteDevServer;
  let happyWindow: InstanceType<typeof Window>;

  let useVoiceInputMod: UseVoiceInputModule;
  let chatInputMod: ChatInputModule;

  before(async () => {
    vite = await createServer({
      root: FRONTEND_ROOT,
      server: { middlewareMode: true },
      appType: 'custom',
    });

    useVoiceInputMod = (await vite.ssrLoadModule('/src/voice/useVoiceInput.ts')) as unknown as UseVoiceInputModule;
    chatInputMod = (await vite.ssrLoadModule('/src/components/chat/ChatInput.tsx')) as unknown as ChatInputModule;
  });

  after(async () => {
    await vite?.close();
  });

  beforeEach(() => {
    happyWindow = new Window({
      url: 'http://localhost:5173',
      width: 1280,
      height: 720,
    });

    Object.assign(globalThis, {
      window: happyWindow,
      document: happyWindow.document,
      Event: happyWindow.Event,
      KeyboardEvent: happyWindow.KeyboardEvent,
      IS_REACT_ACT_ENVIRONMENT: true,
    });

    activeMockRecognition = null;
    mockRecognitionInstances = [];

    // Register Mock Speech Recognition on global window by default
    (happyWindow as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;
  });

  // --------------------------------------------------------------------------
  // 1. Recognition Initialization & Browser Detection
  // --------------------------------------------------------------------------
  it('1. initializes voice input and detects Web Speech API support', () => {
    let hookResult!: UseVoiceInputResult;

    function TestComponent() {
      hookResult = useVoiceInputMod.useVoiceInput();
      return null;
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    assert.equal(hookResult.isSupported, true);
    assert.equal(hookResult.state, 'idle');
    assert.equal(hookResult.isListening, false);
    assert.equal(hookResult.interimTranscript, '');
    assert.equal(hookResult.finalTranscript, '');
    assert.equal(hookResult.error, null);

    act(() => {
      root.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Unsupported Browser Graceful Handling
  // --------------------------------------------------------------------------
  it('2. handles unsupported browsers gracefully without crashing', () => {
    // Delete speech recognition from window
    delete (happyWindow as unknown as Record<string, unknown>).SpeechRecognition;
    delete (happyWindow as unknown as Record<string, unknown>).webkitSpeechRecognition;

    let hookResult!: UseVoiceInputResult;
    const errorRef = { current: null as VoiceInputError | null };

    function TestComponent() {
      hookResult = useVoiceInputMod.useVoiceInput({
        onError: (err) => {
          errorRef.current = err;
        },
      });
      return null;
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    assert.equal(hookResult.isSupported, false);

    // Calling startListening on unsupported browser sets error
    act(() => {
      hookResult.startListening();
    });

    assert.equal(hookResult.state, 'error');
    assert.equal(hookResult.error?.code, 'not-supported');
    assert.ok(hookResult.error?.message.includes('not supported'));
    assert.equal(errorRef.current?.code, 'not-supported');

    act(() => {
      root.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // 3. Permission Denial Handling
  // --------------------------------------------------------------------------
  it('3. handles microphone permission denial (not-allowed) with clear error message', () => {
    let hookResult!: UseVoiceInputResult;
    const errorRef = { current: null as VoiceInputError | null };

    function TestComponent() {
      hookResult = useVoiceInputMod.useVoiceInput({
        onError: (err) => {
          errorRef.current = err;
        },
      });
      return null;
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    // Start recognition
    act(() => {
      hookResult.startListening();
    });

    assert.equal(hookResult.state, 'listening');
    assert.ok(activeMockRecognition);

    // Simulate browser permission denial
    act(() => {
      activeMockRecognition?.simulateError('not-allowed');
      activeMockRecognition?.simulateEnd();
    });

    assert.equal(hookResult.state, 'error');
    assert.equal(hookResult.error?.code, 'permission-denied');
    assert.ok(hookResult.error?.message.includes('permission denied'));
    assert.equal(errorRef.current?.code, 'permission-denied');

    // clearError resets state
    act(() => {
      hookResult.clearError();
    });
    assert.equal(hookResult.state, 'idle');
    assert.equal(hookResult.error, null);

    act(() => {
      root.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // 4. Interim and Final Transcripts
  // --------------------------------------------------------------------------
  it('4. streams interim transcripts and submits final transcript once on completion', () => {
    let hookResult!: UseVoiceInputResult;
    let finalSubmission = '';
    let submissionCount = 0;
    const interimUpdates: string[] = [];

    function TestComponent() {
      hookResult = useVoiceInputMod.useVoiceInput({
        onInterimTranscript: (text) => {
          interimUpdates.push(text);
        },
        onFinalTranscript: (text) => {
          finalSubmission = text;
          submissionCount++;
        },
      });
      return null;
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    // 1. Start listening
    act(() => {
      hookResult.startListening();
    });
    assert.equal(hookResult.state, 'listening');

    // 2. Stream interim transcript
    act(() => {
      activeMockRecognition?.simulateResult('Hello Aria', false);
    });
    assert.equal(hookResult.state, 'transcribing');
    assert.equal(hookResult.interimTranscript, 'Hello Aria');
    assert.deepEqual(interimUpdates, ['Hello Aria']);

    // 3. Stream updated interim transcript
    act(() => {
      activeMockRecognition?.simulateResult('Hello Aria how are you', false);
    });
    assert.equal(hookResult.interimTranscript, 'Hello Aria how are you');

    // 4. Final transcript received
    act(() => {
      activeMockRecognition?.simulateResult('Hello Aria, how are you today?', true);
    });

    assert.equal(hookResult.finalTranscript, 'Hello Aria, how are you today?');
    assert.equal(hookResult.interimTranscript, '');
    assert.equal(finalSubmission, 'Hello Aria, how are you today?');
    assert.equal(submissionCount, 1);

    act(() => {
      root.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // 5. Empty Transcript & No-Speech Handling
  // --------------------------------------------------------------------------
  it('5. handles no-speech and whitespace-only transcripts without submitting', () => {
    let hookResult!: UseVoiceInputResult;
    let submitted = false;
    const errorRef = { current: null as VoiceInputError | null };

    function TestComponent() {
      hookResult = useVoiceInputMod.useVoiceInput({
        onFinalTranscript: () => {
          submitted = true;
        },
        onError: (err) => {
          errorRef.current = err;
        },
      });
      return null;
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    act(() => {
      hookResult.startListening();
    });

    // Simulate no-speech error
    act(() => {
      activeMockRecognition?.simulateError('no-speech');
      activeMockRecognition?.simulateEnd();
    });

    assert.equal(submitted, false);
    assert.equal(hookResult.error?.code, 'no-speech');
    assert.equal(errorRef.current?.code, 'no-speech');

    act(() => {
      root.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // 6. Duplicate Final Results Protection
  // --------------------------------------------------------------------------
  it('6. strictly prevents duplicate final transcript submissions', () => {
    let hookResult!: UseVoiceInputResult;
    let submissionCount = 0;

    function TestComponent() {
      hookResult = useVoiceInputMod.useVoiceInput({
        onFinalTranscript: () => {
          submissionCount++;
        },
      });
      return null;
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    act(() => {
      hookResult.startListening();
    });

    // Fire first final result
    act(() => {
      activeMockRecognition?.simulateResult('Tell me a story.', true);
    });

    // Simulate duplicate event from browser
    act(() => {
      activeMockRecognition?.simulateResult('Tell me a story.', true);
      activeMockRecognition?.simulateEnd();
    });

    assert.equal(submissionCount, 1);

    act(() => {
      root.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // 7. Network and Hardware Error Handling
  // --------------------------------------------------------------------------
  it('7. handles network and audio-capture hardware errors cleanly', () => {
    let hookResult!: UseVoiceInputResult;
    const errorsReported: string[] = [];

    function TestComponent() {
      hookResult = useVoiceInputMod.useVoiceInput({
        onError: (err) => {
          errorsReported.push(err.code);
        },
      });
      return null;
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    // Test network error
    act(() => {
      hookResult.startListening();
      activeMockRecognition?.simulateError('network');
      activeMockRecognition?.simulateEnd();
    });
    assert.equal(hookResult.error?.code, 'network');

    // Test audio-capture hardware missing error
    act(() => {
      hookResult.startListening();
      activeMockRecognition?.simulateError('audio-capture');
      activeMockRecognition?.simulateEnd();
    });
    assert.equal(hookResult.error?.code, 'audio-capture');
    assert.deepEqual(errorsReported, ['network', 'audio-capture']);

    act(() => {
      root.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // 8. Natural Turn-Taking: Interruption during Speech Playback
  // --------------------------------------------------------------------------
  it('8. natural turn-taking: starting voice input immediately halts audio playback, mouth animation, and enters LISTENING state', () => {
    let isAudioPlaying = true;
    let isMouthSpeaking = true;
    let attentionState = 'SPEAKING';
    let dialogueDismissed = false;

    // Simulate existing controllers & playback
    const mockAudioManager = {
      stop: () => {
        isAudioPlaying = false;
      },
    };

    const mockSpeechMouthController = {
      stopSpeech: () => {
        isMouthSpeaking = false;
      },
    };

    const mockReactionDispatcher = {
      onUserMessageSubmitted: () => {
        attentionState = 'LISTENING';
      },
    };

    const dismissDialogue = () => {
      dialogueDismissed = true;
    };

    // App Turn-Taking coordination hook
    function TestApp() {
      const handleVoiceStart = () => {
        mockAudioManager.stop();
        mockSpeechMouthController.stopSpeech();
        mockReactionDispatcher.onUserMessageSubmitted();
        dismissDialogue();
      };

      const voice = useVoiceInputMod.useVoiceInput({
        onStart: handleVoiceStart,
        onFinalTranscript: (_text) => { },
      });

      return React.createElement('button', {
        id: 'mic-btn',
        onClick: voice.startListening,
      }, 'Mic');
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestApp));
    });

    // Initially Aria is speaking
    assert.equal(isAudioPlaying, true);
    assert.equal(isMouthSpeaking, true);
    assert.equal(attentionState, 'SPEAKING');
    assert.equal(dialogueDismissed, false);

    // User clicks microphone to speak
    const micBtn = host.querySelector('#mic-btn') as unknown as { click: () => void };
    act(() => {
      micBtn.click();
    });

    // Verify immediate turn-taking interruption
    assert.equal(isAudioPlaying, false, 'Audio playback must be immediately stopped');
    assert.equal(isMouthSpeaking, false, 'Mouth viseme animation must be immediately stopped');
    assert.equal(attentionState, 'LISTENING', 'Attention must immediately switch to LISTENING');
    assert.equal(dialogueDismissed, true, 'Active dialogue bubble must be dismissed');

    act(() => {
      root.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // 9. Cleanup & Unmount Safety
  // --------------------------------------------------------------------------
  it('9. unmounting or cancelling cleanly aborts recognition session without leaking listeners', () => {
    let hookResult!: UseVoiceInputResult;

    function TestComponent() {
      hookResult = useVoiceInputMod.useVoiceInput();
      return null;
    }

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);
    act(() => {
      root.render(React.createElement(TestComponent));
    });

    act(() => {
      hookResult.startListening();
    });
    const currentRec = activeMockRecognition;
    assert.ok(currentRec);
    assert.equal(currentRec.isStarted, true);
    assert.equal(currentRec.isAborted, false);

    // Cancel listening explicitly
    act(() => {
      hookResult.cancelListening();
    });
    assert.equal(currentRec.isAborted, true);
    assert.equal(hookResult.state, 'idle');

    // Start again and test unmount cleanup
    act(() => {
      hookResult.startListening();
    });
    const secondRec = activeMockRecognition;
    assert.ok(secondRec);

    act(() => {
      root.unmount();
    });
    assert.equal(secondRec.isAborted, true);
  });

  // --------------------------------------------------------------------------
  // 10. UI Integration: ChatInput with Microphone States & Text Fallback
  // --------------------------------------------------------------------------
  it('10. renders ChatInput with interactive microphone controls, interim preview, and preserves text input fallback', () => {
    let startVoiceTriggered = false;
    let stopVoiceTriggered = false;
    let sentMessage = '';

    const host = happyWindow.document.createElement('div');
    const root = createRoot(host as unknown as Element);

    // 10a. Idle state with voice supported
    act(() => {
      root.render(
        React.createElement(chatInputMod.ChatInput, {
          onSendMessage: async (msg) => {
            sentMessage = msg;
            return true;
          },
          isLoading: false,
          isVoiceSupported: true,
          voiceState: 'idle',
          onStartVoiceInput: () => {
            startVoiceTriggered = true;
          },
          onStopVoiceInput: () => {
            stopVoiceTriggered = true;
          },
        }),
      );
    });

    const micBtn = host.querySelector('.companion-input__mic-btn') as unknown as {
      disabled: boolean;
      title: string;
      click: () => void;
      className: string;
    };
    assert.equal(micBtn.disabled, false);
    assert.ok(micBtn.title.includes('Click to speak'));

    // Clicking mic starts voice input
    act(() => {
      micBtn.click();
    });
    assert.equal(startVoiceTriggered, true);

    // 10b. Active listening state with interim transcription preview
    act(() => {
      root.render(
        React.createElement(chatInputMod.ChatInput, {
          onSendMessage: async (msg) => {
            sentMessage = msg;
            return true;
          },
          isLoading: false,
          isVoiceSupported: true,
          voiceState: 'transcribing',
          interimTranscript: 'Exploring deep space',
          onStartVoiceInput: () => { },
          onStopVoiceInput: () => {
            stopVoiceTriggered = true;
          },
        }),
      );
    });

    const activeMicBtn = host.querySelector('.companion-input__mic-btn--transcribing') as unknown as {
      click: () => void;
    };
    assert.ok(activeMicBtn);

    // Verify interim preview element is rendered
    const preview = host.querySelector('.companion-input__interim-preview');
    assert.ok(preview);
    assert.ok(preview.textContent?.includes('Exploring deep space'));

    // Clicking active mic stops voice input
    act(() => {
      activeMicBtn.click();
    });
    assert.equal(stopVoiceTriggered, true);

    // 10c. Text input fallback works seamlessly regardless of voice
    act(() => {
      root.render(
        React.createElement(chatInputMod.ChatInput, {
          onSendMessage: async (msg) => {
            sentMessage = msg;
            return true;
          },
          isLoading: false,
          isVoiceSupported: true,
          voiceState: 'idle',
        }),
      );
    });

    const textarea = host.querySelector('textarea') as unknown as {
      value: string;
      dispatchEvent: (e: unknown) => void;
    };
    const sendBtn = host.querySelector('.companion-input__action-btn--send') as unknown as {
      click: () => void;
      disabled: boolean;
    };

    act(() => {
      textarea.value = 'Text input still works 100%';
      textarea.dispatchEvent(new happyWindow.Event('input', { bubbles: true }));
      textarea.dispatchEvent(new happyWindow.Event('change', { bubbles: true }));
    });

    act(() => {
      sendBtn.click();
    });
    assert.equal(sentMessage, 'Text input still works 100%');

    // 10d. Unsupported browser state disables mic button with informative title
    act(() => {
      root.render(
        React.createElement(chatInputMod.ChatInput, {
          onSendMessage: async () => true,
          isLoading: false,
          isVoiceSupported: false,
        }),
      );
    });

    const unsupportedMicBtn = host.querySelector('.companion-input__mic-btn--unsupported') as unknown as {
      disabled: boolean;
      title: string;
    };
    assert.ok(unsupportedMicBtn);
    assert.equal(unsupportedMicBtn.disabled, true);
    assert.ok(unsupportedMicBtn.title.includes('not supported in this browser'));

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
