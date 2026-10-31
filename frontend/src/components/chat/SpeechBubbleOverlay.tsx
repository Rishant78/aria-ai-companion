import { useEffect, useRef } from 'react';
import type { ActiveDialogueState } from '../../conversation/ConversationTypes';

export interface SpeechBubbleOverlayProps {
  dialogue: ActiveDialogueState | null;
  onDismiss: () => void;
  companionName?: string;
  onReplayAudio?: () => void;
  isAudioPlaying?: boolean;
  voiceEnabled?: boolean;
}

const EMOTION_EMOJIS: Record<string, string> = {
  happy: '✨ Happy',
  relaxed: '🌿 Relaxed',
  surprised: '💫 Surprised',
  shy: '🌸 Shy',
  curious: '🔍 Curious',
  sad: '🌧️ Sad',
  angry: '⚡ Annoyed',
  neutral: '💭 Thoughtful',
};

const GESTURE_LABELS: Record<string, string> = {
  wave: '👋 Wave',
  open_hand_greeting: '✨ Greeting',
  greeting: '✨ Greeting',
  explaining: '👐 Explaining',
  explain: '👐 Explaining',
  thinking: '🤔 Thinking',
  think: '🤔 Thinking',
  shrug: '🤷 Shrug',
  laughing: '😄 Laugh',
  laugh: '😄 Laugh',
  shy_hands_together: '🌸 Shy',
  shy: '🌸 Shy',
  reassuring: '🤝 Reassure',
  reassure: '🤝 Reassure',
};

export function SpeechBubbleOverlay({
  dialogue,
  onDismiss,
  companionName = 'Aria',
  onReplayAudio,
  isAudioPlaying = false,
  voiceEnabled = true,
}: SpeechBubbleOverlayProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll content if speech is long and progressively revealing
  useEffect(() => {
    if (contentRef.current && dialogue?.isSpeaking) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [dialogue?.displayedText, dialogue?.isSpeaking]);

  if (!dialogue || !dialogue.fullText) {
    return null;
  }

  const emotionTag = dialogue.emotion
    ? EMOTION_EMOJIS[dialogue.emotion.toLowerCase()] ?? `✨ ${dialogue.emotion}`
    : null;

  const gestureTag = dialogue.gesture
    ? GESTURE_LABELS[dialogue.gesture.toLowerCase()] ?? `✨ ${dialogue.gesture}`
    : null;

  return (
    <aside
      className="companion-dialogue-overlay"
      role="region"
      aria-label={`${companionName}'s response`}
      aria-live="polite"
    >
      <div className="companion-dialogue-card">
        {/* Dialogue Card Header */}
        <div className="companion-dialogue-card__header">
          <div className="companion-dialogue-card__meta">
            <span className="companion-dialogue-card__speaker">{companionName}</span>
            {emotionTag && (
              <span className="companion-dialogue-card__chip companion-dialogue-card__chip--emotion">
                {emotionTag}
              </span>
            )}
            {gestureTag && (
              <span className="companion-dialogue-card__chip companion-dialogue-card__chip--gesture">
                {gestureTag}
              </span>
            )}
          </div>

          <div className="companion-dialogue-card__actions">
            {/* Replay Audio Control — appears only when audioData exists */}
            {dialogue.audioData && onReplayAudio && (
              <button
                type="button"
                className={`companion-dialogue-card__action-btn companion-dialogue-card__action-btn--audio ${
                  isAudioPlaying ? 'companion-dialogue-card__action-btn--playing' : ''
                }`}
                onClick={onReplayAudio}
                disabled={!voiceEnabled}
                aria-label={
                  !voiceEnabled
                    ? 'Voice is muted. Enable voice to replay audio.'
                    : isAudioPlaying
                    ? 'Replaying audio…'
                    : 'Replay response audio'
                }
                title={
                  !voiceEnabled
                    ? 'Voice muted (Enable voice to replay)'
                    : isAudioPlaying
                    ? 'Replaying audio… (Click to replay)'
                    : 'Replay audio'
                }
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                </svg>
              </button>
            )}

            <button
              type="button"
              className="companion-dialogue-card__dismiss-btn"
              onClick={onDismiss}
              aria-label="Dismiss dialogue"
              title="Dismiss"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Progressive Dialogue Text Content */}
        <div ref={contentRef} className="companion-dialogue-card__body">
          <p className="companion-dialogue-card__text">
            {dialogue.displayedText}
            {dialogue.isSpeaking && (
              <span className="companion-dialogue-card__cursor" aria-hidden="true" />
            )}
          </p>
        </div>
      </div>
    </aside>
  );
}

