import type { ChatMessage as ChatMessageType } from '../../conversation/ConversationTypes';

export interface ChatMessageProps {
  message: ChatMessageType;
  companionName?: string;
  onReplayAudio?: (messageId: string) => void;
  isAudioPlaying?: boolean;
  voiceEnabled?: boolean;
}

function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

export function ChatMessage({
  message,
  companionName = 'Aria',
  onReplayAudio,
  isAudioPlaying = false,
  voiceEnabled = true,
}: ChatMessageProps) {
  const isUser = message.sender === 'user';
  const timeStr = formatTime(message.timestamp);

  return (
    <article
      className={`companion-chat-message companion-chat-message--${message.sender} ${
        message.isError ? 'companion-chat-message--error' : ''
      }`}
    >
      <div className="companion-chat-message__header">
        <span className="companion-chat-message__sender">
          {isUser ? 'You' : companionName}
        </span>
        {message.emotion && (
          <span className="companion-chat-message__tag companion-chat-message__tag--emotion">
            {message.emotion}
          </span>
        )}
        {message.gesture && (
          <span className="companion-chat-message__tag companion-chat-message__tag--gesture">
            {message.gesture}
          </span>
        )}

        {/* Audio Replay Button in Chat History Message */}
        {message.audioData && onReplayAudio && (
          <button
            type="button"
            className={`companion-chat-message__audio-btn ${
              isAudioPlaying ? 'companion-chat-message__audio-btn--playing' : ''
            }`}
            onClick={() => onReplayAudio(message.id)}
            disabled={!voiceEnabled}
            aria-label={!voiceEnabled ? 'Voice muted' : isAudioPlaying ? 'Replaying…' : 'Replay audio'}
            title={!voiceEnabled ? 'Voice muted (Enable voice to replay)' : 'Replay audio'}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          </button>
        )}

        <time className="companion-chat-message__time" dateTime={new Date(message.timestamp).toISOString()}>
          {timeStr}
        </time>
      </div>

      <div className="companion-chat-message__body">
        <p className="companion-chat-message__text">{message.text}</p>
      </div>
    </article>
  );
}

