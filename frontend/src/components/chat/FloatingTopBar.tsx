import type { FramingMode } from '../../character/types';
import type { ThemeMode } from '../../hooks/useTheme';

export interface FloatingTopBarProps {
  companionName?: string;
  statusLabel?: string;
  statusKind?: 'attentive' | 'listening' | 'speaking' | 'exploring' | 'paused';
  framingMode: FramingMode;
  onToggleFraming: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  historyCount: number;
  isHistoryOpen: boolean;
  onToggleHistory: () => void;
  showDevControls?: boolean;
  onToggleDevControls?: () => void;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  isAudioPlaying?: boolean;
}

export function FloatingTopBar({
  companionName = 'Aria',
  statusLabel = 'Attentive',
  statusKind = 'attentive',
  framingMode,
  onToggleFraming,
  theme,
  onToggleTheme,
  historyCount,
  isHistoryOpen,
  onToggleHistory,
  voiceEnabled = true,
  onToggleVoice,
  isAudioPlaying = false,
}: FloatingTopBarProps) {
  const themeLabel =
    theme === 'system' ? 'System Theme' : theme === 'light' ? 'Light Theme' : 'Dark Theme';

  return (
    <header className="companion-topbar" aria-label="Companion controls">
      {/* Brand & Companion Status */}
      <div className="companion-topbar__brand">
        <span
          className={`companion-topbar__status-dot companion-topbar__status-dot--${statusKind}`}
          aria-hidden="true"
        />
        <span className="companion-topbar__name">{companionName}</span>
        <span className="companion-topbar__badge" aria-label={`Status: ${statusLabel}`}>
          {statusLabel}
        </span>
      </div>

      {/* Floating Action Controls */}
      <div className="companion-topbar__actions" role="toolbar" aria-label="Quick actions">
        {/* Camera Framing Toggle */}
        <button
          type="button"
          className="companion-topbar__btn"
          onClick={onToggleFraming}
          aria-label={framingMode === 'full' ? 'Switch to Waist Up Framing' : 'Switch to Full Body Framing'}
          title={framingMode === 'full' ? 'Waist Up Framing' : 'Full Body Framing'}
        >
          <svg className="companion-topbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="companion-topbar__btn-text">
            {framingMode === 'full' ? 'Full Body' : 'Waist Up'}
          </span>
        </button>

        {/* Theme Selector */}
        <button
          type="button"
          className="companion-topbar__btn"
          onClick={onToggleTheme}
          aria-label={`Change theme. Current: ${themeLabel}`}
          title={`Theme: ${themeLabel} (Click to switch)`}
        >
          {theme === 'light' ? (
            <svg className="companion-topbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : theme === 'dark' ? (
            <svg className="companion-topbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          ) : (
            <svg className="companion-topbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8m-4-4v4" />
            </svg>
          )}
          <span className="companion-topbar__btn-text capitalize">{theme}</span>
        </button>

        {/* Voice Preference Toggle */}
        {onToggleVoice && (
          <button
            type="button"
            className={`companion-topbar__btn ${voiceEnabled ? 'companion-topbar__btn--active' : 'companion-topbar__btn--muted'}`}
            onClick={onToggleVoice}
            aria-label={voiceEnabled ? 'Mute companion voice' : 'Enable companion voice'}
            title={voiceEnabled ? 'Voice: Enabled (Click to mute)' : 'Voice: Muted (Click to enable)'}
          >
            {voiceEnabled ? (
              <svg className="companion-topbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
              </svg>
            ) : (
              <svg className="companion-topbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="17" y1="9" x2="23" y2="15" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span className="companion-topbar__btn-text">
              {voiceEnabled ? (isAudioPlaying ? 'Playing' : 'Voice') : 'Muted'}
            </span>
          </button>
        )}

        {/* Conversation History Toggle */}
        <button
          type="button"
          className={`companion-topbar__btn ${isHistoryOpen ? 'companion-topbar__btn--active' : ''}`}
          onClick={onToggleHistory}
          aria-expanded={isHistoryOpen}
          aria-label="Toggle Conversation History"
          title="Conversation History"
        >
          <svg className="companion-topbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="companion-topbar__btn-text">History</span>
          {historyCount > 0 && (
            <span className="companion-topbar__pill-count" aria-hidden="true">
              {historyCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

