import {
  EMOTION_NAMES,
  type EmotionName,
  type ExpressionController,
} from './ExpressionController';
import {
  ACTIVE_GESTURE_NAMES,
  type ActiveGestureName,
  type GestureController,
} from './GestureController';
import type { AttentionController } from './AttentionController';
import type { NaturalIdleController } from './NaturalIdleController';
import type {
  MouthAnimationProfileName,
  SpeechIntentName,
  SpeechMouthController,
} from './SpeechMouthController';

export interface AutonomousActivityCoordinator {
  notifyUserInteraction(): void;
  interruptActivity(releaseSeconds?: number): void;
}

export interface ReactionDispatcherContext {
  attention: AttentionController;
  expression: ExpressionController;
  gesture: GestureController;
  speechMouth: SpeechMouthController;
  naturalIdle?: NaturalIdleController;
  activityScheduler?: AutonomousActivityCoordinator;
}

export interface CompanionResponseReactionPayload {
  session_id?: string;
  response_text: string;
  emotion: string;
  emotion_intensity: number;
  gesture?: string | null;
  gesture_intensity?: number;
  speech_intent?: string;
  mouth_animation_profile?: string;
  audio_duration?: number | null;
  created_at?: string;
}

export interface DispatchReactionOptions {
  deferSpeechMouth?: boolean;
}

export interface DispatchReactionResult {
  accepted: boolean;
  mappedEmotion: EmotionName;
  clampedEmotionIntensity: number;
  mappedGesture: ActiveGestureName | null;
  clampedGestureIntensity: number;
  speechDurationSeconds: number;
}

/**
 * Mapping table from Gemini backend gesture identifiers to GestureController ActiveGestureName.
 */
export const GEMINI_GESTURE_MAP: Readonly<Record<string, ActiveGestureName>> = {
  wave: 'wave',
  greeting: 'open_hand_greeting',
  open_hand_greeting: 'open_hand_greeting',
  explain: 'explaining',
  explaining: 'explaining',
  explaining_hands: 'explaining',
  think: 'thinking',
  thinking: 'thinking',
  shrug: 'shrug',
  laugh: 'laughing',
  laughing: 'laughing',
  shy: 'shy_hands_together',
  shy_hands_together: 'shy_hands_together',
  reassure: 'reassuring',
  reassuring: 'reassuring',
  gentle_reassuring: 'reassuring',
};

export class ReactionDispatcher {
  private context: ReactionDispatcherContext;
  private isProcessingSpeech = false;

  constructor(context: ReactionDispatcherContext) {
    this.context = context;
  }

  public updateContext(context: ReactionDispatcherContext): void {
    this.context = context;
  }

  /**
   * Called immediately when the user submits a message in the chat input.
   * Enters LISTENING state, recovers attention, gracefully interrupts any background
   * autonomous activity, and stops any lingering speech articulation without abruptly
   * cancelling an in-flight conversational gesture.
   */
  public onUserMessageSubmitted(): void {
    if (this.isProcessingSpeech) {
      this.cancelCurrentSpeech();
    }
    this.context.activityScheduler?.notifyUserInteraction();
    this.context.naturalIdle?.setConversationMode('LISTENING');
    this.context.attention.setConversationMode('LISTENING');
    this.context.attention.setEmotionalHeadAccent(null);
    this.context.attention.onUserMessage();
  }

  /**
   * Called while the backend LLM is generating a response.
   * Maintains the attentive listening/thinking stance without starting speech animations.
   */
  public onWaitingForResponse(): void {
    this.context.activityScheduler?.notifyUserInteraction();
    this.context.naturalIdle?.setConversationMode('LISTENING');
    this.context.attention.setConversationMode('LISTENING');
  }

