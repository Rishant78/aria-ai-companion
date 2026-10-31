export const ATTENTION_STATES = [
  'ATTENTIVE',
  'EXPLORING',
  'SEEKING_ATTENTION',
  'LISTENING',
  'SPEAKING',
] as const;

export type AttentionState = (typeof ATTENTION_STATES)[number];

export type ConversationActivityMode = 'NONE' | 'LISTENING' | 'SPEAKING';

type ExplorationZoneId =
  | 'left_soft'
  | 'right_soft'
  | 'down_center'
  | 'down_left'
  | 'down_right'
  | 'up_side'
  | 'eye_contact';

type SeekingGestureKind = 'tilt' | 'nod';

export interface AttentionConfig {
  /** Seconds without user interaction before transitioning from ATTENTIVE to EXPLORING (default: 30). */
  inactivityThresholdSeconds: number;
  /** Randomized [min, max] seconds between gaze decisions in EXPLORING mode (default: [5, 12]). */
  explorationDecisionIntervalRange: readonly [number, number];
  /** Base probability (0..1) of briefly returning to eye contact during EXPLORING (default: 0.28). */
  explorationEyeContactProbability: number;
  /** Probability (0..1) of including a subtle head tilt on an EXPLORING glance (default: 0.58). */
  explorationHeadTiltProbability: number;
  /** Minimum total inactivity seconds before SEEKING_ATTENTION may trigger (default: 50). */
  attentionSeekingMinInactivitySeconds: number;
  /** Randomized [min, max] seconds cooldown between gentle SEEKING_ATTENTION moments (default: [36, 65]). */
  attentionSeekingCooldownRange: readonly [number, number];
  /** Randomized [min, max] seconds to hold direct eye contact during SEEKING_ATTENTION (default: [3.0, 4.8]). */
  attentionSeekingHoldRange: readonly [number, number];
  /** Randomized [min, max] seconds between subtle eye-contact micro-adjustments (default: [1.5, 3.6]). */
  microAdjustmentIntervalRange: readonly [number, number];
  /** Randomized [min, max] seconds between natural physiological blinks (default: [2.6, 5.8]). */
  blinkIntervalRange: readonly [number, number];
}

export const DEFAULT_ATTENTION_CONFIG: AttentionConfig = {
  inactivityThresholdSeconds: 30,
  explorationDecisionIntervalRange: [5, 12],
  explorationEyeContactProbability: 0.28,
  explorationHeadTiltProbability: 0.58,
  attentionSeekingMinInactivitySeconds: 50,
  attentionSeekingCooldownRange: [36, 65],
  attentionSeekingHoldRange: [3.0, 4.8],
  microAdjustmentIntervalRange: [1.5, 3.6],
  blinkIntervalRange: [2.6, 5.8],
};

/**
 * Per-frame behavioral intent consumed by GazeController so eye gaze and neck/head
 * rotations coordinate from a single state machine without competing for bones.
 */
export interface AttentionFrameIntent {
  readonly state: AttentionState;
  /** Desired horizontal gaze offset relative to user eye-contact line, in degrees (+ = character left). */
  readonly gazeOffsetYawDeg: number;
  /** Desired vertical gaze offset relative to user eye-contact line, in degrees (+ = upward, - = downward). */
  readonly gazeOffsetPitchDeg: number;
  /** Fraction (0..1) of horizontal gaze angle that neck/head should smoothly follow. */
  readonly headFollowYaw: number;
  /** Fraction (0..1) of vertical gaze angle that neck/head should smoothly follow. */
  readonly headFollowPitch: number;
  /** Subtle expressive head roll tilt in radians. */
  readonly headTiltRollRad: number;
  /** Additive head pitch nod offset in radians (+ = downward nod). */
  readonly headNodPitchRad: number;
  /** Single-frame saccade hint so dedicated BlinkController can accompany large gaze turns. */
  readonly saccadeBlinkSuggested: boolean;
  /** True shortly after user interaction so gaze smoothly prioritizes swift recovery. */
  readonly isRecovering: boolean;
}

/**
 * Coarse UI/diagnostic snapshot emitted only when discrete status or whole seconds change.
 */
export interface AttentionStatusSnapshot {
  readonly state: AttentionState;
  readonly inactivitySeconds: number;
  readonly inactivityThresholdSeconds: number;
  readonly isPaused: boolean;
  readonly isConversationActive: boolean;
}

export type AttentionListener = (snapshot: AttentionStatusSnapshot) => void;

/**
 * Optional subtle head accent coordinated through AttentionController -> GazeController
 * so GestureController never directly writes neck or head bones.
 */
export interface GestureHeadAccent {
  /** Additive expressive head roll tilt in radians (+ = tilt left, - = tilt right). */
  readonly rollRad?: number;
  /** Additive expressive head pitch offset in radians (+ = gentle downward nod/dip, - = lift). */
  readonly pitchRad?: number;
}

