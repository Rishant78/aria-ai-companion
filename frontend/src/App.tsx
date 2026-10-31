import { useCallback, useEffect, useState } from 'react';
import { AvatarScene } from './components/AvatarScene';
import { FloatingTopBar } from './components/chat/FloatingTopBar';
import { SpeechBubbleOverlay } from './components/chat/SpeechBubbleOverlay';
import { ChatInput } from './components/chat/ChatInput';
import { ChatStatus } from './components/chat/ChatStatus';
import { ChatPanel } from './components/chat/ChatPanel';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useAttentionSystem } from './hooks/useAttentionSystem';
import { useTheme } from './hooks/useTheme';
import { useAudioManager } from './audio/useAudioManager';
import { useCompanionChat } from './conversation/useCompanionChat';
import { useVoiceInput } from './voice/useVoiceInput';
import type { FramingMode } from './character/types';
import './App.css';

const STATE_DISPLAY_LABELS: Record<string, string> = {
  ATTENTIVE: 'Attentive',
  EXPLORING: 'Exploring',
  SEEKING_ATTENTION: 'Seeking Attention',
  LISTENING: 'Listening',
  SPEAKING: 'Speaking',
};

export function App() {
  const { theme, toggleTheme } = useTheme();

  // Voice Playback & Audio Preferences (Milestone 7, Stage 2)
  const {
    audioManager,
    voiceEnabled,
    isPlaying: isAudioPlaying,
    currentAudioId,
    toggleVoice,
  } = useAudioManager();

  // Unified Avatar Animation & Reaction Engine
  const attentionSystem = useAttentionSystem();
  const {
    attention,
    expressionController,
    gestureController,
    speechMouthController,
    reactionDispatcher,
    controllerSlots,
    status: attentionStatus,
  } = attentionSystem;

  // Conversation and Chat Orchestrator
  const {
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
    closeHistory,
    toggleHistory,
  } = useCompanionChat({
    reactionDispatcher,
    speechMouthController,
    attentionController: attention,
    audioManager,
    voiceEnabled,
  });

  // Natural Turn-Taking & Browser Voice Input Engine
  const handleVoiceStart = useCallback(() => {
    // 1. Natural Turn-Taking Interruption: stop active voice audio immediately
    audioManager?.stop();
    // 2. Halt mouth viseme articulation and reset to neutral
    speechMouthController?.stopSpeech();
    // 3. Notify avatar reaction engine that user is speaking (enters LISTENING mode)
    reactionDispatcher?.onUserMessageSubmitted();
    // 4. Dismiss companion dialogue overlay if active
    dismissDialogue();
  }, [audioManager, speechMouthController, reactionDispatcher, dismissDialogue]);

  const handleFinalVoiceTranscript = useCallback(
    async (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed) return;
      await sendMessage(trimmed);
    },
    [sendMessage],
  );

  const {
    isSupported: isVoiceSupported,
    state: voiceState,
    interimTranscript,
    error: voiceError,
    startListening: startVoiceInput,
    stopListening: stopVoiceInput,
  } = useVoiceInput({
    onStart: handleVoiceStart,
    onFinalTranscript: handleFinalVoiceTranscript,
  });

  // Camera framing controls hooked from AvatarScene
  const [framingMode, setFramingMode] = useState<FramingMode>('full');
  const [viewerControls, setViewerControls] = useState<{
    toggleFramingMode: () => void;
    resetFraming: () => void;
    framingMode: FramingMode;
  } | null>(null);

  // Developer toolbox state (accessible exclusively via Ctrl + Shift + D)
  const [showDevControls, setShowDevControls] = useState(false);

  // Developer toolbox keyboard shortcut: Ctrl + Shift + D toggles, Escape closes.
  // Accessible strictly via shortcut, never displayed in public UI.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Must work only when the Aria application window is focused
      if (
        typeof document !== 'undefined' &&
        typeof document.hasFocus === 'function' &&
        !document.hasFocus()
      ) {
        return;
      }

      // Ignore shortcut when the user is typing or editing content
      const target = event.target as {
        tagName?: string;
        isContentEditable?: boolean;
        getAttribute?: (attr: string) => string | null;
      } | null;
      const activeEl =
        typeof document !== 'undefined'
          ? (document.activeElement as {
              tagName?: string;
              isContentEditable?: boolean;
              getAttribute?: (attr: string) => string | null;
            } | null)
          : null;

      const isEditable = (el: {
        tagName?: string;
        isContentEditable?: boolean;
        getAttribute?: (attr: string) => string | null;
      } | null): boolean => {
        if (!el || typeof el !== 'object') return false;
        const tag = el.tagName ? el.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          return true;
        }
        if (el.isContentEditable) {
          return true;
        }
        if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true') {
          return true;
        }
        return false;
      };

      if (isEditable(target) || isEditable(activeEl)) {
        return;
      }

      // Ctrl + Shift + D (or Cmd + Shift + D on Mac) toggles the developer toolbox
      const isDevShortcut =
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        (event.key === 'D' || event.key === 'd' || event.code === 'KeyD');

      if (isDevShortcut) {
        event.preventDefault();
        setShowDevControls((prev) => !prev);
        return;
      }

      // Escape closes the developer toolbox
      if (event.key === 'Escape') {
        setShowDevControls((prev) => {
          if (prev) {
            return false;
          }
          return prev;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleViewerControlsReady = useCallback(
    (controls: {
      toggleFramingMode: () => void;
      resetFraming: () => void;
      framingMode: FramingMode;
    }) => {
      setViewerControls(controls);
      setFramingMode(controls.framingMode);
    },
    [],
  );

  const handleToggleFraming = useCallback(() => {
    if (viewerControls) {
      viewerControls.toggleFramingMode();
      setFramingMode((prev: FramingMode) => (prev === 'full' ? 'waist' : 'full'));
    }
  }, [viewerControls]);

  const topBarStatusKind = attentionStatus.isPaused
    ? 'paused'
    : (attentionStatus.state.toLowerCase() as
        | 'attentive'
        | 'listening'
        | 'speaking'
        | 'exploring'
        | 'paused');

  const topBarStatusLabel = attentionStatus.isPaused
    ? 'Paused'
    : STATE_DISPLAY_LABELS[attentionStatus.state] ?? attentionStatus.state;

  return (
    <main className="companion-app">
      {/* 1. Full Viewport 3D Avatar Stage */}
      <div className="companion-app__stage">
        <ErrorBoundary name="AvatarStage">
          <AvatarScene
            modelUrl="/models/companion.vrm"
            initialFramingMode="full"
            attentionSystem={attentionSystem}
            controllers={controllerSlots}
            attentionController={attention}
            expressionController={expressionController}
            gestureController={gestureController}
            showHud={showDevControls}
            showDevControls={showDevControls}
            onViewerControls={handleViewerControlsReady}
          />
        </ErrorBoundary>
      </div>

      {/* 2. Isolated Chat & Interface Overlays */}
      <ErrorBoundary name="ChatOverlay">
        <FloatingTopBar
          companionName="Aria"
          statusLabel={topBarStatusLabel}
          statusKind={topBarStatusKind}
          framingMode={framingMode}
          onToggleFraming={handleToggleFraming}
          theme={theme}
          onToggleTheme={toggleTheme}
          historyCount={messages.length}
          isHistoryOpen={isHistoryOpen}
          onToggleHistory={toggleHistory}
          voiceEnabled={voiceEnabled}
          onToggleVoice={toggleVoice}
          isAudioPlaying={isAudioPlaying}
        />

        <SpeechBubbleOverlay
          dialogue={activeDialogue}
          onDismiss={dismissDialogue}
          companionName="Aria"
          onReplayAudio={replayAudio}
          isAudioPlaying={isAudioPlaying}
          voiceEnabled={voiceEnabled}
        />

        <ChatStatus
          statusKind={statusKind}
          errorMessage={errorMessage}
          onRetry={retryLastMessage}
          companionName="Aria"
        />

        <ChatInput
          onSendMessage={sendMessage}
          isLoading={isLoading}
          onCancelResponse={cancelResponse}
          voiceState={voiceState}
          isVoiceSupported={isVoiceSupported}
          interimTranscript={interimTranscript}
          voiceErrorMessage={voiceError?.message}
          onStartVoiceInput={startVoiceInput}
          onStopVoiceInput={stopVoiceInput}
        />

        <ChatPanel
          isOpen={isHistoryOpen}
          onClose={closeHistory}
          messages={messages}
          onStartNewSession={startNewSession}
          onClearHistory={clearHistory}
          sessionId={sessionId}
          companionName="Aria"
          onReplayAudio={replayAudio}
          currentAudioId={currentAudioId}
          isAudioPlaying={isAudioPlaying}
          voiceEnabled={voiceEnabled}
        />
      </ErrorBoundary>
    </main>
  );
}

export default App;
