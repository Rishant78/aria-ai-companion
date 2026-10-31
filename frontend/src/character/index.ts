export type {
  AvatarController,
  AvatarControllerSlots,
  AvatarLoadState,
  AvatarLoadStatus,
  AvatarModelSummary,
  CameraFraming,
} from './types';
export {
  ATTENTION_STATES,
  AttentionController,
  DEFAULT_ATTENTION_CONFIG,
} from './AttentionController';
export type {
  AttentionConfig,
  AttentionFrameIntent,
  AttentionListener,
  AttentionState,
  AttentionStatusSnapshot,
  ConversationActivityMode,
  EmotionalHeadAccent,
  GestureHeadAccent,
} from './AttentionController';
export { BlinkController, DEFAULT_BLINK_CONFIG } from './BlinkController';
export type { BlinkConfig, BlinkTargetEye } from './BlinkController';
export { BreathingController, DEFAULT_BREATHING_CONFIG } from './BreathingController';
export type {
  AutonomousTorsoOffset,
  BreathingConfig,
  PelvicCounterOffset,
  UpperBodyGestureOffset,
} from './BreathingController';
export {
  DEFAULT_EXPRESSION_CONFIG,
  EMOTION_DEFINITIONS,
  EMOTION_NAMES,
  EMOTION_PRIORITY_VALUES,
  ExpressionController,
} from './ExpressionController';
export type {
  ClearEmotionOptions,
  EmotionName,
  EmotionPriorityInput,
  EmotionPriorityTier,
  ExpressionConfig,
  ExpressionListener,
  ExpressionStatusSnapshot,
  SetEmotionOptions,
} from './ExpressionController';
export { GazeController, MAX_HEAD_ROLL_ANATOMICAL_RAD } from './GazeController';
export type { GazeControllerOptions } from './GazeController';
export {
  ACTIVE_GESTURE_NAMES,
  GESTURE_DEFINITIONS,
  GESTURE_NAMES,
  GESTURE_PRIORITY_VALUES,
  GestureController,
} from './GestureController';
export type {
  ActiveGestureName,
  GestureControllerOptions,
  GestureDefinition,
  GestureListener,
  GestureName,
  GesturePhase,
  GesturePriorityInput,
  GesturePriorityTier,
  GestureStatusSnapshot,
  PlayGestureOptions,
  StopGestureOptions,
} from './GestureController';
export {
  ARM_BONE_NAMES,
  CALIBRATED_LIMB_POSES,
  CANONICAL_FINGER_JOINT_NAMES,
  HAND_SHAPE_LIBRARY,
  LEFT_FINGER_BONE_NAMES,
  RIGHT_FINGER_BONE_NAMES,
  UPPER_LIMB_BONE_NAMES,
  buildLimbPoseQuaternionMap,
  eulerTupleToQuaternion,
  mirrorLeftQuaternionToRight,
} from './HandPoseLibrary';
export type {
  BilateralLimbPoseSpec,
  CalibratedPoseKey,
  CanonicalArmChain,
  CanonicalFingerJointName,
  CanonicalHandShape,
  EulerYXZTuple,
  HandShapePresetName,
  UpperLimbBoneName,
} from './HandPoseLibrary';
export {
  POSTURE_ARCHETYPES,
  POSTURE_NAMES,
  getTransitionDurationSeconds,
  quinticEase,
} from './LowerBodyPoseLibrary';
export type {
  LegPoseTarget,
  PelvicCounterTarget,
  PostureArchetype,
  PostureName,
} from './LowerBodyPoseLibrary';
export {
  DEFAULT_NATURAL_IDLE_CONFIG,
  NaturalIdleController,
} from './NaturalIdleController';
export type {
  AutonomousLowerBodyOffset,
  NaturalIdleConfig,
  NaturalIdleStatusSnapshot,
} from './NaturalIdleController';
export {
  AUTONOMOUS_ACTIVITY_DEFINITIONS,
  AUTONOMOUS_ACTIVITY_NAMES,
  AutonomousActivityEvaluator,
  INACTIVITY_TIER_THRESHOLDS,
} from './AutonomousActivityLibrary';
export type {
  AutonomousActivityDefinition,
  AutonomousActivityName,
  AutonomousActivityPhase,
  EvaluatedActivityFrame,
  InactivityTier,
} from './AutonomousActivityLibrary';
export {
  AutonomousActivityScheduler,
  DEFAULT_AUTONOMOUS_ACTIVITY_CONFIG,
} from './AutonomousActivityScheduler';
export type {
  AutonomousActivityListener,
  AutonomousActivitySchedulerConfig,
  AutonomousActivitySchedulerDependencies,
  AutonomousActivityStatusSnapshot,
  TriggerAutonomousActivityOptions,
} from './AutonomousActivityScheduler';
export {
  MOUTH_PROFILES,
  PROFILE_SPECS,
  RMS_CALIBRATION,
  SPEECH_INTENT_AMPLITUDE_MULTIPLIERS,
  SPEECH_INTENTS,
  SpeechMouthController,
  VISEME_NAMES,
} from './SpeechMouthController';
export type {
  AudioSyncProvider,
  MouthAnimationProfileName,
  ProfileSpec,
  SpeechIntentName,
  StartSpeechOptions,
  VisemeName,
} from './SpeechMouthController';
export { GEMINI_GESTURE_MAP, ReactionDispatcher } from './ReactionDispatcher';
export type {
  AutonomousActivityCoordinator,
  CompanionResponseReactionPayload,
  DispatchReactionOptions,
  DispatchReactionResult,
  ReactionDispatcherContext,
} from './ReactionDispatcher';
export { applyNaturalRestArms, computeAvatarFraming, computeWaistUpFraming } from './framing';
export type { FramingMode } from './framing';
export { disposeVrm, loadCompanionVrm } from './vrmLoader';
export type { LoadCompanionVrmOptions, LoadedVrmResult } from './vrmLoader';
