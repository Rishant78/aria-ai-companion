import { useEffect, useRef } from 'react';
import type { ChatMessage as ChatMessageType } from '../../conversation/ConversationTypes';
import { ChatMessage } from './ChatMessage';

export interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessageType[];
  onStartNewSession: () => void;
  onClearHistory: () => void;
  sessionId?: string | null;
  companionName?: string;
  onReplayAudio?: (messageId: string) => void;
  currentAudioId?: string | null;
  isAudioPlaying?: boolean;
  voiceEnabled?: boolean;
}

export function ChatPanel({
  isOpen,
  onClose,
  messages,
  onStartNewSession,
  onClearHistory,
  sessionId,
  companionName = 'Aria',
  onReplayAudio,
  currentAudioId = null,
  isAudioPlaying = false,
  voiceEnabled = true,
}: ChatPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isOpen, messages]);

  if (!isOpen) return null;

  const shortSessionId = sessionId ? `${sessionId.slice(0, 8)}…` : 'Active';

  return (
    <div
      className="companion-history-backdrop"
      onClick={onClose}
      aria-hidden="true"
    >
      <div
        ref={panelRef}
        className="companion-history-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Conversation History"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="companion-history-drawer__header">
          <div className="companion-history-drawer__title-group">
            <h2 className="companion-history-drawer__title">Conversation History</h2>
            <span className="companion-history-drawer__session-badge">
              Session: <code>{shortSessionId}</code>
            </span>
          </div>

          <div className="companion-history-drawer__header-actions">
            <button
              type="button"
              className="companion-history-drawer__btn"
              onClick={onStartNewSession}
              title="Start a new conversation session"
            >
              New Chat
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                className="companion-history-drawer__btn companion-history-drawer__btn--subtle"
                onClick={onClearHistory}
                title="Clear current message history"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              className="companion-history-drawer__close-btn"
              onClick={onClose}
              aria-label="Close conversation history"
              title="Close (Esc)"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable Message List */}
        <div ref={scrollRef} className="companion-history-drawer__content">
          {messages.length === 0 ? (
            <div className="companion-history-drawer__empty">
              <div className="companion-history-drawer__empty-icon">💭</div>
              <p className="companion-history-drawer__empty-title">No messages yet</p>
              <p className="companion-history-drawer__empty-subtitle">
                Say hello to {companionName}! She reacts with dynamic facial expressions, gestures, and voice articulation.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                companionName={companionName}
                onReplayAudio={onReplayAudio}
                isAudioPlaying={isAudioPlaying && currentAudioId === msg.id}
                voiceEnabled={voiceEnabled}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