/**
 * Coordinated emotional head accent driven by ReactionDispatcher / emotion systems
 * so emotional reactions produce expressive, natural head tilts without competing for neck/head bones.
 */
export interface EmotionalHeadAccent {
  /** Additive expressive head roll tilt in radians (+ = tilt left, - = tilt right). */
  readonly rollRad?: number;
  /** Additive expressive head pitch offset in radians (+ = gentle downward nod/dip, - = lift). */
  readonly pitchRad?: number;
  /** Hold duration in seconds before returning smoothly to neutral. */
  readonly holdSeconds?: number;
}

const ALL_NON_CONTACT_ZONES: readonly ExplorationZoneId[] = [
  'left_soft',
  'right_soft',
  'down_center',
  'down_left',
  'down_right',
  'up_side',
];

const TAU = Math.PI * 2;

function randomBetween(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

function randomFromRange(range: readonly [number, number]): number {
  return randomBetween(range[0], range[1]);
}

function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  const alpha = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * alpha;
}

/**
 * Single deltaTime-driven state machine governing companion attention, idle exploration,
 * gentle attention-seeking moments, and immediate interaction recovery.
 *
 * Uses zero setInterval / setTimeout / requestAnimationFrame calls and operates
 * completely independently of any AI backend.
 */
export class AttentionController {
  private config: AttentionConfig;
  private state: AttentionState = 'ATTENTIVE';
  private conversationMode: ConversationActivityMode = 'NONE';
  private conversationExplicitlyActive = false;
  private paused = false;

  // Elapsed deltaTime accumulators & countdowns (all in seconds)
  private inactivitySeconds = 0;
  private stateElapsedSeconds = 0;
  private decisionTimerSeconds = 0;
  private seekingHoldRemainingSeconds = 0;
  private seekingCooldownSeconds = 0;
  private recoveryBoostRemainingSeconds = 0;

  // Micro-saccade / fixation drift state
  private microTimerSeconds = 0;
  private microYawDeg = 0;
  private microPitchDeg = 0;

  // Exploration target & anti-repetition history
  private baseGazeYawDeg = 0;
  private baseGazePitchDeg = 0;
  private baseHeadTiltRollRad = 0;
  private recentZones: ExplorationZoneId[] = [];
  private consecutiveAwayGlances = 0;
  private lastTiltSign = 1;

  // Attention-seeking & manual/conversational nod gesture state
  private nextSeekingGesture: SeekingGestureKind = 'tilt';
  private activeSeekingGesture: SeekingGestureKind = 'tilt';
  private nodElapsedSeconds = 0;
  private nodDurationSeconds = 0.9;
  private nodPeakRad = 0.082;
  private nodIsAmbient = false;
  private nodActive = false;

  // Ambient coordinated head-idle motion (subordinate to attention/conversation gestures)
  private headIdleEnabled = true;
  private headIdleBlend = 0;
  private idleRollPhaseA = 0.35;
  private idleRollPhaseB = 2.05;
  private idlePitchPhase = 1.15;
  private idleNodCooldownSeconds = 18;

  // Speaking / Listening subtle conversational motion accumulators
  private speakingCadencePitchPhase = 0;
  private speakingCadenceRollPhase = 0;
  private speakingGlanceTimerSeconds = 0;
  private speakingGlanceYawDeg = 0;
  private speakingGlancePitchDeg = 0;

  // Coordinated gesture head accent (smoothly damped; never overrides attention state)
  private targetGestureRollRad = 0;
  private targetGesturePitchRad = 0;
  private currentGestureRollRad = 0;
  private currentGesturePitchRad = 0;

  // Coordinated autonomous activity head offset (smoothly damped; cleared on user interaction)
  private targetActivityRollRad = 0;
  private targetActivityPitchRad = 0;
  private currentActivityRollRad = 0;
  private currentActivityPitchRad = 0;

  // Coordinated emotional head accent (smoothly damped; driven by reaction dispatcher)
  private targetEmotionRollRad = 0;
  private targetEmotionPitchRad = 0;
  private currentEmotionRollRad = 0;
  private currentEmotionPitchRad = 0;
  private emotionHoldRemainingSeconds = 0;

  // One-frame saccade blink hint consumed by GazeController -> BlinkController
  private saccadeBlinkPending = false;

  // Subscribers & referentially stable snapshot for React useSyncExternalStore
  private readonly listeners = new Set<AttentionListener>();
  private cachedSnapshot: AttentionStatusSnapshot;

  constructor(initialConfig: Partial<AttentionConfig> = {}) {
    this.config = {
      ...DEFAULT_ATTENTION_CONFIG,
      ...initialConfig,
    };
    this.microTimerSeconds = randomFromRange(this.config.microAdjustmentIntervalRange);
    this.seekingCooldownSeconds = randomBetween(18, 32);
    this.idleNodCooldownSeconds = randomBetween(15, 28);
    this.cachedSnapshot = this.createSnapshot();
  }

