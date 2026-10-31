import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AttentionController,
  AutonomousActivityScheduler,
  BlinkController,
  BreathingController,
  ExpressionController,
  GazeController,
  GestureController,
  NaturalIdleController,
  ReactionDispatcher,
  SpeechMouthController,
} from '../character';
import type {
  AttentionConfig,
  AttentionStatusSnapshot,
  AutonomousActivityName,
  AutonomousActivitySchedulerConfig,
  AutonomousActivityStatusSnapshot,
  AvatarControllerSlots,
  ClearEmotionOptions,
  ConversationActivityMode,
  EmotionName,
  ExpressionConfig,
  ExpressionStatusSnapshot,
  GestureName,
  GestureStatusSnapshot,
  NaturalIdleConfig,
  NaturalIdleStatusSnapshot,
  PlayGestureOptions,
  PostureName,
  SetEmotionOptions,
  StopGestureOptions,
  TriggerAutonomousActivityOptions,
} from '../character';

export interface IdleAnimationToggles {
  readonly breathingEnabled: boolean;
  readonly blinkingEnabled: boolean;
  readonly headIdleEnabled: boolean;
  readonly weightShiftEnabled: boolean;
}

export interface UseAttentionSystemOptions {
  /** Configurable attention thresholds and behavior intervals (e.g., inactivityThresholdSeconds: 30). */
  config?: Partial<AttentionConfig>;
  /** Optional default transition configuration for ExpressionController. */
  expressionConfig?: Partial<ExpressionConfig>;
  /** Optional configuration for NaturalIdleController. */
  naturalIdleConfig?: Partial<NaturalIdleConfig>;
  /** Optional configuration for AutonomousActivityScheduler. */
  autonomousActivityConfig?: Partial<AutonomousActivitySchedulerConfig>;
  /** Optional pre-created unified system result from a parent component (prevents split-brain duplicate controllers). */
  externalSystem?: UseAttentionSystemResult;
  /** Optional external AttentionController instance if managed higher in the app tree. */
  externalAttention?: AttentionController;
  /** Optional external ExpressionController instance if managed higher in the app tree. */
  externalExpression?: ExpressionController;
  /** Optional external GestureController instance if managed higher in the app tree. */
  externalGesture?: GestureController;
  /** Optional external NaturalIdleController instance if managed higher in the app tree. */
  externalNaturalIdle?: NaturalIdleController;
  /** Optional external SpeechMouthController instance. */
  externalSpeechMouth?: SpeechMouthController;
  /** Optional external AutonomousActivityScheduler instance. */
  externalActivityScheduler?: AutonomousActivityScheduler;
}

export interface UseAttentionSystemResult {
  attention: AttentionController;
  breathingController: BreathingController;
  gazeController: GazeController;
  expressionController: ExpressionController;
  blinkController: BlinkController;
  gestureController: GestureController;
  naturalIdleController: NaturalIdleController;
  speechMouthController: SpeechMouthController;
  activityScheduler: AutonomousActivityScheduler;
  reactionDispatcher: ReactionDispatcher;
  controllerSlots: AvatarControllerSlots;
  status: AttentionStatusSnapshot;
  expressionStatus: ExpressionStatusSnapshot;
  gestureStatus: GestureStatusSnapshot;
  naturalIdleStatus: NaturalIdleStatusSnapshot;
  activityStatus: AutonomousActivityStatusSnapshot;
  idleToggles: IdleAnimationToggles;
  returnToAttentive: () => void;
  notifyInteraction: () => void;
  onUserMessage: () => void;
  setConversationMode: (mode: ConversationActivityMode) => void;
  togglePaused: () => void;
  setBreathingEnabled: (enabled: boolean) => void;
  setBlinkingEnabled: (enabled: boolean) => void;
  setHeadIdleEnabled: (enabled: boolean) => void;
  setWeightShiftEnabled: (enabled: boolean) => void;
  setIdlePosture: (posture: PostureName, durationSeconds?: number) => void;
  triggerManualBlink: () => void;
  triggerManualNod: () => void;
  setEmotion: (emotion: EmotionName, intensity?: number, options?: SetEmotionOptions) => boolean;
  clearEmotion: (options?: ClearEmotionOptions) => void;
  setExpressionTransitionDuration: (seconds: number) => void;
  playGesture: (gesture: GestureName, options?: PlayGestureOptions) => boolean;
  stopGesture: (options?: StopGestureOptions) => void;
  setGestureIntensity: (intensity: number) => void;
  setAutonomousActivityEnabled: (enabled: boolean) => void;
  triggerAutonomousActivity: (
    activity: AutonomousActivityName,
    options?: TriggerAutonomousActivityOptions,
  ) => boolean;
  interruptAutonomousActivity: () => void;
  setAutonomousActivityFrequency: (multiplier: number) => void;
  resetToNeutralPosture: () => void;
}

