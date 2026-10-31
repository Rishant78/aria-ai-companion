import type { VRM } from '@pixiv/three-vrm';
import type { AvatarController } from './types';

export const EMOTION_NAMES = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'relaxed',
  'surprised',
  'shy',
  'curious',
  'confused',
] as const;

export type EmotionName = (typeof EMOTION_NAMES)[number];

export type EmotionPriorityTier =
  | 'idle'
  | 'ambient'
  | 'reaction'
  | 'conversation'
  | 'override';

export const EMOTION_PRIORITY_VALUES: Readonly<Record<EmotionPriorityTier, number>> = {
  idle: 10,
  ambient: 20,
  reaction: 50,
  conversation: 80,
  override: 100,
};

export type EmotionPriorityInput = EmotionPriorityTier | number;

export interface SetEmotionOptions {
  /**
   * Priority tier or numeric priority governing whether this instruction can replace
   * the currently active expression (default: 'reaction' = 50).
   */
  priority?: EmotionPriorityInput;
  /**
   * Optional transition duration in seconds (>= 0) for this specific transition.
   * Defaults to the controller's configured `transitionDurationSeconds`.
   */
  transitionSeconds?: number;
  /**
   * Optional duration in seconds (> 0) to hold the expression once reached before
   * automatically decaying back to `'neutral'`. Omit or pass `null` to hold indefinitely.
   */
  holdSeconds?: number | null;
  /**
   * Optional transition duration in seconds (>= 0) used when decaying back to `'neutral'`
   * after `holdSeconds` expires. Defaults to `transitionDurationSeconds`.
   */
  decayTransitionSeconds?: number;
}

export interface ClearEmotionOptions {
  /** Optional transition duration in seconds (>= 0) when returning to `'neutral'`. */
  transitionSeconds?: number;
}

export interface ExpressionConfig {
  /** Default smooth blend duration in seconds (default: 0.28). */
  defaultTransitionSeconds: number;
}

export const DEFAULT_EXPRESSION_CONFIG: ExpressionConfig = {
  defaultTransitionSeconds: 0.28,
};

export interface ExpressionStatusSnapshot {
  readonly activeEmotion: EmotionName;
  readonly targetIntensity: number;
  readonly priority: number;
  readonly transitionDurationSeconds: number;
  readonly isPaused: boolean;
  readonly isTemporary: boolean;
  readonly supportedEmotions: readonly EmotionName[];
}

export type ExpressionListener = (snapshot: ExpressionStatusSnapshot) => void;

/**
 * Blink presets are owned exclusively by `BlinkController`.
 * Mouth viseme presets are reserved for future lip-sync.
 * `ExpressionController` never reads or writes any channel in either set.
 */
const FORBIDDEN_BLINK_CHANNELS: ReadonlySet<string> = new Set([
  'blink',
  'blinkLeft',
  'blinkRight',
]);

const RESERVED_VISEME_CHANNELS: ReadonlySet<string> = new Set([
  'aa',
  'ih',
  'ou',
  'ee',
  'oh',
]);

const STANDARD_EMOTION_PRESETS = [
  'happy',
  'sad',
  'angry',
  'relaxed',
  'surprised',
] as const;

interface EmotionRecipeDefinition {
  /** Optional custom VRM expression names checked first (in order) if present on the model. */
  readonly customAliases?: readonly string[];
  /** Preset expression weights applied at intensity = 1.0 when custom aliases are absent. */
  readonly fallbackWeights: Readonly<Record<string, number>>;
}

/**
 * Calibrated emotion definitions grounded in VRM 1.0 / VRoid morph anatomy:
 * - Direct VRM 1.0 presets: `neutral`, `happy`, `sad`, `angry`, `relaxed`, `surprised`.
 * - Secondary emotions check native custom VRM expressions first, then fall back to
 *   balanced preset combinations whose combined weights stay <= 1.0 to avoid mesh over-displacement:
 *   - `shy`: `relaxed` (0.55 soft closed-mouth smile) + `sad` (0.35 sheepish upturned inner brows)
 *   - `curious`: `surprised` (0.42 perked brows/widened eyes) + `relaxed` (0.32 warm softened mouth)
 *   - `confused`: `sad` (0.45) + `surprised` (0.25) + `angry` (0.15) puzzled brow/uncertain mouth
 */