  public getState(): AttentionState {
    return this.state;
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public get isConversationActive(): boolean {
    return this.conversationMode !== 'NONE' || this.conversationExplicitlyActive;
  }

  public getConfig(): Readonly<AttentionConfig> {
    return this.config;
  }

  public updateConfig(patch: Partial<AttentionConfig>): void {
    this.config = {
      ...this.config,
      ...patch,
    };
    if (
      this.state === 'ATTENTIVE' &&
      !this.isConversationActive &&
      this.inactivitySeconds >= this.config.inactivityThresholdSeconds
    ) {
      this.enterExploring();
    }
    this.emitSnapshotIfChanged();
  }

  public pause(): void {
    this.setPaused(true);
  }

  public resume(): void {
    this.setPaused(false);
  }

  public setPaused(paused: boolean): void {
    if (this.paused === paused) {
      return;
    }
    this.paused = paused;
    this.emitSnapshotIfChanged();
  }

  public get isHeadIdleEnabled(): boolean {
    return this.headIdleEnabled;
  }

  public setHeadIdleEnabled(enabled: boolean): void {
    this.headIdleEnabled = enabled;
    if (!enabled) {
      this.headIdleBlend = 0;
    }
  }

  /**
   * Coordinates optional expressive head tilts/dips requested by GestureController
   * through the single GazeController neck/head ownership channel.
   */
  public setGestureHeadAccent(accent: GestureHeadAccent | null): void {
    if (!accent) {
      this.targetGestureRollRad = 0;
      this.targetGesturePitchRad = 0;
      return;
    }
    const rawRoll = typeof accent.rollRad === 'number' && Number.isFinite(accent.rollRad) ? accent.rollRad : 0;
    const rawPitch = typeof accent.pitchRad === 'number' && Number.isFinite(accent.pitchRad) ? accent.pitchRad : 0;
    this.targetGestureRollRad = Math.max(-0.22, Math.min(0.22, rawRoll));
    this.targetGesturePitchRad = Math.max(-0.14, Math.min(0.14, rawPitch));
  }

  /**
   * Coordinates gentle autonomous-activity head tilts/lifts through the single
   * GazeController neck/head ownership channel while preserving camera-relative gaze.
   */
  public setActivityHeadOffset(accent: GestureHeadAccent | null): void {
    if (!accent) {
      this.targetActivityRollRad = 0;
      this.targetActivityPitchRad = 0;
      return;
    }
    const rawRoll =
      typeof accent.rollRad === 'number' && Number.isFinite(accent.rollRad) ? accent.rollRad : 0;
    const rawPitch =
      typeof accent.pitchRad === 'number' && Number.isFinite(accent.pitchRad) ? accent.pitchRad : 0;
    this.targetActivityRollRad = Math.max(-0.24, Math.min(0.24, rawRoll));
    this.targetActivityPitchRad = Math.max(-0.16, Math.min(0.16, rawPitch));
  }

  /**
   * Coordinates emotional head tilts/dips (e.g. curious, confused, playful) through the single
   * GazeController neck/head ownership channel without competing for bones.
   */
  public setEmotionalHeadAccent(accent: EmotionalHeadAccent | null): void {
    if (!accent) {
      this.targetEmotionRollRad = 0;
      this.targetEmotionPitchRad = 0;
      this.emotionHoldRemainingSeconds = 0;
      return;
    }
    const rawRoll =
      typeof accent.rollRad === 'number' && Number.isFinite(accent.rollRad) ? accent.rollRad : 0;
    const rawPitch =
      typeof accent.pitchRad === 'number' && Number.isFinite(accent.pitchRad) ? accent.pitchRad : 0;
    this.targetEmotionRollRad = Math.max(-0.25, Math.min(0.25, rawRoll));
    this.targetEmotionPitchRad = Math.max(-0.15, Math.min(0.15, rawPitch));
    this.emotionHoldRemainingSeconds = Math.max(0, accent.holdSeconds ?? 0);
  }

  /**
   * Triggers a gentle, coordinated manual head nod via the shared head-motion intent
   * channel so no separate controller competes with GazeController for neck/head bones.
   */
  public triggerManualNod(): boolean {
    if (this.paused) {
      return false;
    }
    this.triggerGentleNod(0.85, 0.088, false);
    return true;
  }

  /**
   * Explicitly ends any active conversation mode (LISTENING / SPEAKING), cancels
   * exploration and attention-seeking targets, resets inactivity to zero, targets
   * user eye contact with smooth recovery, and transitions immediately to ATTENTIVE.
   */
  public returnToAttentive(): void {
    this.conversationMode = 'NONE';
    this.conversationExplicitlyActive = false;
    this.speakingGlanceTimerSeconds = 0;
    this.speakingGlanceYawDeg = 0;
    this.speakingGlancePitchDeg = 0;

    this.transitionTo('ATTENTIVE');
    this.inactivitySeconds = 0;

    this.decisionTimerSeconds = 0;
    this.seekingHoldRemainingSeconds = 0;
    this.consecutiveAwayGlances = 0;
    this.baseHeadTiltRollRad = 0;
    this.headIdleBlend = 0;
    this.nodActive = false;
    this.nodElapsedSeconds = 0;
    this.targetActivityRollRad = 0;
    this.targetActivityPitchRad = 0;
    this.currentActivityRollRad = 0;
    this.currentActivityPitchRad = 0;
    this.targetGestureRollRad = 0;
    this.targetGesturePitchRad = 0;
    this.currentGestureRollRad = 0;
    this.currentGesturePitchRad = 0;
    this.targetEmotionRollRad = 0;
    this.targetEmotionPitchRad = 0;
    this.currentEmotionRollRad = 0;
    this.currentEmotionPitchRad = 0;
    this.emotionHoldRemainingSeconds = 0;

    this.baseGazeYawDeg = 0;
    this.baseGazePitchDeg = 0;
    this.microYawDeg = 0;
    this.microPitchDeg = 0;
    this.microTimerSeconds = randomFromRange(this.config.microAdjustmentIntervalRange);

    this.recoveryBoostRemainingSeconds = 0.7;

    this.emitSnapshotIfChanged();
  }

  /**
   * Immediately recovers user attention upon user message, UI control press, pointer/key
   * interaction, or speech start. Resets inactivity timer and smoothly returns gaze to user.
   */
  public notifyInteraction(): void {
    if (this.paused) {
      return;
    }
    this.inactivitySeconds = 0;
    this.recoveryBoostRemainingSeconds = 0.7;

    if (this.conversationMode === 'LISTENING') {
      this.transitionTo('LISTENING');
    } else if (this.conversationMode === 'SPEAKING') {
      this.transitionTo('SPEAKING');
    } else {
      this.transitionTo('ATTENTIVE');
    }

    this.baseGazeYawDeg = 0;
    this.baseGazePitchDeg = 0;
    this.baseHeadTiltRollRad = 0;
    this.nodActive = false;
    this.targetActivityRollRad = 0;
    this.targetActivityPitchRad = 0;
    this.currentActivityRollRad = 0;
    this.currentActivityPitchRad = 0;
    this.targetGestureRollRad = 0;
    this.targetGesturePitchRad = 0;
    this.currentGestureRollRad = 0;
    this.currentGesturePitchRad = 0;
    this.targetEmotionRollRad = 0;
    this.targetEmotionPitchRad = 0;
    this.currentEmotionRollRad = 0;
    this.currentEmotionPitchRad = 0;
    this.emotionHoldRemainingSeconds = 0;
    this.consecutiveAwayGlances = 0;
    this.emitSnapshotIfChanged();
  }

  /**
   * Convenience hook for when the user submits a chat message or prompt.
   */
  public onUserMessage(): void {
    this.notifyInteraction();
  }

  /**
   * Controls active conversation states (LISTENING / SPEAKING / NONE).
   * Exploration is automatically suspended whenever a conversation is active.
   */
  public setConversationMode(mode: ConversationActivityMode): void {
    this.conversationMode = mode;
    this.inactivitySeconds = 0;
    this.recoveryBoostRemainingSeconds = 0.65;
    if (mode !== 'NONE') {
      this.targetActivityRollRad = 0;
      this.targetActivityPitchRad = 0;
    }

    if (mode === 'LISTENING') {
      this.baseGazeYawDeg = 0;
      this.baseGazePitchDeg = 0;
      this.baseHeadTiltRollRad = 0.080 * this.nextAlternatingSign();
      this.transitionTo('LISTENING');
    } else if (mode === 'SPEAKING') {
      this.baseGazeYawDeg = 0;
      this.baseGazePitchDeg = 0;
      this.baseHeadTiltRollRad = 0;
      this.speakingGlanceTimerSeconds = randomBetween(2.2, 4.5);
      this.speakingGlanceYawDeg = 0;
      this.speakingGlancePitchDeg = 0;
      this.transitionTo('SPEAKING');
    } else {
      this.baseGazeYawDeg = 0;
      this.baseGazePitchDeg = 0;
      this.baseHeadTiltRollRad = 0;
      this.transitionTo('ATTENTIVE');
    }

    this.emitSnapshotIfChanged();
  }

  /**
   * Marks an ongoing multi-turn conversation as active/inactive even between utterances,
   * suspending exploration while active and resetting inactivity on change.
   */
  public setConversationActive(active: boolean): void {
    this.conversationExplicitlyActive = active;
    this.inactivitySeconds = 0;
    if (active && (this.state === 'EXPLORING' || this.state === 'SEEKING_ATTENTION')) {
      this.recoveryBoostRemainingSeconds = 0.65;
      this.baseGazeYawDeg = 0;
      this.baseGazePitchDeg = 0;
      this.baseHeadTiltRollRad = 0;
      this.transitionTo('ATTENTIVE');
    }
    this.emitSnapshotIfChanged();
  }

  public getSnapshot = (): AttentionStatusSnapshot => {
    return this.cachedSnapshot;
  };

  public subscribe = (listener: AttentionListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public dispose(): void {
    this.targetGestureRollRad = 0;
    this.targetGesturePitchRad = 0;
    this.currentGestureRollRad = 0;
    this.currentGesturePitchRad = 0;
    this.targetActivityRollRad = 0;
    this.targetActivityPitchRad = 0;
    this.currentActivityRollRad = 0;
    this.currentActivityPitchRad = 0;
    this.targetEmotionRollRad = 0;
    this.targetEmotionPitchRad = 0;
    this.currentEmotionRollRad = 0;
    this.currentEmotionPitchRad = 0;
    this.emotionHoldRemainingSeconds = 0;
    this.listeners.clear();
  }

  /**
   * Advances the attention state machine by deltaTime seconds and returns
   * this frame's coordinated gaze, head, and blink targets.
   */
  public update(deltaTime: number): AttentionFrameIntent {
    if (this.paused || deltaTime <= 0) {
      return this.composeIntent(false);
    }

    this.saccadeBlinkPending = false;
    this.stateElapsedSeconds += deltaTime;
    this.speakingCadencePitchPhase = (this.speakingCadencePitchPhase + 3.1 * deltaTime) % TAU;
    this.speakingCadenceRollPhase = (this.speakingCadenceRollPhase + 1.7 * deltaTime) % TAU;

    if (this.recoveryBoostRemainingSeconds > 0) {
      this.recoveryBoostRemainingSeconds = Math.max(
        0,
        this.recoveryBoostRemainingSeconds - deltaTime,
      );
    }

    if (this.seekingCooldownSeconds > 0) {
      this.seekingCooldownSeconds = Math.max(0, this.seekingCooldownSeconds - deltaTime);
    }

    // 1. Inactivity progression (suspended whenever conversation is active)
    if (this.isConversationActive) {
      this.inactivitySeconds = 0;
    } else {
      this.inactivitySeconds += deltaTime;
    }

    // 2. Micro-adjustments, coordinated ambient head idle, gesture accent, & nod progression
    this.updateMicroAdjustments(deltaTime);
    this.updateHeadIdle(deltaTime);
    this.updateNod(deltaTime);
    // Coordinated gesture head accent decay:
    // Use faster decay (lambda = 12.0) when gesture accent is cleared to 0 so head returns
    // in sync with arm release (~0.44s); preserve lambda = 6.5 for active target tracking.
    const rollDecayLambda = this.targetGestureRollRad === 0 ? 12.0 : 6.5;
    const pitchDecayLambda = this.targetGesturePitchRad === 0 ? 12.0 : 6.5;

    this.currentGestureRollRad = dampScalar(
      this.currentGestureRollRad,
      this.targetGestureRollRad,
      rollDecayLambda,
      deltaTime,
    );
    this.currentGesturePitchRad = dampScalar(
      this.currentGesturePitchRad,
      this.targetGesturePitchRad,
      pitchDecayLambda,
      deltaTime,
    );

    const activityRollLambda = this.targetActivityRollRad === 0 ? 8.5 : 6.2;
    const activityPitchLambda = this.targetActivityPitchRad === 0 ? 8.5 : 6.2;
    this.currentActivityRollRad = dampScalar(
      this.currentActivityRollRad,
      this.targetActivityRollRad,
      activityRollLambda,
      deltaTime,
    );
    this.currentActivityPitchRad = dampScalar(
      this.currentActivityPitchRad,
      this.targetActivityPitchRad,
      activityPitchLambda,
      deltaTime,
    );

    // Coordinated emotional head accent progression and smooth decay
    if (this.emotionHoldRemainingSeconds > 0) {
      this.emotionHoldRemainingSeconds = Math.max(0, this.emotionHoldRemainingSeconds - deltaTime);
      if (this.emotionHoldRemainingSeconds === 0) {
        this.targetEmotionRollRad = 0;
        this.targetEmotionPitchRad = 0;
      }
    }

    const emotionRollLambda = this.targetEmotionRollRad === 0 ? 5.5 : 4.5;
    const emotionPitchLambda = this.targetEmotionPitchRad === 0 ? 5.5 : 4.5;
    this.currentEmotionRollRad = dampScalar(
      this.currentEmotionRollRad,
      this.targetEmotionRollRad,
      emotionRollLambda,
      deltaTime,
    );
    this.currentEmotionPitchRad = dampScalar(
      this.currentEmotionPitchRad,
      this.targetEmotionPitchRad,
      emotionPitchLambda,
      deltaTime,
    );

    // 3. Single canonical state machine transitions & state-specific behavior
    switch (this.state) {
      case 'ATTENTIVE': {
        if (
          !this.isConversationActive &&
          this.inactivitySeconds >= this.config.inactivityThresholdSeconds
        ) {
          this.enterExploring();
        }
        break;
      }

      case 'EXPLORING': {
        if (this.isConversationActive) {
          this.notifyInteraction();
          break;
        }

        this.decisionTimerSeconds -= deltaTime;
        if (this.decisionTimerSeconds <= 0) {
          if (
            this.inactivitySeconds >= this.config.attentionSeekingMinInactivitySeconds &&
            this.seekingCooldownSeconds <= 0
          ) {
            this.enterSeekingAttention();
          } else {
            this.pickNextExplorationDecision();
          }
        }
        break;
      }

      case 'SEEKING_ATTENTION': {
        if (this.isConversationActive) {
          this.notifyInteraction();
          break;
        }

        this.seekingHoldRemainingSeconds -= deltaTime;
        if (this.seekingHoldRemainingSeconds <= 0) {
          this.seekingCooldownSeconds = randomFromRange(
            this.config.attentionSeekingCooldownRange,
          );
          this.enterExploring();
        }
        break;
      }

      case 'LISTENING': {
        // Periodic attentive listening nod or responsive head tilt every ~4.5-8.5s
        this.decisionTimerSeconds -= deltaTime;
        if (this.decisionTimerSeconds <= 0) {
          this.decisionTimerSeconds = randomBetween(4.5, 8.5);
          if (Math.random() < 0.65) {
            this.triggerGentleNod(0.75);
          } else {
            this.baseHeadTiltRollRad = randomBetween(0.065, 0.115) * this.nextAlternatingSign();
          }
        }
        break;
      }

      case 'SPEAKING': {
        // Maintain eye contact with occasional brief conversational thought glances
        this.speakingGlanceTimerSeconds -= deltaTime;
        if (this.speakingGlanceTimerSeconds <= 0) {
          if (Math.abs(this.speakingGlanceYawDeg) > 0.5) {
            // Return to direct eye contact
            this.speakingGlanceYawDeg = 0;
            this.speakingGlancePitchDeg = 0;
            this.speakingGlanceTimerSeconds = randomBetween(2.6, 5.2);
          } else {
            // Brief subtle conversational glance aside
            const sign = this.nextAlternatingSign();
            this.speakingGlanceYawDeg = sign * randomBetween(3.0, 5.5);
            this.speakingGlancePitchDeg = randomBetween(-2.0, 2.5);
            this.speakingGlanceTimerSeconds = randomBetween(0.8, 1.5);
          }
        }
        break;
      }
    }

    this.emitSnapshotIfChanged();
    return this.composeIntent(this.saccadeBlinkPending);
  }

  private transitionTo(nextState: AttentionState): void {
    if (this.state === nextState) {
      return;
    }
    this.state = nextState;
    this.stateElapsedSeconds = 0;
    if (nextState === 'LISTENING') {
      this.decisionTimerSeconds = randomBetween(3.5, 6.5);
    }
  }

  private enterExploring(): void {
    this.transitionTo('EXPLORING');
    this.pickNextExplorationDecision();
  }

  private enterSeekingAttention(): void {
    this.transitionTo('SEEKING_ATTENTION');
    this.seekingHoldRemainingSeconds = randomFromRange(this.config.attentionSeekingHoldRange);

    const prevYaw = this.baseGazeYawDeg;
    const prevPitch = this.baseGazePitchDeg;
    this.baseGazeYawDeg = 0;
    this.baseGazePitchDeg = 0;

    if (Math.hypot(prevYaw, prevPitch) > 10) {
      this.saccadeBlinkPending = true;
    }

    this.activeSeekingGesture = this.nextSeekingGesture;
    this.nextSeekingGesture = this.nextSeekingGesture === 'tilt' ? 'nod' : 'tilt';

    if (this.activeSeekingGesture === 'tilt') {
      this.baseHeadTiltRollRad = randomBetween(0.14, 0.21) * this.nextAlternatingSign();
      this.nodActive = false;
    } else {
      this.baseHeadTiltRollRad = randomBetween(0.045, 0.085) * this.nextAlternatingSign();
      this.triggerGentleNod(0.95, 0.082, false);
    }
  }

  private pickNextExplorationDecision(): void {
    this.decisionTimerSeconds = randomFromRange(this.config.explorationDecisionIntervalRange);

    const prevYaw = this.baseGazeYawDeg;
    const prevPitch = this.baseGazePitchDeg;

    // Boost eye-contact return probability after 2+ consecutive off-axis glances
    const returnProb =
      this.consecutiveAwayGlances >= 2
        ? Math.min(0.62, this.config.explorationEyeContactProbability + 0.24)
        : this.consecutiveAwayGlances === 0
          ? 0.0
          : this.config.explorationEyeContactProbability;

    let chosenZone: ExplorationZoneId;
    if (Math.random() < returnProb && !this.recentZones.includes('eye_contact')) {
      chosenZone = 'eye_contact';
    } else {
      const candidates = ALL_NON_CONTACT_ZONES.filter(
        (zone) => !this.recentZones.includes(zone),
      );
      const pool = candidates.length > 0 ? candidates : ALL_NON_CONTACT_ZONES;
      // Weight downward and left/right slightly higher than upward glances
      const weights = pool.map((z) => (z === 'up_side' ? 0.45 : 1.0));
      const totalWeight = weights.reduce((acc, w) => acc + w, 0);
      let pick = Math.random() * totalWeight;
      chosenZone = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i++) {
        pick -= weights[i];
        if (pick <= 0) {
          chosenZone = pool[i];
          break;
        }
      }
    }

    this.recentZones.push(chosenZone);
    if (this.recentZones.length > 2) {
      this.recentZones.shift();
    }

    switch (chosenZone) {
      case 'eye_contact':
        this.baseGazeYawDeg = randomBetween(-1.4, 1.4);
        this.baseGazePitchDeg = randomBetween(-1.0, 1.0);
        this.consecutiveAwayGlances = 0;
        break;
      case 'left_soft':
        this.baseGazeYawDeg = randomBetween(10.0, 21.0);
        this.baseGazePitchDeg = randomBetween(-3.5, 3.5);
        this.consecutiveAwayGlances += 1;
        break;
      case 'right_soft':
        this.baseGazeYawDeg = randomBetween(-21.0, -10.0);
        this.baseGazePitchDeg = randomBetween(-3.5, 3.5);
        this.consecutiveAwayGlances += 1;
        break;
      case 'down_center':
        this.baseGazeYawDeg = randomBetween(-5.5, 5.5);
        this.baseGazePitchDeg = randomBetween(-15.5, -8.5);
        this.consecutiveAwayGlances += 1;
        break;
      case 'down_left':
        this.baseGazeYawDeg = randomBetween(8.0, 16.5);
        this.baseGazePitchDeg = randomBetween(-13.5, -6.5);
        this.consecutiveAwayGlances += 1;
        break;
      case 'down_right':
        this.baseGazeYawDeg = randomBetween(-16.5, -8.0);
        this.baseGazePitchDeg = randomBetween(-13.5, -6.5);
        this.consecutiveAwayGlances += 1;
        break;
      case 'up_side': {
        const sign = this.nextAlternatingSign();
        this.baseGazeYawDeg = sign * randomBetween(7.0, 14.5);
        this.baseGazePitchDeg = randomBetween(4.0, 8.5);
        this.consecutiveAwayGlances += 1;
        break;
      }
    }

    // Occasional natural head tilt in EXPLORING mode (~1.65x amplitude)
    if (Math.random() < this.config.explorationHeadTiltProbability) {
      const sign = this.nextAlternatingSign();
      this.baseHeadTiltRollRad = sign * randomBetween(0.085, 0.170);
    } else {
      this.baseHeadTiltRollRad = 0;
    }

    // Request physiological blink hint on larger gaze shifts (owned by BlinkController)
    const shiftDeg = Math.hypot(
      this.baseGazeYawDeg - prevYaw,
      this.baseGazePitchDeg - prevPitch,
    );
    if (shiftDeg > 11) {
      this.saccadeBlinkPending = true;
    }
  }

  public nextAlternatingSign(): number {
    // Biases against repeating the exact same tilt direction indefinitely while staying organic
    const flip = Math.random() < 0.78 ? -this.lastTiltSign : this.lastTiltSign;
    this.lastTiltSign = flip;
    return flip;
  }

  private updateMicroAdjustments(deltaTime: number): void {
    this.microTimerSeconds -= deltaTime;
    if (this.microTimerSeconds <= 0) {
      this.microTimerSeconds = randomFromRange(this.config.microAdjustmentIntervalRange);
      const scale = this.state === 'LISTENING' ? 0.65 : 1.0;
      this.microYawDeg = randomBetween(-1.5, 1.5) * scale;
      this.microPitchDeg = randomBetween(-1.1, 1.1) * scale;
    }
  }

  private updateHeadIdle(deltaTime: number): void {
    // Subordinate priority: attention-seeking and active conversation gestures override ambient idle
    let priorityScale = 1.0;
    if (!this.headIdleEnabled || this.recoveryBoostRemainingSeconds > 0) {
      priorityScale = 0.0;
    } else if (this.state === 'SEEKING_ATTENTION') {
      priorityScale = 0.0;
    } else if (this.state === 'LISTENING' || this.state === 'SPEAKING') {
      priorityScale = 0.22;
    } else if (this.state === 'EXPLORING') {
      priorityScale = 0.55;
    }

    this.headIdleBlend = dampScalar(this.headIdleBlend, priorityScale, 3.2, deltaTime);

    this.idleRollPhaseA = (this.idleRollPhaseA + TAU * 0.083 * deltaTime) % TAU;
    this.idleRollPhaseB = (this.idleRollPhaseB + TAU * 0.051 * deltaTime) % TAU;
    this.idlePitchPhase = (this.idlePitchPhase + TAU * 0.064 * deltaTime) % TAU;

    // Occasional very gentle ambient nod during calm attentive presence
    if (
      this.headIdleEnabled &&
      this.state === 'ATTENTIVE' &&
      !this.nodActive &&
      this.recoveryBoostRemainingSeconds <= 0
    ) {
      this.idleNodCooldownSeconds -= deltaTime;
      if (this.idleNodCooldownSeconds <= 0) {
        this.idleNodCooldownSeconds = randomBetween(15, 28);
        this.triggerGentleNod(0.85, 0.044, true);
      }
    }
  }

  private triggerGentleNod(
    durationSeconds: number,
    peakRad = 0.082,
    isAmbient = false,
  ): void {
    this.nodActive = true;
    this.nodElapsedSeconds = 0;
    this.nodDurationSeconds = durationSeconds;
    this.nodPeakRad = peakRad;
    this.nodIsAmbient = isAmbient;
  }

  private updateNod(deltaTime: number): void {
    if (!this.nodActive) {
      return;
    }
    this.nodElapsedSeconds += deltaTime;
    if (this.nodElapsedSeconds >= this.nodDurationSeconds) {
      this.nodActive = false;
      this.nodElapsedSeconds = 0;
    }
  }

  private composeIntent(saccadeBlinkSuggested: boolean): AttentionFrameIntent {
    let gazeYaw = this.baseGazeYawDeg + this.microYawDeg;
    let gazePitch = this.baseGazePitchDeg + this.microPitchDeg;
    let headFollowYaw = 0.42;
    let headFollowPitch = 0.36;

    const ambientIdleRoll =
      (0.65 * Math.sin(this.idleRollPhaseA) + 0.35 * Math.sin(this.idleRollPhaseB)) *
      0.042 *
      this.headIdleBlend;
    const ambientIdlePitch = Math.sin(this.idlePitchPhase) * 0.009 * this.headIdleBlend;

    let headRoll =
      this.baseHeadTiltRollRad +
      ambientIdleRoll +
      this.currentGestureRollRad +
      this.currentActivityRollRad +
      this.currentEmotionRollRad;
    let nodPitch =
      ambientIdlePitch +
      this.currentGesturePitchRad +
      this.currentActivityPitchRad +
      this.currentEmotionPitchRad;

    if (this.nodActive && this.nodDurationSeconds > 0) {
      const phase = Math.min(1, this.nodElapsedSeconds / this.nodDurationSeconds);
      const pulse = Math.sin(Math.PI * phase);
      const nodScale = this.nodIsAmbient ? this.headIdleBlend : 1.0;
      nodPitch += this.nodPeakRad * pulse * pulse * nodScale;
    }

    if (this.state === 'SPEAKING') {
      gazeYaw += this.speakingGlanceYawDeg;
      gazePitch += this.speakingGlancePitchDeg;
      nodPitch += Math.sin(this.speakingCadencePitchPhase) * 0.018;
      headRoll += Math.sin(this.speakingCadenceRollPhase) * 0.022;
      headFollowYaw = 0.48;
    } else if (this.state === 'SEEKING_ATTENTION' && this.activeSeekingGesture === 'tilt') {
      // Gentle inquisitive lift while holding direct eye contact
      gazePitch += 1.2;
      headFollowYaw = 0.5;
      headFollowPitch = 0.45;
    } else if (this.state === 'EXPLORING') {
      headFollowYaw = 0.46;
      headFollowPitch = 0.42;
    }

    return {
      state: this.state,
      gazeOffsetYawDeg: gazeYaw || 0,
      gazeOffsetPitchDeg: gazePitch || 0,
      headFollowYaw,
      headFollowPitch,
      headTiltRollRad: headRoll || 0,
      headNodPitchRad: nodPitch || 0,
      saccadeBlinkSuggested,
      isRecovering: this.recoveryBoostRemainingSeconds > 0,
    };
  }

  private createSnapshot(): AttentionStatusSnapshot {
    return {
      state: this.state,
      inactivitySeconds: Math.floor(this.inactivitySeconds),
      inactivityThresholdSeconds: this.config.inactivityThresholdSeconds,
      isPaused: this.paused,
      isConversationActive: this.isConversationActive,
    };
  }

  private emitSnapshotIfChanged(): void {
    const roundedIdle = Math.floor(this.inactivitySeconds);
    const prev = this.cachedSnapshot;
    if (
      prev.state === this.state &&
      prev.inactivitySeconds === roundedIdle &&
      prev.inactivityThresholdSeconds === this.config.inactivityThresholdSeconds &&
      prev.isPaused === this.paused &&
      prev.isConversationActive === this.isConversationActive
    ) {
      return;
    }

    this.cachedSnapshot = {
      state: this.state,
      inactivitySeconds: roundedIdle,
      inactivityThresholdSeconds: this.config.inactivityThresholdSeconds,
      isPaused: this.paused,
      isConversationActive: this.isConversationActive,
    };

    for (const listener of this.listeners) {
      listener(this.cachedSnapshot);
    }
  }
}