export function useAttentionSystem(
  options: UseAttentionSystemOptions = {},
): UseAttentionSystemResult {
  const {
    config,
    expressionConfig,
    naturalIdleConfig,
    autonomousActivityConfig,
    externalSystem,
    externalAttention,
    externalExpression,
    externalGesture,
    externalNaturalIdle,
    externalSpeechMouth,
    externalActivityScheduler,
  } = options;

  const [idleToggles, setIdleToggles] = useState<IdleAnimationToggles>({
    breathingEnabled: true,
    blinkingEnabled: true,
    headIdleEnabled: true,
    weightShiftEnabled: true,
  });

  const [internalBundle] = useState(() => {
    const ownedAttention = new AttentionController(config);
    const breathing = new BreathingController();
    const expression = new ExpressionController(expressionConfig);
    const naturalIdle = new NaturalIdleController(naturalIdleConfig);
    const blink = new BlinkController(
      config?.blinkIntervalRange ? { intervalRange: config.blinkIntervalRange } : {},
    );
    const gaze = new GazeController({
      attention: ownedAttention,
      onSaccadeBlinkSuggestion: () => {
        blink.notifySaccade();
      },
    });
    const gesture = new GestureController({
      onUpperBodyOffset: (offset) => {
        breathing.setGestureOffset(offset);
      },
      onHeadAccent: (accent) => {
        ownedAttention.setGestureHeadAccent(accent);
      },
    });
    const speechMouth = new SpeechMouthController();
    const activityScheduler = new AutonomousActivityScheduler({
      attention: ownedAttention,
      breathing,
      naturalIdle,
      gesture,
      expression,
      speechMouth,
      config: autonomousActivityConfig,
    });
    const reactionDispatcher = new ReactionDispatcher({
      attention: ownedAttention,
      expression,
      gesture,
      speechMouth,
      naturalIdle,
      activityScheduler,
    });

    naturalIdle.setPelvicOffsetHandler((offset) => {
      breathing.setPelvicOffset(offset);
    });

    return {
      attention: ownedAttention,
      breathing,
      expression,
      blink,
      gaze,
      gesture,
      naturalIdle,
      speechMouth,
      activityScheduler,
      reactionDispatcher,
    };
  });

  const activeBundle = useMemo(() => {
    if (externalSystem) {
      return {
        attention: externalSystem.attention,
        breathing: externalSystem.breathingController,
        expression: externalSystem.expressionController,
        blink: externalSystem.blinkController,
        gaze: externalSystem.gazeController,
        gesture: externalSystem.gestureController,
        naturalIdle: externalSystem.naturalIdleController,
        speechMouth: externalSystem.speechMouthController,
        activityScheduler: externalSystem.activityScheduler,
        reactionDispatcher: externalSystem.reactionDispatcher,
      };
    }

    const resolvedExpression = externalExpression ?? internalBundle.expression;
    const resolvedGesture = externalGesture ?? internalBundle.gesture;
    const resolvedNaturalIdle = externalNaturalIdle ?? internalBundle.naturalIdle;
    const resolvedSpeechMouth = externalSpeechMouth ?? internalBundle.speechMouth;
    const resolvedAttention = externalAttention ?? internalBundle.attention;

    const hasCustomControllerOverride = Boolean(
      externalAttention ||
        externalExpression ||
        externalGesture ||
        externalNaturalIdle ||
        externalSpeechMouth,
    );

    const resolvedActivityScheduler =
      externalActivityScheduler ??
      (hasCustomControllerOverride
        ? new AutonomousActivityScheduler({
            attention: resolvedAttention,
            breathing: internalBundle.breathing,
            naturalIdle: resolvedNaturalIdle,
            gesture: resolvedGesture,
            expression: resolvedExpression,
            speechMouth: resolvedSpeechMouth,
            config: autonomousActivityConfig,
          })
        : internalBundle.activityScheduler);

    const reactionDispatcher = new ReactionDispatcher({
      attention: resolvedAttention,
      expression: resolvedExpression,
      gesture: resolvedGesture,
      speechMouth: resolvedSpeechMouth,
      naturalIdle: resolvedNaturalIdle,
      activityScheduler: resolvedActivityScheduler,
    });

    if (!externalAttention) {
      return {
        ...internalBundle,
        expression: resolvedExpression,
        gesture: resolvedGesture,
        naturalIdle: resolvedNaturalIdle,
        speechMouth: resolvedSpeechMouth,
        activityScheduler: resolvedActivityScheduler,
        reactionDispatcher,
      };
    }

    return {
      attention: externalAttention,
      breathing: internalBundle.breathing,
      expression: resolvedExpression,
      blink: internalBundle.blink,
      gesture: resolvedGesture,
      naturalIdle: resolvedNaturalIdle,
      speechMouth: resolvedSpeechMouth,
      activityScheduler: resolvedActivityScheduler,
      reactionDispatcher,
      gaze: new GazeController({
        attention: externalAttention,
        onSaccadeBlinkSuggestion: () => {
          internalBundle.blink.notifySaccade();
        },
      }),
    };
  }, [
    autonomousActivityConfig,
    externalActivityScheduler,
    externalAttention,
    externalExpression,
    externalGesture,
    externalNaturalIdle,
    externalSpeechMouth,
    externalSystem,
    internalBundle,
  ]);

  // Synchronize runtime config updates (e.g., tuning the 30s inactivity threshold or blink interval)
  useEffect(() => {
    if (externalSystem || !config) {
      return;
    }
    activeBundle.attention.updateConfig(config);
    if (config.blinkIntervalRange) {
      activeBundle.blink.updateConfig({ intervalRange: config.blinkIntervalRange });
    }
  }, [activeBundle, config, externalSystem]);

  // Synchronize coordinated gesture channels, pelvic offsets, pause/resume, & browser tab visibility
  useEffect(() => {
    if (externalSystem) {
      return;
    }

    activeBundle.gesture.setUpperBodyOffsetHandler((offset) => {
      activeBundle.breathing.setGestureOffset(offset);
    });
    activeBundle.gesture.setHeadAccentHandler((accent) => {
      activeBundle.attention.setGestureHeadAccent(accent);
    });
    activeBundle.naturalIdle.setPelvicOffsetHandler((offset) => {
      activeBundle.breathing.setPelvicOffset(offset);
    });

    const syncPause = (paused: boolean) => {
      activeBundle.breathing.setPaused(paused);
      activeBundle.expression.setPaused(paused);
      activeBundle.blink.setPaused(paused);
      activeBundle.gesture.setPaused(paused);
      activeBundle.naturalIdle.setPaused(paused);
      activeBundle.speechMouth.setPaused(paused);
      activeBundle.activityScheduler.setPaused(paused);
    };

    syncPause(activeBundle.attention.isPaused);
    const unsubscribe = activeBundle.attention.subscribe((snap) => {
      syncPause(snap.isPaused);
    });

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined') {
        activeBundle.activityScheduler.setTabHidden(document.visibilityState === 'hidden');
      }
    };

    if (typeof document !== 'undefined') {
      activeBundle.activityScheduler.setTabHidden(document.visibilityState === 'hidden');
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      unsubscribe();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      activeBundle.gesture.setUpperBodyOffsetHandler(undefined);
      activeBundle.gesture.setHeadAccentHandler(undefined);
      activeBundle.naturalIdle.setPelvicOffsetHandler(undefined);
    };
  }, [activeBundle, externalSystem]);

  const status = useSyncExternalStore(
    activeBundle.attention.subscribe,
    activeBundle.attention.getSnapshot,
    activeBundle.attention.getSnapshot,
  );

  const expressionStatus = useSyncExternalStore(
    activeBundle.expression.subscribe,
    activeBundle.expression.getSnapshot,
    activeBundle.expression.getSnapshot,
  );

  const gestureStatus = useSyncExternalStore(
    activeBundle.gesture.subscribe,
    activeBundle.gesture.getSnapshot,
    activeBundle.gesture.getSnapshot,
  );

  const naturalIdleStatus = useSyncExternalStore(
    activeBundle.naturalIdle.subscribe,
    activeBundle.naturalIdle.getSnapshot,
    activeBundle.naturalIdle.getSnapshot,
  );

  const activityStatus = useSyncExternalStore(
    activeBundle.activityScheduler.subscribe,
    activeBundle.activityScheduler.getSnapshot,
    activeBundle.activityScheduler.getSnapshot,
  );

  const controllerSlots = useMemo<AvatarControllerSlots>(
    () => ({
      orchestrator: activeBundle.activityScheduler,
      lowerBody: activeBundle.naturalIdle,
      gesture: activeBundle.gesture,
      idle: activeBundle.breathing,
      gaze: activeBundle.gaze,
      expression: activeBundle.expression,
      speechMouth: activeBundle.speechMouth,
      extensions: [activeBundle.blink],
    }),
    [
      activeBundle.activityScheduler,
      activeBundle.naturalIdle,
      activeBundle.gesture,
      activeBundle.breathing,
      activeBundle.gaze,
      activeBundle.expression,
      activeBundle.speechMouth,
      activeBundle.blink,
    ],
  );

  const returnToAttentive = useCallback(() => {
    activeBundle.activityScheduler.notifyUserInteraction();
    activeBundle.attention.returnToAttentive();
    activeBundle.naturalIdle.returnToNeutral();
  }, [activeBundle.activityScheduler, activeBundle.attention, activeBundle.naturalIdle]);

  const notifyInteraction = useCallback(() => {
    activeBundle.activityScheduler.notifyUserInteraction();
    activeBundle.attention.notifyInteraction();
    activeBundle.naturalIdle.onUserInteraction();
  }, [activeBundle.activityScheduler, activeBundle.attention, activeBundle.naturalIdle]);

  const onUserMessage = useCallback(() => {
    activeBundle.activityScheduler.notifyUserInteraction();
    activeBundle.attention.onUserMessage();
    activeBundle.naturalIdle.returnToNeutral();
  }, [activeBundle.activityScheduler, activeBundle.attention, activeBundle.naturalIdle]);

  const setConversationMode = useCallback(
    (mode: ConversationActivityMode) => {
      if (mode !== 'NONE') {
        activeBundle.activityScheduler.notifyUserInteraction();
      }
      activeBundle.attention.setConversationMode(mode);
      activeBundle.naturalIdle.setConversationMode(mode);
    },
    [activeBundle.activityScheduler, activeBundle.attention, activeBundle.naturalIdle],
  );

  const togglePaused = useCallback(() => {
    const nextPaused = !activeBundle.attention.isPaused;
    activeBundle.attention.setPaused(nextPaused);
    activeBundle.breathing.setPaused(nextPaused);
    activeBundle.expression.setPaused(nextPaused);
    activeBundle.blink.setPaused(nextPaused);
    activeBundle.gesture.setPaused(nextPaused);
    activeBundle.naturalIdle.setPaused(nextPaused);
    activeBundle.speechMouth.setPaused(nextPaused);
    activeBundle.activityScheduler.setPaused(nextPaused);
  }, [activeBundle]);

  const setBreathingEnabled = useCallback(
    (enabled: boolean) => {
      activeBundle.breathing.setEnabled(enabled);
      setIdleToggles((prev) =>
        prev.breathingEnabled === enabled ? prev : { ...prev, breathingEnabled: enabled },
      );
    },
    [activeBundle.breathing],
  );

  const setBlinkingEnabled = useCallback(
    (enabled: boolean) => {
      activeBundle.blink.setEnabled(enabled);
      setIdleToggles((prev) =>
        prev.blinkingEnabled === enabled ? prev : { ...prev, blinkingEnabled: enabled },
      );
    },
    [activeBundle.blink],
  );

  const setHeadIdleEnabled = useCallback(
    (enabled: boolean) => {
      activeBundle.attention.setHeadIdleEnabled(enabled);
      activeBundle.breathing.setPostureEnabled(enabled);
      setIdleToggles((prev) =>
        prev.headIdleEnabled === enabled ? prev : { ...prev, headIdleEnabled: enabled },
      );
    },
    [activeBundle.attention, activeBundle.breathing],
  );

  const setWeightShiftEnabled = useCallback(
    (enabled: boolean) => {
      activeBundle.naturalIdle.setEnabled(enabled);
      setIdleToggles((prev) =>
        prev.weightShiftEnabled === enabled ? prev : { ...prev, weightShiftEnabled: enabled },
      );
    },
    [activeBundle.naturalIdle],
  );

  const setIdlePosture = useCallback(
    (posture: PostureName, durationSeconds?: number) => {
      activeBundle.naturalIdle.setPosture(posture, durationSeconds);
    },
    [activeBundle.naturalIdle],
  );

  const triggerManualBlink = useCallback(() => {
    activeBundle.blink.triggerManualBlink();
  }, [activeBundle.blink]);

  const triggerManualNod = useCallback(() => {
    activeBundle.attention.triggerManualNod();
  }, [activeBundle.attention]);

  const setEmotion = useCallback(
    (emotion: EmotionName, intensity = 1.0, emotionOptions?: SetEmotionOptions) => {
      const ok = activeBundle.expression.setEmotion(emotion, intensity, emotionOptions);
      if (ok) {
        if (emotion === 'curious') {
          const sign = activeBundle.attention.nextAlternatingSign();
          activeBundle.attention.setEmotionalHeadAccent({
            rollRad: sign * (0.13 + 0.05 * Math.min(1, Math.max(0, intensity))),
            pitchRad: -0.025 * Math.min(1, Math.max(0, intensity)),
            holdSeconds: emotionOptions?.holdSeconds ?? 2.5,
          });
        } else if (emotion === 'confused') {
          const sign = activeBundle.attention.nextAlternatingSign();
          activeBundle.attention.setEmotionalHeadAccent({
            rollRad: sign * (0.14 + 0.06 * Math.min(1, Math.max(0, intensity))),
            pitchRad: 0.022 * Math.min(1, Math.max(0, intensity)),
            holdSeconds: emotionOptions?.holdSeconds ?? 2.5,
          });
        } else {
          activeBundle.attention.setEmotionalHeadAccent(null);
        }
      }
      return ok;
    },
    [activeBundle.attention, activeBundle.expression],
  );

  const clearEmotion = useCallback(
    (clearOptions?: ClearEmotionOptions) => {
      activeBundle.expression.clearEmotion(clearOptions);
      activeBundle.attention.setEmotionalHeadAccent(null);
    },
    [activeBundle.attention, activeBundle.expression],
  );

  const setExpressionTransitionDuration = useCallback(
    (seconds: number) => {
      activeBundle.expression.setTransitionDuration(seconds);
    },
    [activeBundle.expression],
  );

  const playGesture = useCallback(
    (gesture: GestureName, gestureOptions?: PlayGestureOptions) => {
      return activeBundle.gesture.playGesture(gesture, gestureOptions);
    },
    [activeBundle.gesture],
  );

  const stopGesture = useCallback(
    (stopOptions?: StopGestureOptions) => {
      activeBundle.gesture.stopGesture(stopOptions);
    },
    [activeBundle.gesture],
  );

  const setGestureIntensity = useCallback(
    (intensity: number) => {
      activeBundle.gesture.setIntensity(intensity);
    },
    [activeBundle.gesture],
  );

  const setAutonomousActivityEnabled = useCallback(
    (enabled: boolean) => {
      activeBundle.activityScheduler.setEnabled(enabled);
    },
    [activeBundle.activityScheduler],
  );

  const triggerAutonomousActivity = useCallback(
    (activity: AutonomousActivityName, triggerOptions?: TriggerAutonomousActivityOptions) => {
      return activeBundle.activityScheduler.triggerActivity(activity, triggerOptions);
    },
    [activeBundle.activityScheduler],
  );

  const interruptAutonomousActivity = useCallback(() => {
    activeBundle.activityScheduler.interruptActivity();
  }, [activeBundle.activityScheduler]);

  const setAutonomousActivityFrequency = useCallback(
    (multiplier: number) => {
      activeBundle.activityScheduler.setFrequencyMultiplier(multiplier);
    },
    [activeBundle.activityScheduler],
  );

  const resetToNeutralPosture = useCallback(() => {
    activeBundle.activityScheduler.resetToNeutral();
    activeBundle.attention.returnToAttentive();
  }, [activeBundle.activityScheduler, activeBundle.attention]);

  if (externalSystem) {
    return externalSystem;
  }

  return {
    attention: activeBundle.attention,
    breathingController: activeBundle.breathing,
    gazeController: activeBundle.gaze,
    expressionController: activeBundle.expression,
    blinkController: activeBundle.blink,
    gestureController: activeBundle.gesture,
    naturalIdleController: activeBundle.naturalIdle,
    speechMouthController: activeBundle.speechMouth,
    activityScheduler: activeBundle.activityScheduler,
    reactionDispatcher: activeBundle.reactionDispatcher,
    controllerSlots,
    status,
    expressionStatus,
    gestureStatus,
    naturalIdleStatus,
    activityStatus,
    idleToggles,
    returnToAttentive,
    notifyInteraction,
    onUserMessage,
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
  };
}
