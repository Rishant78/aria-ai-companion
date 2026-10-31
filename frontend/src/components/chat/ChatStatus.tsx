import type { ChatStatusKind } from '../../conversation/ConversationTypes';

export interface ChatStatusProps {
  statusKind: ChatStatusKind;
  errorMessage?: string | null;
  onRetry?: () => void;
  companionName?: string;
}

export function ChatStatus({
  statusKind,
  errorMessage,
  onRetry,
  companionName = 'Aria',
}: ChatStatusProps) {
  if (statusKind === 'idle' || statusKind === 'speaking') {
    return null;
  }

  return (
    <div className="companion-status-indicator" role="status" aria-live="polite">
      {statusKind === 'thinking' && (
        <div className="companion-status-pill companion-status-pill--thinking">
          <span className="companion-status-dots" aria-hidden="true">
            <span className="companion-status-dot" />
            <span className="companion-status-dot" />
            <span className="companion-status-dot" />
          </span>
          <span className="companion-status-text">{companionName} is thinking…</span>
        </div>
      )}

      {statusKind === 'listening' && (
        <div className="companion-status-pill companion-status-pill--listening">
          <span className="companion-status-pulse" aria-hidden="true" />
          <span className="companion-status-text">{companionName} is listening…</span>
        </div>
      )}

      {statusKind === 'error' && (
        <div className="companion-status-pill companion-status-pill--error" role="alert">
          <svg className="companion-status-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="companion-status-text">{errorMessage || 'Connection interrupted.'}</span>
          {onRetry && (
            <button
              type="button"
              className="companion-status-retry-btn"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

