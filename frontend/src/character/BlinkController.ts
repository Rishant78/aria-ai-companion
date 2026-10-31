import type { VRM } from '@pixiv/three-vrm';
import type { AvatarController } from './types';

export type BlinkTargetEye = 'both' | 'left' | 'right';

export interface BlinkConfig {
  /** Randomized [min, max] seconds between natural automatic blinks (default: [2.6, 5.8]). */
  intervalRange: readonly [number, number];
  /** Duration of smooth eyelid closure in seconds (default: 0.068). */
  closeDurationSeconds: number;
  /** Duration eyelids remain fully closed at peak blink in seconds (default: 0.024). */
  holdDurationSeconds: number;
  /** Duration of smooth eyelid reopening in seconds (default: 0.115). */
  openDurationSeconds: number;
  /** Brief open pause between pulses of a natural double blink in seconds (default: 0.085). */
  doubleBlinkGapSeconds: number;
  /** Probability (0..1) of an automatic blink becoming a natural double blink (default: 0.14). */
  doubleBlinkProbability: number;
  /** Probability (0..1) of triggering a blink on a large gaze saccade hint (default: 0.6). */
  saccadeBlinkProbability: number;
}

export const DEFAULT_BLINK_CONFIG: BlinkConfig = {
  intervalRange: [2.6, 5.8],
  closeDurationSeconds: 0.068,
  holdDurationSeconds: 0.024,
  openDurationSeconds: 0.115,
  doubleBlinkGapSeconds: 0.085,
  doubleBlinkProbability: 0.14,
  saccadeBlinkProbability: 0.6,
};

type BlinkSequenceState = 'idle' | 'blinking' | 'double_gap';