export const EMOTION_DEFINITIONS: Readonly<Record<EmotionName, EmotionRecipeDefinition>> = {
  neutral: {
    fallbackWeights: {},
  },
  happy: {
    fallbackWeights: { happy: 1.0 },
  },
  sad: {
    fallbackWeights: { sad: 1.0 },
  },
  angry: {
    fallbackWeights: { angry: 1.0 },
  },
  relaxed: {
    fallbackWeights: { relaxed: 1.0 },
  },
  surprised: {
    fallbackWeights: { surprised: 1.0 },
  },
  shy: {
    customAliases: ['shy', 'embarrassed'],
    fallbackWeights: { relaxed: 0.55, sad: 0.35 },
  },
  curious: {
    customAliases: ['curious'],
    fallbackWeights: { surprised: 0.42, relaxed: 0.32 },
  },
  confused: {
    customAliases: ['confused'],
    fallbackWeights: { sad: 0.45, surprised: 0.25, angry: 0.15 },
  },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function sanitizeDuration(seconds: number, fallback: number): number {
  if (!Number.isFinite(seconds)) {
    return fallback;
  }
  return Math.max(0, seconds);
}

function smoothstep01(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

function resolvePriority(priority: EmotionPriorityInput | undefined): number {
  if (priority === undefined) {
    return EMOTION_PRIORITY_VALUES.reaction;
  }
  if (typeof priority === 'number') {
    return Number.isFinite(priority) ? priority : EMOTION_PRIORITY_VALUES.reaction;
  }
  return EMOTION_PRIORITY_VALUES[priority] ?? EMOTION_PRIORITY_VALUES.reaction;
}

function isKnownEmotionName(value: string): value is EmotionName {
  return (EMOTION_NAMES as readonly string[]).includes(value);
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Modular deltaTime-driven facial ExpressionController for VRM 1.0 characters.
 *
 * Responsibilities & guarantees:
 * - Smoothly interpolates emotional expressions with clamped `[0, 1]` intensity and cubic easing.
 * - Handles mid-transition interruptions seamlessly from live intermediate weights (zero snapping).
 * - Enforces priority tiers so strong/conversational emotions are never overwritten by low-priority
 *   idle updates, while temporary (`holdSeconds`) expressions decay naturally back to `'neutral'`.
 * - Preserves `BlinkController` as the strict single owner of `blink`, `blinkLeft`, and `blinkRight`,
 *   and leaves viseme channels (`aa`, `ih`, `ou`, `ee`, `oh`) untouched for future lip-sync.
 */
export class ExpressionController implements AvatarController {
  public readonly id = 'expression';

  private transitionDurationSeconds: number;
  private paused = false;
  private vrm: VRM | null = null;

  // Managed non-blink, non-viseme VRM expression channel names
  private managedChannels: string[] = [...STANDARD_EMOTION_PRESETS];
  private resolvedRecipes = new Map<EmotionName, Readonly<Record<string, number>>>();
  private supportedEmotions: readonly EmotionName[] = [...EMOTION_NAMES];

  // Live per-channel weights for seamless interpolation & mid-transition retargeting
  private readonly currentWeights = new Map<string, number>();
  private readonly startWeights = new Map<string, number>();
  private readonly targetWeights = new Map<string, number>();

  // Active emotion & priority state
  private activeEmotion: EmotionName = 'neutral';
  private targetIntensity = 0;
  private activePriority = 0;

  // Transition & temporary hold envelope timers (driven purely by deltaTime)
  private isTransitioning = false;
  private transitionElapsedSeconds = 0;
  private activeTransitionDuration = 0;
  private holdRemainingSeconds: number | null = null;
  private pendingDecayDurationSeconds: number | null = null;

  // Subscribers & referentially stable snapshot for React useSyncExternalStore
  private readonly listeners = new Set<ExpressionListener>();
  private cachedSnapshot: ExpressionStatusSnapshot;

  constructor(initialConfig: Partial<ExpressionConfig> = {}) {
    const merged: ExpressionConfig = {
      ...DEFAULT_EXPRESSION_CONFIG,
      ...initialConfig,
    };
    this.transitionDurationSeconds = sanitizeDuration(
      merged.defaultTransitionSeconds,
      DEFAULT_EXPRESSION_CONFIG.defaultTransitionSeconds,
    );

    this.initializeDefaultCapabilities();
    this.cachedSnapshot = this.createSnapshot();
  }

  public get isPaused(): boolean {
    return this.paused;
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

  public getActiveEmotion(): EmotionName {
    return this.activeEmotion;
  }

  public getTargetIntensity(): number {
    return this.targetIntensity;
  }

  public getActivePriority(): number {
    return this.activePriority;
  }

  public getTransitionDuration(): number {
    return this.transitionDurationSeconds;
  }

  public setTransitionDuration(seconds: number): void {
    const next = sanitizeDuration(seconds, this.transitionDurationSeconds);
    if (this.transitionDurationSeconds === next) {
      return;
    }
    this.transitionDurationSeconds = next;
    this.emitSnapshotIfChanged();
  }

  public getSupportedEmotions(): readonly EmotionName[] {
    return this.supportedEmotions;
  }

  public isSupportedEmotion(emotion: string): emotion is EmotionName {
    return isKnownEmotionName(emotion) && this.resolvedRecipes.has(emotion);
  }

  /**
   * Returns the current live interpolated weight (`0..1`) of a managed VRM expression channel.
   */
  public getChannelWeight(channelName: string): number {
    return this.currentWeights.get(channelName) ?? 0;
  }

  /**
   * Requests a facial emotion with clamped `[0.0, 1.0]` intensity, priority check,
   * smooth transition retargeting, and optional temporary `holdSeconds` auto-decay.
   *
   * @returns `true` if the instruction was accepted; `false` if unsupported or blocked by higher priority.
   */
  public setEmotion(
    emotion: EmotionName,
    intensity = 1.0,
    options: SetEmotionOptions = {},
  ): boolean {
    if (typeof emotion !== 'string' || !this.isSupportedEmotion(emotion)) {
      return false;
    }

    const incomingPriority = resolvePriority(options.priority);

    // Priority check: protect active non-neutral expressions from lower-priority instructions
    // (including accidental low-priority 'neutral' idle updates). Equal or higher priority wins.
    if (this.activeEmotion !== 'neutral' && incomingPriority < this.activePriority) {
      return false;
    }

    const clampedIntensity = emotion === 'neutral' ? 0 : clamp01(intensity);
    const effectiveEmotion: EmotionName = clampedIntensity === 0 ? 'neutral' : emotion;
    const recipe = this.resolvedRecipes.get(effectiveEmotion) ?? {};

    const duration =
      options.transitionSeconds !== undefined
        ? sanitizeDuration(options.transitionSeconds, this.transitionDurationSeconds)
        : this.transitionDurationSeconds;

    const hasHold =
      effectiveEmotion !== 'neutral' &&
      typeof options.holdSeconds === 'number' &&
      Number.isFinite(options.holdSeconds) &&
      options.holdSeconds > 0;

    this.activeEmotion = effectiveEmotion;
    this.targetIntensity = clampedIntensity;
    this.activePriority = effectiveEmotion === 'neutral' ? 0 : incomingPriority;
    this.holdRemainingSeconds = hasHold ? options.holdSeconds! : null;
    this.pendingDecayDurationSeconds =
      hasHold && options.decayTransitionSeconds !== undefined
        ? sanitizeDuration(options.decayTransitionSeconds, this.transitionDurationSeconds)
        : null;

    const scaledTarget: Record<string, number> = {};
    for (const [channel, baseWeight] of Object.entries(recipe)) {
      if (
        !FORBIDDEN_BLINK_CHANNELS.has(channel) &&
        !RESERVED_VISEME_CHANNELS.has(channel)
      ) {
        scaledTarget[channel] = clamp01(baseWeight * clampedIntensity);
      }
    }

    this.startTransitionTo(scaledTarget, duration);
    this.emitSnapshotIfChanged();
    return true;
  }

  /**
   * Unconditionally clears any active emotion regardless of priority, cancels temporary
   * hold timers, and smoothly transitions all managed emotional channels back to `'neutral'`.
   */
  public clearEmotion(options: ClearEmotionOptions = {}): void {
    const duration =
      options.transitionSeconds !== undefined
        ? sanitizeDuration(options.transitionSeconds, this.transitionDurationSeconds)
        : this.transitionDurationSeconds;

    this.activeEmotion = 'neutral';
    this.targetIntensity = 0;
    this.activePriority = 0;
    this.holdRemainingSeconds = null;
    this.pendingDecayDurationSeconds = null;

    this.startTransitionTo({}, duration);
    this.emitSnapshotIfChanged();
  }

  public attach(vrm: VRM): void {
    this.vrm = vrm;
    this.inspectVrmCapabilities(vrm);

    if (!this.resolvedRecipes.has(this.activeEmotion)) {
      this.activeEmotion = 'neutral';
      this.targetIntensity = 0;
      this.activePriority = 0;
      this.holdRemainingSeconds = null;
      this.pendingDecayDurationSeconds = null;
      this.isTransitioning = false;
      for (const ch of this.managedChannels) {
        this.currentWeights.set(ch, 0);
        this.startWeights.set(ch, 0);
        this.targetWeights.set(ch, 0);
      }
    } else if (this.activeEmotion !== 'neutral') {
      const recipe = this.resolvedRecipes.get(this.activeEmotion) ?? {};
      for (const ch of this.managedChannels) {
        const goal = clamp01((recipe[ch] ?? 0) * this.targetIntensity);
        this.targetWeights.set(ch, goal);
        if (!this.isTransitioning) {
          this.currentWeights.set(ch, goal);
          this.startWeights.set(ch, goal);
        }
      }
    }

    this.applyWeightsToVrm(vrm);
    this.emitSnapshotIfChanged();
  }

  public update(vrm: VRM, deltaTime: number, elapsedTime?: number): void;
  public update(deltaTime: number): void;
  public update(vrmOrDelta: VRM | number, maybeDeltaTime?: number): void {
    let targetVrm: VRM | null;
    let deltaTime: number;

    if (typeof vrmOrDelta === 'number') {
      targetVrm = this.vrm;
      deltaTime = vrmOrDelta;
    } else {
      targetVrm = vrmOrDelta;
      deltaTime = maybeDeltaTime ?? 0;
      if (this.vrm !== targetVrm) {
        this.attach(targetVrm);
      }
    }

    if (this.paused || !Number.isFinite(deltaTime) || deltaTime <= 0) {
      return;
    }

    let remainingDt = deltaTime;

    // 1. Advance active transition with smoothstep easing
    if (this.isTransitioning) {
      if (this.activeTransitionDuration <= 0) {
        this.finishCurrentTransition();
      } else {
        const needed = this.activeTransitionDuration - this.transitionElapsedSeconds;
        if (remainingDt >= needed) {
          this.transitionElapsedSeconds = this.activeTransitionDuration;
          remainingDt -= needed;
          this.finishCurrentTransition();
        } else {
          this.transitionElapsedSeconds += remainingDt;
          remainingDt = 0;
          const u = clamp01(this.transitionElapsedSeconds / this.activeTransitionDuration);
          this.interpolateWeights(smoothstep01(u));
        }
      }
    }

    // 2. Advance temporary hold timer & trigger automatic decay back to neutral
    if (!this.isTransitioning && this.holdRemainingSeconds !== null && remainingDt > 0) {
      this.holdRemainingSeconds -= remainingDt;
      if (this.holdRemainingSeconds <= 0) {
        const carryDt = -this.holdRemainingSeconds;
        const decayDuration =
          this.pendingDecayDurationSeconds ?? this.transitionDurationSeconds;
        this.holdRemainingSeconds = null;
        this.pendingDecayDurationSeconds = null;

        this.activeEmotion = 'neutral';
        this.targetIntensity = 0;
        this.activePriority = 0;
        this.startTransitionTo({}, decayDuration);
        this.emitSnapshotIfChanged();

        if (carryDt > 0 && this.isTransitioning) {
          if (this.activeTransitionDuration <= 0) {
            this.finishCurrentTransition();
          } else if (carryDt >= this.activeTransitionDuration) {
            this.transitionElapsedSeconds = this.activeTransitionDuration;
            this.finishCurrentTransition();
          } else {
            this.transitionElapsedSeconds = carryDt;
            const u = clamp01(this.transitionElapsedSeconds / this.activeTransitionDuration);
            this.interpolateWeights(smoothstep01(u));
          }
        }
      }
    }

    if (targetVrm) {
      this.applyWeightsToVrm(targetVrm);
    }
  }

  public getSnapshot = (): ExpressionStatusSnapshot => {
    return this.cachedSnapshot;
  };

  public subscribe = (listener: ExpressionListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public dispose(): void {
    if (this.vrm) {
      this.clearManagedChannelsOnVrm(this.vrm);
      this.vrm = null;
    }

    for (const ch of this.managedChannels) {
      this.currentWeights.set(ch, 0);
      this.startWeights.set(ch, 0);
      this.targetWeights.set(ch, 0);
    }

    this.activeEmotion = 'neutral';
    this.targetIntensity = 0;
    this.activePriority = 0;
    this.isTransitioning = false;
    this.transitionElapsedSeconds = 0;
    this.holdRemainingSeconds = null;
    this.pendingDecayDurationSeconds = null;
    this.listeners.clear();
  }

  private initializeDefaultCapabilities(): void {
    this.managedChannels = [...STANDARD_EMOTION_PRESETS];
    this.resolvedRecipes.clear();

    for (const emotion of EMOTION_NAMES) {
      this.resolvedRecipes.set(emotion, EMOTION_DEFINITIONS[emotion].fallbackWeights);
    }
    this.supportedEmotions = [...EMOTION_NAMES];

    for (const ch of this.managedChannels) {
      this.currentWeights.set(ch, 0);
      this.startWeights.set(ch, 0);
      this.targetWeights.set(ch, 0);
    }
  }

  private inspectVrmCapabilities(vrm: VRM): void {
    const manager = vrm.expressionManager;
    const nextChannels = new Set<string>();
    const nextRecipes = new Map<EmotionName, Readonly<Record<string, number>>>();
    const nextSupported: EmotionName[] = [];

    const hasChannel = (name: string): boolean => {
      if (FORBIDDEN_BLINK_CHANNELS.has(name) || RESERVED_VISEME_CHANNELS.has(name)) {
        return false;
      }
      return Boolean(manager?.getExpression(name));
    };

    for (const preset of STANDARD_EMOTION_PRESETS) {
      if (hasChannel(preset)) {
        nextChannels.add(preset);
      }
    }

    for (const emotion of EMOTION_NAMES) {
      if (emotion === 'neutral') {
        nextRecipes.set('neutral', {});
        nextSupported.push('neutral');
        continue;
      }

      const def = EMOTION_DEFINITIONS[emotion];

      // 1. Prefer native custom VRM expression if the asset provides one
      let matchedAlias: string | null = null;
      if (def.customAliases) {
        for (const alias of def.customAliases) {
          if (hasChannel(alias)) {
            matchedAlias = alias;
            break;
          }
        }
      }

      if (matchedAlias) {
        nextChannels.add(matchedAlias);
        nextRecipes.set(emotion, { [matchedAlias]: 1.0 });
        nextSupported.push(emotion);
        continue;
      }

      // 2. Otherwise require all constituent fallback VRM presets to be available on this model
      const fallbackEntries = Object.entries(def.fallbackWeights);
      if (
        fallbackEntries.length > 0 &&
        fallbackEntries.every(([channel]) => hasChannel(channel))
      ) {
        for (const [channel] of fallbackEntries) {
          nextChannels.add(channel);
        }
        nextRecipes.set(emotion, def.fallbackWeights);
        nextSupported.push(emotion);
      }
    }

    this.managedChannels = Array.from(nextChannels);
    this.resolvedRecipes = nextRecipes;

    if (!arraysEqual(this.supportedEmotions, nextSupported)) {
      this.supportedEmotions = nextSupported;
    }

    for (const ch of this.managedChannels) {
      if (!this.currentWeights.has(ch)) {
        this.currentWeights.set(ch, 0);
      }
      if (!this.startWeights.has(ch)) {
        this.startWeights.set(ch, 0);
      }
      if (!this.targetWeights.has(ch)) {
        this.targetWeights.set(ch, 0);
      }
    }
  }

  private startTransitionTo(
    nextTargets: Readonly<Record<string, number>>,
    durationSeconds: number,
  ): void {
    for (const ch of this.managedChannels) {
      const liveWeight = this.currentWeights.get(ch) ?? 0;
      const goalWeight = clamp01(nextTargets[ch] ?? 0);
      this.startWeights.set(ch, liveWeight);
      this.targetWeights.set(ch, goalWeight);
    }

    this.transitionElapsedSeconds = 0;
    this.activeTransitionDuration = durationSeconds;
    if (durationSeconds <= 0 && !this.paused) {
      this.finishCurrentTransition();
      if (this.vrm) {
        this.applyWeightsToVrm(this.vrm);
      }
    } else {
      this.isTransitioning = true;
    }
  }

  private interpolateWeights(easedProgress: number): void {
    for (const ch of this.managedChannels) {
      const start = this.startWeights.get(ch) ?? 0;
      const target = this.targetWeights.get(ch) ?? 0;
      const blended = start + (target - start) * easedProgress;
      this.currentWeights.set(ch, clamp01(blended) || 0);
    }
  }

  private finishCurrentTransition(): void {
    for (const ch of this.managedChannels) {
      const target = this.targetWeights.get(ch) ?? 0;
      this.currentWeights.set(ch, target);
      this.startWeights.set(ch, target);
    }
    this.isTransitioning = false;
    this.transitionElapsedSeconds = 0;
  }

  private applyWeightsToVrm(vrm: VRM): void {
    const manager = vrm.expressionManager;
    if (!manager) {
      return;
    }

    for (const ch of this.managedChannels) {
      if (FORBIDDEN_BLINK_CHANNELS.has(ch) || RESERVED_VISEME_CHANNELS.has(ch)) {
        continue;
      }
      const weight = this.currentWeights.get(ch) ?? 0;
      manager.setValue(ch, weight);
    }
  }

  private clearManagedChannelsOnVrm(vrm: VRM): void {
    const manager = vrm.expressionManager;
    if (!manager) {
      return;
    }

    for (const ch of this.managedChannels) {
      if (FORBIDDEN_BLINK_CHANNELS.has(ch) || RESERVED_VISEME_CHANNELS.has(ch)) {
        continue;
      }
      manager.setValue(ch, 0);
    }
  }

  private createSnapshot(): ExpressionStatusSnapshot {
    return {
      activeEmotion: this.activeEmotion,
      targetIntensity: this.targetIntensity,
      priority: this.activePriority,
      transitionDurationSeconds: this.transitionDurationSeconds,
      isPaused: this.paused,
      isTemporary: this.holdRemainingSeconds !== null,
      supportedEmotions: this.supportedEmotions,
    };
  }

  private emitSnapshotIfChanged(): void {
    const isTemporary = this.holdRemainingSeconds !== null;
    const prev = this.cachedSnapshot;
    if (
      prev.activeEmotion === this.activeEmotion &&
      prev.targetIntensity === this.targetIntensity &&
      prev.priority === this.activePriority &&
      prev.transitionDurationSeconds === this.transitionDurationSeconds &&
      prev.isPaused === this.paused &&
      prev.isTemporary === isTemporary &&
      prev.supportedEmotions === this.supportedEmotions
    ) {
      return;
    }

    this.cachedSnapshot = this.createSnapshot();
    for (const listener of this.listeners) {
      listener(this.cachedSnapshot);
    }
  }
}
