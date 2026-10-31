import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import type { VRM } from '@pixiv/three-vrm';
import {
  ACTIVE_GESTURE_NAMES,
  AUTONOMOUS_ACTIVITY_DEFINITIONS,
  AUTONOMOUS_ACTIVITY_NAMES,
  DEFAULT_EXPRESSION_CONFIG,
  GESTURE_DEFINITIONS,
  POSTURE_NAMES,
} from '../character';
import type {
  ActiveGestureName,
  AttentionConfig,
  AttentionController,
  AutonomousActivityName,
  AutonomousActivityScheduler,
  AvatarController,
  AvatarControllerSlots,
  AvatarModelSummary,
  EmotionName,
  ExpressionController,
  FramingMode,
  GestureController,
  PostureName,
} from '../character';
import { useAttentionSystem } from '../hooks/useAttentionSystem';
import type { UseAttentionSystemResult } from '../hooks/useAttentionSystem';
import { useAvatarViewer } from '../hooks/useAvatarViewer';
import './AvatarScene.css';

export interface AvatarSceneProps {
  /** Public URL to the VRM asset. Defaults to '/models/companion.vrm'. */
  modelUrl?: string;
  /** Configurable attention & awareness thresholds/intervals (default threshold: 30s). */
  attentionConfig?: Partial<AttentionConfig>;
  /** Optional unified attention/animation system result from parent App (prevents duplicate controllers). */
  attentionSystem?: UseAttentionSystemResult;
  /** Optional external AttentionController instance for parent-level orchestration. */
  attentionController?: AttentionController;
  /** Optional external ExpressionController instance for parent-level / AI orchestration. */
  expressionController?: ExpressionController;
  /** Optional external GestureController instance for parent-level / AI orchestration. */
  gestureController?: GestureController;
  /** Optional external AutonomousActivityScheduler instance for parent-level / test orchestration. */
  activityScheduler?: AutonomousActivityScheduler;
  /** Optional modular controllers for expression, gaze, idle, or custom extensions. */
  controllers?: AvatarControllerSlots;
  /** Initial camera framing mode ('waist' or 'full'). Defaults to 'full'. */
  initialFramingMode?: FramingMode;
  /** Whether to display the subtle companion status, awareness controls, & camera HUD. */
  showHud?: boolean;
  /** Development-only idle & expression animation test controls (defaults to import.meta.env.DEV). */
  showDevControls?: boolean;
  /** Optional extra CSS class on the outer container. */
  className?: string;
  /** Invoked once the VRM finishes loading and framing. */
  onModelLoaded?: (summary: AvatarModelSummary, vrm: VRM) => void;
  /** Invoked if WebGL initialization or VRM loading fails. */
  onError?: (error: Error) => void;
  /** Optional callback providing camera framing controls to parent components. */
  onViewerControls?: (controls: {
    toggleFramingMode: () => void;
    resetFraming: () => void;
    framingMode: FramingMode;
  }) => void;
}

const STATE_LABELS: Record<string, string> = {
  ATTENTIVE: 'Attentive',
  EXPLORING: 'Exploring',
  SEEKING_ATTENTION: 'Seeking Attention',
  LISTENING: 'Listening',
  SPEAKING: 'Speaking',
};

const DEV_TOOLBAR_EMOTIONS: readonly { readonly emotion: EmotionName; readonly label: string }[] = [
  { emotion: 'neutral', label: 'Neutral' },
  { emotion: 'happy', label: 'Happy' },
  { emotion: 'sad', label: 'Sad' },
  { emotion: 'angry', label: 'Angry' },
  { emotion: 'relaxed', label: 'Relaxed' },
  { emotion: 'surprised', label: 'Surprised' },
  { emotion: 'shy', label: 'Shy' },
];

const POSTURE_LABELS: Record<PostureName, string> = {
  neutral_stand: 'Neutral',
  weight_left: 'Weight L',
  weight_right: 'Weight R',
  relaxed_settle: 'Settle',
};