  /**
   * Dispatches a validated response payload from the backend to the avatar controllers.
   * Coordinates emotion, gesture, mouth articulation, and SPEAKING attention state.
   */
  public dispatchReaction(
    payload: CompanionResponseReactionPayload,
    options: DispatchReactionOptions = {},
  ): DispatchReactionResult {
    // 1. Cancel previous active speech cleanly if still running
    if (this.isProcessingSpeech) {
      this.cancelCurrentSpeech();
    }

    // 2. Map and validate emotion
    const rawEmotion = (payload.emotion || 'neutral').toLowerCase().trim();
    const mappedEmotion: EmotionName = EMOTION_NAMES.includes(rawEmotion as EmotionName)
      ? (rawEmotion as EmotionName)
      : 'neutral';

    const clampedEmotionIntensity = Math.max(
      0.0,
      Math.min(1.0, Number.isFinite(payload.emotion_intensity) ? payload.emotion_intensity : 0.7),
    );

    // 3. Map and validate gesture
    let mappedGesture: ActiveGestureName | null = null;
    let clampedGestureIntensity = 0.0;

    if (payload.gesture && typeof payload.gesture === 'string') {
      const normalizedGesture = payload.gesture.toLowerCase().trim();
      const target = GEMINI_GESTURE_MAP[normalizedGesture];
      if (target && ACTIVE_GESTURE_NAMES.includes(target)) {
        mappedGesture = target;
        clampedGestureIntensity = Math.max(
          0.0,
          Math.min(
            1.0,
            Number.isFinite(payload.gesture_intensity) ? payload.gesture_intensity! : 0.8,
          ),
        );
      }
    }

    // 4. Map profile and intent
    const rawProfile = (payload.mouth_animation_profile || 'soft_conversation').toLowerCase().trim();
    const profile: MouthAnimationProfileName = (
      ['soft_conversation', 'energetic', 'gentle', 'deliberate', 'minimal'] as const
    ).includes(rawProfile as MouthAnimationProfileName)
      ? (rawProfile as MouthAnimationProfileName)
      : 'soft_conversation';

    const rawIntent = (payload.speech_intent || 'conversational').toLowerCase().trim();
    const speechIntent: SpeechIntentName = (
      [
        'conversational',
        'excited',
        'playful',
        'gentle',
        'reassuring',
        'curious',
        'serious',
        'surprised',
      ] as const
    ).includes(rawIntent as SpeechIntentName)
      ? (rawIntent as SpeechIntentName)
      : 'conversational';

    this.isProcessingSpeech = true;

    // 5. Enter SPEAKING attention state & suppress autonomous full-body activities
    this.context.activityScheduler?.notifyUserInteraction();
    this.context.naturalIdle?.setConversationMode('SPEAKING');
    this.context.attention.setConversationMode('SPEAKING');

    // 6. Start mouth articulation (unless deferred to align with audio playback scheduling)
    const effectiveSpeechDuration =
      payload.audio_duration && payload.audio_duration > 0
        ? payload.audio_duration
        : null;

    let speechDuration = 0;
    if (!options.deferSpeechMouth) {
      speechDuration = this.context.speechMouth.startSpeech(payload.response_text, {
        profile,
        speechIntent,
        intensity: 1.0,
        audioDuration: effectiveSpeechDuration,
        onComplete: () => {
          this.handleSpeechComplete();
        },
      });
    } else {
      speechDuration = effectiveSpeechDuration ?? 3.0;
    }

    // 7. Apply emotional expression
    // Set holdSeconds so the expression lingers slightly past speech completion before decaying
    const holdDuration = effectiveSpeechDuration ?? speechDuration;
    this.context.expression.setEmotion(mappedEmotion, clampedEmotionIntensity, {
      priority: 'conversation',
      holdSeconds: Math.max(1.5, holdDuration + 0.8),
    });

    // Coordinated emotional head tilt for expressive reactions:
    // Curiosity and confusion produce pronounced, recognizable head tilts (~0.14 - 0.20 rad / 8° - 11.5°);
    // playful produces a jaunty cheerful tilt (~0.08 - 0.12 rad / 4.6° - 6.9°);
    // ordinary emotions (neutral, sad, relaxed, etc.) do NOT force a tilt.
    const isCurious = mappedEmotion === 'curious' || speechIntent === 'curious';
    const isConfused = mappedEmotion === 'confused';
    const isPlayful = speechIntent === 'playful';

    if (isCurious) {
      const sign = this.context.attention.nextAlternatingSign();
      this.context.attention.setEmotionalHeadAccent({
        rollRad: sign * (0.13 + 0.05 * clampedEmotionIntensity),
        pitchRad: -0.025 * clampedEmotionIntensity,
        holdSeconds: Math.max(2.2, holdDuration + 0.8),
      });
    } else if (isConfused) {
      const sign = this.context.attention.nextAlternatingSign();
      this.context.attention.setEmotionalHeadAccent({
        rollRad: sign * (0.14 + 0.06 * clampedEmotionIntensity),
        pitchRad: 0.022 * clampedEmotionIntensity,
        holdSeconds: Math.max(2.2, holdDuration + 0.8),
      });
    } else if (isPlayful) {
      const sign = this.context.attention.nextAlternatingSign();
      this.context.attention.setEmotionalHeadAccent({
        rollRad: sign * (0.08 + 0.04 * clampedEmotionIntensity),
        pitchRad: -0.015,
        holdSeconds: Math.max(1.8, holdDuration + 0.6),
      });
    } else {
      this.context.attention.setEmotionalHeadAccent(null);
    }

    // 8. Play optional upper-body gesture (seamlessly blends from live pose if replacing an
    //    active gesture; never cancels an in-flight gesture when payload gesture is null/0).
    if (mappedGesture && clampedGestureIntensity > 0) {
      this.context.gesture.playGesture(mappedGesture, {
        priority: 'conversational',
        intensity: clampedGestureIntensity,
        bypassCooldown: true,
      });
    }

    return {
      accepted: true,
      mappedEmotion,
      clampedEmotionIntensity,
      mappedGesture,
      clampedGestureIntensity,
      speechDurationSeconds: speechDuration,
    };
  }

  /**
   * Called when speech articulation naturally finishes.
   * Stops mouth and returns attention to user while allowing any finite conversational
   * gesture (`attack -> sustain -> release -> idle`) to complete naturally without truncation.
   */
  public handleSpeechComplete(): void {
    if (!this.isProcessingSpeech) {
      return;
    }
    this.isProcessingSpeech = false;
    this.context.speechMouth.stopSpeech();
    this.context.attention.setEmotionalHeadAccent(null);
    this.context.naturalIdle?.setConversationMode('NONE');
    this.context.attention.returnToAttentive();
  }

  /**
   * Cancels any active reaction gracefully and returns controllers to attentive rest.
   */
  public cancel(): void {
    this.cancelCurrentSpeech();
    this.context.activityScheduler?.interruptActivity();
    this.context.gesture.stopGesture({ immediate: false });
    this.context.expression.clearEmotion();
    this.context.attention.setEmotionalHeadAccent(null);
    this.context.naturalIdle?.setConversationMode('NONE');
    this.context.attention.returnToAttentive();
  }

  private cancelCurrentSpeech(): void {
    this.isProcessingSpeech = false;
    this.context.speechMouth.cancel();
  }
}

