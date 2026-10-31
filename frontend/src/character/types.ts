import type * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export type FramingMode = 'waist' | 'full';

export type AvatarLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AvatarLoadState {
  status: AvatarLoadStatus;
  /** Download percentage (0..100), or null when byte total is not yet known (indeterminate). */
  progress: number | null;
  errorMessage: string | null;
}

export interface AvatarModelSummary {
  name: string;
  specVersion: '1.0' | '0.0';
  authors: string[];
  presetExpressions: string[];
  customExpressions: string[];
  allExpressions: string[];
  springBoneJointCount?: number;
  springBoneColliderCount?: number;
}

/**
 * Modular per-frame controller contract prepared for Milestone 2+
 * (e.g., ExpressionController, GazeController, IdleController, LipSyncController).
 */
export interface AvatarController {
  readonly id: string;
  attach?: (vrm: VRM, camera: THREE.PerspectiveCamera) => void;
  update: (vrm: VRM, deltaTime: number, elapsedTime: number) => void;
  dispose?: () => void;
}

/**
 * Named controller slots so future expression, gaze, and idle systems
 * can plug into AvatarScene without modifying scene/rendering lifecycle code.
 */
export interface AvatarControllerSlots {
  orchestrator?: AvatarController;
  lowerBody?: AvatarController;
  gesture?: AvatarController;
  idle?: AvatarController;
  gaze?: AvatarController;
  expression?: AvatarController;
  speechMouth?: AvatarController;
  extensions?: AvatarController[];
}

export interface CameraFraming {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