const DEFAULT_DEV_INTENSITY = 0.75;
const DEFAULT_DEV_GESTURE_INTENSITY = 1.0;

function buildSliderCustomProps(
  min: number,
  max: number,
  value: number,
): CSSProperties {
  return {
    '--attr-min': String(min),
    '--attr-max': String(max),
    '--control-value': String(value),
  } as CSSProperties;
}

export function AvatarScene({
  modelUrl = '/models/companion.vrm',
  attentionConfig,
  attentionSystem,
  attentionController,
  expressionController,
  gestureController,
  activityScheduler,
  controllers,
  initialFramingMode = 'full',
  showHud = true,
  showDevControls = import.meta.env.DEV,
  className,
  onModelLoaded,
  onError,
  onViewerControls,
}: AvatarSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const progressId = useId();
  const intensitySliderId = useId();
  const durationSliderId = useId();
  const gestureIntensitySliderId = useId();
  const activityFrequencySliderId = useId();

  const [devIntensity, setDevIntensity] = useState(DEFAULT_DEV_INTENSITY);
  const [devGestureIntensity, setDevGestureIntensity] = useState(DEFAULT_DEV_GESTURE_INTENSITY);

  const {
    controllerSlots: defaultAttentionSlots,
    status: attentionStatus,
    expressionStatus,
    gestureStatus,
    naturalIdleStatus,
    activityStatus,
    idleToggles,
    returnToAttentive,
    notifyInteraction,
    setConversationMode,
    togglePaused,
    setBreathingEnabled,
    setBlinkingEnabled,
    setHeadIdleEnabled,
    setWeightShiftEnabled,
    setIdlePosture,
    triggerManualBlink,
    triggerManualNod,
    setEmotion,
    clearEmotion,
    setExpressionTransitionDuration,
    playGesture,
    stopGesture,
    setGestureIntensity,
    setAutonomousActivityEnabled,
    triggerAutonomousActivity,
    interruptAutonomousActivity,
    setAutonomousActivityFrequency,
    resetToNeutralPosture,
  } = useAttentionSystem({
    config: attentionConfig,
    externalSystem: attentionSystem,
    externalAttention: attentionController,
    externalExpression: expressionController,
    externalGesture: gestureController,
    externalActivityScheduler: activityScheduler,
  });

  const mergedControllers = useMemo<AvatarControllerSlots>(() => {
    if (!controllers) {
      return defaultAttentionSlots;
    }
    const extensionsSet = new Set<AvatarController>([
      ...(defaultAttentionSlots.extensions ?? []),
      ...(controllers.extensions ?? []),
    ]);
    return {
      orchestrator: controllers.orchestrator ?? defaultAttentionSlots.orchestrator,
      lowerBody: controllers.lowerBody ?? defaultAttentionSlots.lowerBody,
      gesture: controllers.gesture ?? defaultAttentionSlots.gesture,
      idle: controllers.idle ?? defaultAttentionSlots.idle,
      gaze: controllers.gaze ?? defaultAttentionSlots.gaze,
      expression: controllers.expression ?? defaultAttentionSlots.expression,
      speechMouth: controllers.speechMouth ?? defaultAttentionSlots.speechMouth,
      extensions: Array.from(extensionsSet),
    };
  }, [defaultAttentionSlots, controllers]);

  const {
    loadState,
    modelSummary,
    framingMode,
    toggleFramingMode,
    resetFraming,
    retryLoad,
  } = useAvatarViewer({
    containerRef,
    modelUrl,
    controllers: mergedControllers,
    initialFramingMode,
    onModelLoaded,
    onError,
  });

  useEffect(() => {
    onViewerControls?.({
      toggleFramingMode,
      resetFraming,
      framingMode,
    });
  }, [toggleFramingMode, resetFraming, framingMode, onViewerControls]);

  const handleResetFraming = () => {
    notifyInteraction();
    resetFraming();
  };

  const handleToggleListening = () => {
    setConversationMode(attentionStatus.state === 'LISTENING' ? 'NONE' : 'LISTENING');
  };

  const handleToggleSpeaking = () => {
    setConversationMode(attentionStatus.state === 'SPEAKING' ? 'NONE' : 'SPEAKING');
  };

  const visibleDevEmotions = useMemo(
    () =>
      DEV_TOOLBAR_EMOTIONS.filter(({ emotion }) =>
        expressionStatus.supportedEmotions.includes(emotion),
      ),
    [expressionStatus.supportedEmotions],
  );

  const handleSelectDevEmotion = (emotion: EmotionName) => {
    if (emotion === 'neutral') {
      setEmotion('neutral', 0);
      return;
    }
    const effectiveIntensity = devIntensity > 0 ? devIntensity : DEFAULT_DEV_INTENSITY;
    if (devIntensity <= 0) {
      setDevIntensity(DEFAULT_DEV_INTENSITY);
    }
    setEmotion(emotion, effectiveIntensity);
  };

  const handleIntensityChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Math.max(0, Math.min(1, Number(event.target.value)));
    setDevIntensity(nextValue);
    if (expressionStatus.activeEmotion !== 'neutral') {
      setEmotion(expressionStatus.activeEmotion, nextValue);
    }
  };

  const handleDurationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextSeconds = Math.max(0, Math.min(1.5, Number(event.target.value)));
    setExpressionTransitionDuration(nextSeconds);
  };

  const handleClearExpressions = () => {
    clearEmotion();
    setDevIntensity(DEFAULT_DEV_INTENSITY);
    setExpressionTransitionDuration(DEFAULT_EXPRESSION_CONFIG.defaultTransitionSeconds);
  };

  const handleSelectDevGesture = (gesture: ActiveGestureName) => {
    const effectiveIntensity =
      devGestureIntensity > 0 ? devGestureIntensity : DEFAULT_DEV_GESTURE_INTENSITY;
    if (devGestureIntensity <= 0) {
      setDevGestureIntensity(DEFAULT_DEV_GESTURE_INTENSITY);
    }
    playGesture(gesture, {
      priority: 'explicit',
      intensity: effectiveIntensity,
      bypassCooldown: true,
    });
  };

  const handleGestureIntensityChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Math.max(0, Math.min(1, Number(event.target.value)));
    setDevGestureIntensity(nextValue);
    if (gestureStatus.phase === 'attack' || gestureStatus.phase === 'sustain') {
      setGestureIntensity(nextValue);
    }
  };

  const handleStopAndResetGesture = () => {
    stopGesture();
    setDevGestureIntensity(DEFAULT_DEV_GESTURE_INTENSITY);
  };

  const handleTriggerDevActivity = (activity: AutonomousActivityName) => {
    triggerAutonomousActivity(activity, {
      bypassCooldown: true,
      force: true,
    });
  };

  const handleActivityFrequencyChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextMultiplier = Math.max(0.25, Math.min(3.0, Number(event.target.value)));
    setAutonomousActivityFrequency(nextMultiplier);
  };

  const rootClassName = className ? `avatar-scene ${className}` : 'avatar-scene';
  const stateModifier = attentionStatus.isPaused
    ? 'paused'
    : attentionStatus.state.toLowerCase();

  return (
    <div className={rootClassName}>
      <div
        ref={containerRef}
        className="avatar-scene__viewport"
        aria-hidden={loadState.status !== 'ready'}
        onPointerDown={notifyInteraction}
      />

      {/* Polite screen-reader status announcement without stealing focus */}
      <div className="avatar-scene__sr-status" role="status" aria-live="polite">
        {loadState.status === 'loading' && 'Loading 3D VRM companion model…'}
        {loadState.status === 'ready' &&
          modelSummary &&
          `${modelSummary.name} (VRM ${modelSummary.specVersion}) loaded with ${modelSummary.allExpressions.length} expressions.`}
      </div>

      {/* Visible Loading State */}
      {loadState.status === 'loading' && (
        <div className="avatar-scene__overlay">
          <div className="avatar-scene__card">
            <label htmlFor={progressId} className="avatar-scene__card-title">
              Loading Companion
              {loadState.progress !== null ? ` (${loadState.progress}%)` : '…'}
            </label>
            <progress
              id={progressId}
              className="avatar-scene__progress"
              max={100}
              {...(loadState.progress !== null ? { value: loadState.progress } : {})}
            />
            <p className="avatar-scene__card-subtitle">
              Streaming <code>{modelUrl}</code>
            </p>
          </div>
        </div>
      )}

      {/* Visible Error State */}
      {loadState.status === 'error' && (
        <div className="avatar-scene__overlay">
          <div className="avatar-scene__card avatar-scene__card--error" role="alert">
            <h2 className="avatar-scene__card-title">Unable to Load Companion</h2>
            <p className="avatar-scene__error-message">
              {loadState.errorMessage ?? 'An unexpected error occurred while loading the VRM asset.'}
            </p>
            <p className="avatar-scene__card-subtitle">
              Expected file at <code>public/models/companion.vrm</code> (served as{' '}
              <code>{modelUrl}</code>).
            </p>
            <button
              type="button"
              className="avatar-scene__button"
              onClick={retryLoad}
            >
              Retry Load
            </button>
          </div>
        </div>
      )}

      {/* Development-Only Idle, Lower-Body & Expression Animation Test Controls (dead-code eliminated in production builds) */}
      {import.meta.env.DEV && showHud && showDevControls && loadState.status === 'ready' && modelSummary && (
        <div className="avatar-scene__dev-stack">
          <div
            className="avatar-scene__dev-panel"
            role="group"
            aria-label="Development idle animation controls"
          >
            <span className="avatar-scene__dev-label">Dev Idle</span>
            <button
              type="button"
              className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
              aria-pressed={idleToggles.breathingEnabled}
              onClick={() => setBreathingEnabled(!idleToggles.breathingEnabled)}
            >
              Breathing: {idleToggles.breathingEnabled ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
              aria-pressed={idleToggles.blinkingEnabled}
              onClick={() => setBlinkingEnabled(!idleToggles.blinkingEnabled)}
            >
              Blinking: {idleToggles.blinkingEnabled ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
              aria-pressed={idleToggles.headIdleEnabled}
              onClick={() => setHeadIdleEnabled(!idleToggles.headIdleEnabled)}
            >
              Head Idle: {idleToggles.headIdleEnabled ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
              onClick={triggerManualBlink}
            >
              Manual Blink
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
              onClick={triggerManualNod}
            >
              Manual Nod
            </button>
          </div>

          {/* Lower Body & Standing Posture Toolbar */}
          <div
            className="avatar-scene__dev-panel"
            role="group"
            aria-label="Development lower body and posture controls"
          >
            <span className="avatar-scene__dev-label">Posture ({naturalIdleStatus.currentPosture})</span>
            {POSTURE_NAMES.map((posture) => (
              <button
                key={posture}
                type="button"
                className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
                aria-pressed={naturalIdleStatus.targetPosture === posture}
                onClick={() => setIdlePosture(posture)}
              >
                {POSTURE_LABELS[posture]}
              </button>
            ))}
            <button
              type="button"
              className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
              aria-pressed={idleToggles.weightShiftEnabled}
              onClick={() => setWeightShiftEnabled(!idleToggles.weightShiftEnabled)}
            >
              Weight Shift: {idleToggles.weightShiftEnabled ? 'On' : 'Off'}
            </button>
          </div>

          <div
            className="avatar-scene__dev-expressions"
            role="group"
            aria-label="Development facial expression controls"
          >
            <div className="avatar-scene__dev-row">
              <span className="avatar-scene__dev-label">Dev Emotion</span>
              {visibleDevEmotions.map(({ emotion, label }) => (
                <button
                  key={emotion}
                  type="button"
                  className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
                  aria-pressed={expressionStatus.activeEmotion === emotion}
                  onClick={() => handleSelectDevEmotion(emotion)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="avatar-scene__hud-btn avatar-scene__hud-btn--compact avatar-scene__hud-btn--reset"
                onClick={handleClearExpressions}
              >
                Clear / Reset
              </button>
            </div>

            <div className="avatar-scene__dev-sliders">
              <div className="avatar-scene__slider-field">
                <div className="avatar-scene__slider-header">
                  <label htmlFor={intensitySliderId} className="avatar-scene__slider-label">
                    Intensity
                  </label>
                  <span className="avatar-scene__slider-value">{devIntensity.toFixed(2)}</span>
                </div>
                <input
                  id={intensitySliderId}
                  className="avatar-scene__slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={devIntensity}
                  aria-valuetext={`${Math.round(devIntensity * 100)}%`}
                  style={buildSliderCustomProps(0, 1, devIntensity)}
                  onChange={handleIntensityChange}
                />
              </div>

              <div className="avatar-scene__slider-field">
                <div className="avatar-scene__slider-header">
                  <label htmlFor={durationSliderId} className="avatar-scene__slider-label">
                    Transition
                  </label>
                  <span className="avatar-scene__slider-value">
                    {expressionStatus.transitionDurationSeconds.toFixed(2)}s
                  </span>
                </div>
                <input
                  id={durationSliderId}
                  className="avatar-scene__slider"
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={expressionStatus.transitionDurationSeconds}
                  aria-valuetext={`${expressionStatus.transitionDurationSeconds.toFixed(2)} seconds`}
                  style={buildSliderCustomProps(0, 1.5, expressionStatus.transitionDurationSeconds)}
                  onChange={handleDurationChange}
                />
              </div>
            </div>
          </div>

          <div
            className="avatar-scene__dev-gestures"
            role="group"
            aria-label="Development gesture controls"
          >
            <div className="avatar-scene__dev-row">
              <span className="avatar-scene__dev-label">Dev Gesture</span>
              {ACTIVE_GESTURE_NAMES.map((gesture) => (
                <button
                  key={gesture}
                  type="button"
                  className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
                  aria-pressed={gestureStatus.activeGesture === gesture}
                  onClick={() => handleSelectDevGesture(gesture)}
                >
                  {GESTURE_DEFINITIONS[gesture].label}
                </button>
              ))}
              <button
                type="button"
                className="avatar-scene__hud-btn avatar-scene__hud-btn--compact avatar-scene__hud-btn--reset"
                onClick={handleStopAndResetGesture}
              >
                Stop / Reset
              </button>
            </div>

            <div className="avatar-scene__dev-sliders">
              <div className="avatar-scene__slider-field">
                <div className="avatar-scene__slider-header">
                  <label
                    htmlFor={gestureIntensitySliderId}
                    className="avatar-scene__slider-label"
                  >
                    Gesture Intensity
                  </label>
                  <span className="avatar-scene__slider-value">
                    {devGestureIntensity.toFixed(2)}
                  </span>
                </div>
                <input
                  id={gestureIntensitySliderId}
                  className="avatar-scene__slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={devGestureIntensity}
                  aria-valuetext={`${Math.round(devGestureIntensity * 100)}%`}
                  style={buildSliderCustomProps(0, 1, devGestureIntensity)}
                  onChange={handleGestureIntensityChange}
                />
              </div>
            </div>
          </div>

          <div
            className="avatar-scene__dev-activities"
            role="group"
            aria-label="Development autonomous activity controls"
          >
            <div className="avatar-scene__dev-row">
              <span className="avatar-scene__dev-label">Dev Activity</span>
              <span
                className="avatar-scene__dev-inspector"
                data-testid="dev-activity-inspector"
              >
                {activityStatus.activeActivity
                  ? `${activityStatus.activeActivityLabel} (${activityStatus.phase})`
                  : activityStatus.enabled
                    ? `Idle • Next ${activityStatus.nextDecisionInSeconds}s`
                    : 'Disabled'}
              </span>
              <button
                type="button"
                className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
                aria-pressed={activityStatus.enabled}
                onClick={() => setAutonomousActivityEnabled(!activityStatus.enabled)}
              >
                Auto Activity: {activityStatus.enabled ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
                onClick={interruptAutonomousActivity}
              >
                Interrupt Activity
              </button>
              <button
                type="button"
                className="avatar-scene__hud-btn avatar-scene__hud-btn--compact avatar-scene__hud-btn--reset"
                onClick={resetToNeutralPosture}
              >
                Reset Posture
              </button>
            </div>

            <div className="avatar-scene__dev-row">
              {AUTONOMOUS_ACTIVITY_NAMES.map((activityName) => (
                <button
                  key={activityName}
                  type="button"
                  className="avatar-scene__hud-btn avatar-scene__hud-btn--compact"
                  aria-pressed={activityStatus.activeActivity === activityName}
                  onClick={() => handleTriggerDevActivity(activityName)}
                >
                  {AUTONOMOUS_ACTIVITY_DEFINITIONS[activityName].label}
                </button>
              ))}
            </div>

            <div className="avatar-scene__dev-sliders">
              <div className="avatar-scene__slider-field">
                <div className="avatar-scene__slider-header">
                  <label
                    htmlFor={activityFrequencySliderId}
                    className="avatar-scene__slider-label"
                  >
                    Activity Frequency
                  </label>
                  <span className="avatar-scene__slider-value">
                    {activityStatus.frequencyMultiplier.toFixed(2)}x
                  </span>
                </div>
                <input
                  id={activityFrequencySliderId}
                  className="avatar-scene__slider"
                  type="range"
                  min={0.25}
                  max={3.0}
                  step={0.25}
                  value={activityStatus.frequencyMultiplier}
                  aria-valuetext={`${activityStatus.frequencyMultiplier.toFixed(2)}x`}
                  style={buildSliderCustomProps(0.25, 3.0, activityStatus.frequencyMultiplier)}
                  onChange={handleActivityFrequencyChange}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Ready & Awareness HUD */}
      {showHud && loadState.status === 'ready' && modelSummary && (
        <div className="avatar-scene__hud">
          <div className="avatar-scene__meta-pill">
            <span
              className={`avatar-scene__dot avatar-scene__dot--${stateModifier}`}
              aria-hidden="true"
            />
            <span className="avatar-scene__meta-name">{modelSummary.name}</span>
            <span className="avatar-scene__meta-badge">VRM {modelSummary.specVersion}</span>
            <span className={`avatar-scene__state-badge avatar-scene__state-badge--${stateModifier}`}>
              {attentionStatus.isPaused
                ? 'Paused'
                : STATE_LABELS[attentionStatus.state] ?? attentionStatus.state}
            </span>
            {!attentionStatus.isConversationActive && !attentionStatus.isPaused && (
              <span className="avatar-scene__meta-detail">
                Idle {attentionStatus.inactivitySeconds}s / {attentionStatus.inactivityThresholdSeconds}s
              </span>
            )}
          </div>

          <div className="avatar-scene__controls" role="group" aria-label="Companion attention and scene controls">
            <button
              type="button"
              className="avatar-scene__hud-btn"
              onClick={returnToAttentive}
              title="End active conversation mode and return attention to user"
            >
              Interact
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn"
              aria-pressed={attentionStatus.state === 'LISTENING'}
              onClick={handleToggleListening}
              title="Toggle active user listening state"
            >
              Listen
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn"
              aria-pressed={attentionStatus.state === 'SPEAKING'}
              onClick={handleToggleSpeaking}
              title="Toggle active companion speaking state"
            >
              Speak
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn"
              aria-pressed={attentionStatus.isPaused}
              onClick={togglePaused}
              title="Pause or resume attention controller"
            >
              {attentionStatus.isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn"
              aria-pressed={framingMode === 'full'}
              onClick={toggleFramingMode}
              title="Toggle between waist-up and full-body camera framing"
            >
              {framingMode === 'full' ? 'Waist Up' : 'Full Body'}
            </button>
            <button
              type="button"
              className="avatar-scene__hud-btn"
              onClick={handleResetFraming}
              title="Reset camera framing"
            >
              Reset View
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AvatarScene;
