import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import type { VoiceInputState } from '../../voice/VoiceInputTypes';

export interface ChatInputProps {
  onSendMessage: (text: string) => Promise<boolean>;
  isLoading: boolean;
  onCancelResponse?: () => void;
  placeholder?: string;
  disabled?: boolean;
  // Voice Input Integration
  voiceState?: VoiceInputState;
  isVoiceSupported?: boolean;
  interimTranscript?: string;
  voiceErrorMessage?: string | null;
  onStartVoiceInput?: () => void;
  onStopVoiceInput?: () => void;
}

export function ChatInput({
  onSendMessage,
  isLoading,
  onCancelResponse,
  placeholder = 'Message Aria… (Enter to send, Shift+Enter for newline)',
  disabled = false,
  voiceState = 'idle',
  isVoiceSupported = true,
  interimTranscript = '',
  voiceErrorMessage = null,
  onStartVoiceInput,
  onStopVoiceInput,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea according to text height (up to max 120px)
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, 120);
    el.style.height = `${Math.max(44, nextHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [text, adjustHeight]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement> | FormEvent<HTMLTextAreaElement>) => {
    setText((e.target as HTMLTextAreaElement).value);
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading || disabled) return;

    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
    const sent = await onSendMessage(trimmed);
    if (!sent) {
      // Restore text if send failed
      setText(trimmed);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isListening = voiceState === 'listening' || voiceState === 'transcribing';
  const isSendDisabled = disabled || isLoading || isListening || !text.trim();

  const handleMicClick = () => {
    if (!isVoiceSupported || disabled || isLoading) return;
    if (isListening) {
      onStopVoiceInput?.();
    } else {
      onStartVoiceInput?.();
    }
  };

  // Determine microphone button tooltip & aria label
  let micAriaLabel = 'Start voice input';
  let micTitle = 'Voice input (Click to speak)';
  let micClass = 'companion-input__mic-btn';

  if (!isVoiceSupported) {
    micAriaLabel = 'Voice input not supported in this browser';
    micTitle = 'Voice input is not supported in this browser. Please use text input.';
    micClass += ' companion-input__mic-btn--unsupported';
  } else if (voiceState === 'listening') {
    micAriaLabel = 'Listening to your voice. Click to finish.';
    micTitle = 'Listening… (Click to finish speaking)';
    micClass += ' companion-input__mic-btn--listening';
  } else if (voiceState === 'transcribing') {
    micAriaLabel = 'Transcribing your voice. Click to finish.';
    micTitle = 'Transcribing… (Click to finish speaking)';
    micClass += ' companion-input__mic-btn--transcribing';
  } else if (voiceState === 'processing') {
    micAriaLabel = 'Processing speech transcript';
    micTitle = 'Processing speech…';
    micClass += ' companion-input__mic-btn--processing';
  } else if (voiceState === 'error') {
    micAriaLabel = voiceErrorMessage || 'Voice input error. Click to retry.';
    micTitle = voiceErrorMessage || 'Voice input error. Click to retry.';
    micClass += ' companion-input__mic-btn--error';
  }

  const effectivePlaceholder = isListening
    ? 'Listening to you speak… (Click mic to finish)'
    : placeholder;

  return (
    <div className="companion-input-dock" role="region" aria-label="Chat input">
      {/* Live Interim Transcription Pill */}
      {interimTranscript && (
        <div className="companion-input__interim-preview" role="status" aria-live="polite">
          <span className="companion-input__interim-pulse" aria-hidden="true" />
          <span className="companion-input__interim-label">Hearing:</span>
          <span className="companion-input__interim-text">"{interimTranscript}"</span>
        </div>
      )}

      {/* Ephemeral voice input error warning */}
      {voiceState === 'error' && voiceErrorMessage && (
        <div className="companion-input__voice-notice" role="alert">
          <span className="companion-input__voice-notice-icon">⚠️</span>
          <span className="companion-input__voice-notice-text">{voiceErrorMessage}</span>
        </div>
      )}

      <div className={`companion-input-container ${isListening ? 'companion-input-container--listening' : ''}`}>
        {/* Interactive Microphone Button */}
        <button
          type="button"
          className={micClass}
          onClick={handleMicClick}
          disabled={!isVoiceSupported || disabled || isLoading || voiceState === 'processing'}
          aria-label={micAriaLabel}
          title={micTitle}
        >
          {isListening ? (
            <span className="companion-input__mic-active-waves" aria-hidden="true">
              <span className="companion-input__mic-wave companion-input__mic-wave--1" />
              <span className="companion-input__mic-wave companion-input__mic-wave--2" />
              <span className="companion-input__mic-wave companion-input__mic-wave--3" />
            </span>
          ) : (
            <svg className="companion-input__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>

        {/* Text Input Area */}
        <textarea
          ref={textareaRef}
          className="companion-input__textarea"
          value={text}
          onChange={handleChange}
          onInput={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={effectivePlaceholder}
          disabled={disabled || isListening}
          rows={1}
          aria-label="Chat message to companion"
        />

        {/* Action Button: Send or Cancel/Stop */}
        {isLoading && onCancelResponse ? (
          <button
            type="button"
            className="companion-input__action-btn companion-input__action-btn--stop"
            onClick={onCancelResponse}
            aria-label="Cancel responding"
            title="Stop generating response"
          >
            <svg className="companion-input__icon" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="companion-input__action-btn companion-input__action-btn--send"
            onClick={handleSend}
            disabled={isSendDisabled}
            aria-label="Send message"
            title="Send message (Enter)"
          >
            <svg className="companion-input__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