function randomBetween(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

function randomFromRange(range: readonly [number, number]): number {
  return randomBetween(range[0], range[1]);
}

/**
 * Dedicated, single-owner VRM BlinkController.
 *
 * Exclusively owns VRM blink expression presets (`blink`, `blinkLeft`, `blinkRight`),
 * prevents overlapping blink animations, and coexists non-destructively with future
 * emotional and lip-sync expressions.
 */
export class BlinkController implements AvatarController {
  public readonly id = 'blink';

  private config: BlinkConfig;
  private enabled = true;
  private paused = false;

  private vrm: VRM | null = null;
  private hasUnifiedBlink = false;
  private hasLeftBlink = false;
  private hasRightBlink = false;

  private sequenceState: BlinkSequenceState = 'idle';
  private activeTargetEye: BlinkTargetEye = 'both';
  private phaseElapsedSeconds = 0;
  private pendingSecondBlink = false;
  private cooldownSeconds: number;
  private currentWeight = 0;

  constructor(initialConfig: Partial<BlinkConfig> = {}) {
    this.config = {
      ...DEFAULT_BLINK_CONFIG,
      ...initialConfig,
    };
    this.cooldownSeconds = randomFromRange(this.config.intervalRange);
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (!enabled) {
      this.sequenceState = 'idle';
      this.phaseElapsedSeconds = 0;
      this.pendingSecondBlink = false;
      this.currentWeight = 0;
      if (this.vrm) {
        this.clearBlinkExpressions(this.vrm);
      }
    }
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public get isBlinking(): boolean {
    return this.sequenceState !== 'idle';
  }

  public get blinkWeight(): number {
    return this.currentWeight;
  }

  public getConfig(): Readonly<BlinkConfig> {
    return this.config;
  }

  public updateConfig(patch: Partial<BlinkConfig>): void {
    this.config = {
      ...this.config,
      ...patch,
    };
  }

  /**
   * Triggers a single immediate blink unless paused or another blink is already active
   * (preventing overlapping blink animations). Works even if auto-blink is toggled off
   * when invoked explicitly as a manual development test action, unless paused.
   */
  public triggerManualBlink(targetEye: BlinkTargetEye = 'both'): boolean {
    if (this.paused || this.sequenceState !== 'idle') {
      return false;
    }
    this.startBlinkSequence(targetEye, false);
    return true;
  }

  /**
   * Accepts a non-binding saccade hint from AttentionController/GazeController on large
   * gaze shifts so eye turns are naturally accompanied by physiological blinks without
   * GazeController ever touching blink expression values.
   */
  public notifySaccade(): boolean {
    if (!this.enabled || this.paused || this.sequenceState !== 'idle') {
      return false;
    }
    if (Math.random() < this.config.saccadeBlinkProbability) {
      this.startBlinkSequence('both', false);
      return true;
    }
    return false;
  }

  public attach(vrm: VRM): void {
    this.vrm = vrm;
    this.inspectBlinkCapabilities(vrm);
    this.clearBlinkExpressions(vrm);
  }

  public update(vrm: VRM, deltaTime: number): void {
    if (this.vrm !== vrm) {
      this.vrm = vrm;
      this.inspectBlinkCapabilities(vrm);
    }

    if (this.paused || deltaTime <= 0) {
      return;
    }

    // If auto-blinking is disabled and no manual blink is running, keep blink weights at 0
    if (!this.enabled && this.sequenceState === 'idle') {
      this.currentWeight = 0;
      return;
    }

    const {
      closeDurationSeconds,
      holdDurationSeconds,
      openDurationSeconds,
      doubleBlinkGapSeconds,
    } = this.config;
    const singlePulseDuration =
      closeDurationSeconds + holdDurationSeconds + openDurationSeconds;

    if (this.sequenceState === 'blinking') {
      this.phaseElapsedSeconds += deltaTime;
      const t = this.phaseElapsedSeconds;

      if (t < closeDurationSeconds) {
        const u = closeDurationSeconds > 0 ? t / closeDurationSeconds : 1;
        this.currentWeight = u * u * (3 - 2 * u);
      } else if (t < closeDurationSeconds + holdDurationSeconds) {
        this.currentWeight = 1.0;
      } else if (t < singlePulseDuration) {
        const u =
          openDurationSeconds > 0
            ? (t - closeDurationSeconds - holdDurationSeconds) / openDurationSeconds
            : 1;
        this.currentWeight = 1.0 - u * (2 - u);
      } else {
        this.currentWeight = 0;
        if (this.pendingSecondBlink) {
          this.pendingSecondBlink = false;
          this.sequenceState = 'double_gap';
          this.phaseElapsedSeconds = 0;
        } else {
          this.sequenceState = 'idle';
          this.phaseElapsedSeconds = 0;
        }
      }
    } else if (this.sequenceState === 'double_gap') {
      this.currentWeight = 0;
      this.phaseElapsedSeconds += deltaTime;
      if (this.phaseElapsedSeconds >= doubleBlinkGapSeconds) {
        this.sequenceState = 'blinking';
        this.phaseElapsedSeconds = 0;
      }
    } else if (this.enabled) {
      this.currentWeight = 0;
      this.cooldownSeconds -= deltaTime;
      if (this.cooldownSeconds <= 0) {
        const isDouble = Math.random() < this.config.doubleBlinkProbability;
        this.startBlinkSequence('both', isDouble);
      }
    }

    this.applyBlinkExpressions(vrm, this.currentWeight);
  }

  public dispose(): void {
    if (this.vrm) {
      this.clearBlinkExpressions(this.vrm);
      this.vrm = null;
    }
    this.sequenceState = 'idle';
    this.phaseElapsedSeconds = 0;
    this.pendingSecondBlink = false;
    this.currentWeight = 0;
  }

  private startBlinkSequence(targetEye: BlinkTargetEye, allowDouble: boolean): void {
    this.sequenceState = 'blinking';
    this.activeTargetEye = targetEye;
    this.phaseElapsedSeconds = 0;
    this.pendingSecondBlink = allowDouble;
    this.cooldownSeconds = randomFromRange(this.config.intervalRange);
  }

  private inspectBlinkCapabilities(vrm: VRM): void {
    const manager = vrm.expressionManager;
    this.hasUnifiedBlink = Boolean(manager?.getExpression('blink'));
    this.hasLeftBlink = Boolean(manager?.getExpression('blinkLeft'));
    this.hasRightBlink = Boolean(manager?.getExpression('blinkRight'));
  }

  /**
   * Computes non-destructive coexistence attenuation so blinks never overwrite or clip
   * active emotional expressions:
   * - `happy` (`Fcl_ALL_Joy`) closes eyelids into joyful crescents (~64% lid projection), so
   *   blink amplitude scales down proportionally (`1 - happyWeight`) to prevent mesh folding.
   * - `relaxed` (`Fcl_ALL_Fun`, ~11% curve) and `sad` (`Fcl_ALL_Sorrow`, ~20% droop) keep eyes
   *   mostly open, so blinks are only lightly softened (`0.25` / `0.20`) to remain natural and
   *   visible without over-closing eyelids.
   * - Any VRM expression declaring `overrideBlink` (`overrideBlinkAmount`) is also honored.
   */
  private computeEmotionAttenuation(vrm: VRM): number {
    const manager = vrm.expressionManager;
    if (!manager) {
      return 1;
    }

    const happyWeight = manager.getValue('happy') ?? 0;
    const relaxedWeight = manager.getValue('relaxed') ?? 0;
    const sadWeight = manager.getValue('sad') ?? 0;

    let overrideAmount = Math.max(
      happyWeight,
      relaxedWeight * 0.25,
      sadWeight * 0.2,
    );

    const registered = manager.expressions;
    if (Array.isArray(registered)) {
      for (const expr of registered) {
        if (
          expr.expressionName !== 'blink' &&
          expr.expressionName !== 'blinkLeft' &&
          expr.expressionName !== 'blinkRight' &&
          typeof expr.overrideBlinkAmount === 'number'
        ) {
          overrideAmount = Math.max(overrideAmount, expr.overrideBlinkAmount);
        }
      }
    }

    return Math.max(0, Math.min(1, 1 - overrideAmount));
  }

  private applyBlinkExpressions(vrm: VRM, rawWeight: number): void {
    const manager = vrm.expressionManager;
    if (!manager) {
      return;
    }

    const effectiveWeight = rawWeight * this.computeEmotionAttenuation(vrm);

    if (this.activeTargetEye === 'left') {
      if (this.hasUnifiedBlink) manager.setValue('blink', 0);
      if (this.hasRightBlink) manager.setValue('blinkRight', 0);
      if (this.hasLeftBlink) {
        manager.setValue('blinkLeft', effectiveWeight);
      } else if (this.hasUnifiedBlink) {
        manager.setValue('blink', effectiveWeight);
      }
      return;
    }

    if (this.activeTargetEye === 'right') {
      if (this.hasUnifiedBlink) manager.setValue('blink', 0);
      if (this.hasLeftBlink) manager.setValue('blinkLeft', 0);
      if (this.hasRightBlink) {
        manager.setValue('blinkRight', effectiveWeight);
      } else if (this.hasUnifiedBlink) {
        manager.setValue('blink', effectiveWeight);
      }
      return;
    }

    // Standard bilateral blink: prefer unified 'blink', otherwise drive 'blinkLeft' + 'blinkRight'
    if (this.hasUnifiedBlink) {
      manager.setValue('blink', effectiveWeight);
      if (this.hasLeftBlink) manager.setValue('blinkLeft', 0);
      if (this.hasRightBlink) manager.setValue('blinkRight', 0);
    } else {
      if (this.hasLeftBlink) manager.setValue('blinkLeft', effectiveWeight);
      if (this.hasRightBlink) manager.setValue('blinkRight', effectiveWeight);
    }
  }

  private clearBlinkExpressions(vrm: VRM): void {
    const manager = vrm.expressionManager;
    if (!manager) {
      return;
    }
    if (this.hasUnifiedBlink) manager.setValue('blink', 0);
    if (this.hasLeftBlink) manager.setValue('blinkLeft', 0);
    if (this.hasRightBlink) manager.setValue('blinkRight', 0);
  }
}

