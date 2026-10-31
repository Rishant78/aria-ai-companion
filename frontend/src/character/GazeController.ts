import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { AttentionController } from './AttentionController';
import type { AttentionConfig } from './AttentionController';
import type { AvatarController } from './types';

export interface GazeControllerOptions {
  /** Existing AttentionController instance to integrate with; creates one if omitted. */
  attention?: AttentionController;
  /** Optional configuration used when GazeController creates its own AttentionController. */
  attentionConfig?: Partial<AttentionConfig>;
  /**
   * Optional callback notified on large gaze saccades so BlinkController (the sole
   * owner of blink expression weights) may accompany large turns with a natural blink.
   */
  onSaccadeBlinkSuggestion?: () => void;
  /**
   * Scales residual eye degrees fed into VRM lookAt range maps so subtle saccades
   * remain visually readable while staying safely within VRM eyelid bounds (default: 2.2).
   */
  eyePresenceScale?: number;
}

function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  const alpha = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * alpha;
}

/**
 * Maximum safe anatomical head roll limit in radians (~16.0 degrees).
 * Preserves realistic cervical spine biomechanics and prevents unnatural neck distortions.
 */
export const MAX_HEAD_ROLL_ANATOMICAL_RAD = 0.28;

/**
 * Unified Gaze + Neck/Head Coordinator integrated with AttentionController.
 *
 * Drives both VRM eye lookAt (`vrm.lookAt`) and normalized `neck` / `head` bones
 * from a single directional target with vestibulo-ocular reflex (VOR) residual
 * compensation so eyes and head never compete or double-rotate.
 */
export class GazeController implements AvatarController {
  public readonly id = 'gaze';
  public readonly attention: AttentionController;

  private readonly ownsAttention: boolean;
  private onSaccadeBlinkSuggestion?: () => void;
  private readonly eyePresenceScale: number;

  private vrm: VRM | null = null;
  private camera: THREE.PerspectiveCamera | null = null;

  private readonly eyeOriginLocal = new THREE.Vector3(0, 1.4, 0.02);
  private readonly neckRestQuat = new THREE.Quaternion();
  private readonly headRestQuat = new THREE.Quaternion();

  // Reusable scratch objects (zero per-frame heap allocations)
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpQuat = new THREE.Quaternion();

  // Smooth damped eye & head state
  private currentEyeYawDeg = 0;
  private currentEyePitchDeg = 0;
  private currentHeadYawRad = 0;
  private currentHeadPitchRad = 0;
  private currentHeadRollRad = 0;

  constructor(options: GazeControllerOptions = {}) {
    if (options.attention) {
      this.attention = options.attention;
      this.ownsAttention = false;
    } else {
      this.attention = new AttentionController(options.attentionConfig);
      this.ownsAttention = true;
    }
    this.onSaccadeBlinkSuggestion = options.onSaccadeBlinkSuggestion;
    this.eyePresenceScale = options.eyePresenceScale ?? 2.2;
  }

  public setSaccadeBlinkHandler(handler: (() => void) | undefined): void {
    this.onSaccadeBlinkSuggestion = handler;
  }

  public pause(): void {
    this.attention.pause();
  }

  public resume(): void {
    this.attention.resume();
  }

  public returnToAttentive(): void {
    this.attention.returnToAttentive();
  }

  public attach(vrm: VRM, camera: THREE.PerspectiveCamera): void {
    this.vrm = vrm;
    this.camera = camera;

    vrm.scene.updateMatrixWorld(true);

    // Measure eye midpoint in vrm.scene local coordinates for accurate user-direction tracking
    const leftEye = vrm.humanoid.getRawBoneNode('leftEye');
    const rightEye = vrm.humanoid.getRawBoneNode('rightEye');
    const headRaw = vrm.humanoid.getRawBoneNode('head');

    if (leftEye && rightEye) {
      leftEye.getWorldPosition(this.tmpVecA);
      rightEye.getWorldPosition(this.tmpVecB);
      this.eyeOriginLocal
        .copy(this.tmpVecA)
        .add(this.tmpVecB)
        .multiplyScalar(0.5);
      vrm.scene.worldToLocal(this.eyeOriginLocal);
    } else if (headRaw) {
      headRaw.getWorldPosition(this.eyeOriginLocal);
      vrm.scene.worldToLocal(this.eyeOriginLocal);
      this.eyeOriginLocal.y += 0.06;
    } else {
      this.eyeOriginLocal.set(0, 1.4, 0.02);
    }

    const neckNorm = vrm.humanoid.getNormalizedBoneNode('neck');
    const headNorm = vrm.humanoid.getNormalizedBoneNode('head');
    if (neckNorm) {
      this.neckRestQuat.copy(neckNorm.quaternion);
    } else {
      this.neckRestQuat.identity();
    }
    if (headNorm) {
      this.headRestQuat.copy(headNorm.quaternion);
    } else {
      this.headRestQuat.identity();
    }

    if (vrm.lookAt) {
      vrm.lookAt.target = null;
      vrm.lookAt.autoUpdate = false;
      vrm.lookAt.reset();
    }

    this.currentEyeYawDeg = 0;
    this.currentEyePitchDeg = 0;
    this.currentHeadYawRad = 0;
    this.currentHeadPitchRad = 0;
    this.currentHeadRollRad = 0;
  }

  public update(vrm: VRM, deltaTime: number): void {
    if (this.attention.isPaused || deltaTime <= 0) {
      return;
    }

    const intent = this.attention.update(deltaTime);

    // 1. Compute camera (user) direction in avatar local space (+Z forward, +Y up, +X left)
    let userYawDeg = 0;
    let userPitchDeg = 0;
    let frontWeight = 1.0;

    if (this.camera) {
      this.tmpVecA.copy(this.camera.position);
      vrm.scene.worldToLocal(this.tmpVecA);
      this.tmpVecB.copy(this.tmpVecA).sub(this.eyeOriginLocal);

      const horizDist = Math.hypot(this.tmpVecB.x, this.tmpVecB.z);
      if (horizDist > 1e-4) {
        const rawCamYawDeg = THREE.MathUtils.radToDeg(
          Math.atan2(this.tmpVecB.x, this.tmpVecB.z),
        );
        const rawCamPitchDeg = THREE.MathUtils.radToDeg(
          Math.atan2(this.tmpVecB.y, horizDist),
        );

        // Smoothly fade camera tracking if user orbits behind the avatar (> 65 deg..105 deg)
        const absYaw = Math.abs(rawCamYawDeg);
        frontWeight =
          absYaw <= 65
            ? 1
            : absYaw >= 105
              ? 0
              : 1 - (absYaw - 65) / (105 - 65);

        userYawDeg = THREE.MathUtils.clamp(rawCamYawDeg, -34, 34) * frontWeight;
        userPitchDeg = THREE.MathUtils.clamp(rawCamPitchDeg, -18, 18) * frontWeight;
      }
    }

    // 2. Unified desired gaze angle (user eye-contact baseline + AttentionController offset)
    const desiredGazeYawDeg = THREE.MathUtils.clamp(
      userYawDeg + intent.gazeOffsetYawDeg,
      -36,
      36,
    );
    const desiredGazePitchDeg = THREE.MathUtils.clamp(
      userPitchDeg + intent.gazeOffsetPitchDeg,
      -24,
      20,
    );

    // 3. Coordinated neck/head target (normalized Euler 'YXZ': +x nods down, +y turns left)
    const desiredHeadYawRad = THREE.MathUtils.degToRad(
      desiredGazeYawDeg * intent.headFollowYaw,
    );
    const desiredHeadPitchRad =
      THREE.MathUtils.degToRad(-desiredGazePitchDeg * intent.headFollowPitch) +
      intent.headNodPitchRad;

    // Camera-relative coupled head roll:
    // Natural human biomechanics slightly bank the head during lateral tracking,
    // coordinated smoothly with both head yaw and pitch.
    let camCoupledRollRad = 0;
    if (this.camera && Math.abs(userYawDeg) > 0.5) {
      const userYawRad = THREE.MathUtils.degToRad(userYawDeg);
      const userPitchRad = THREE.MathUtils.degToRad(userPitchDeg);
      camCoupledRollRad =
        (-Math.sin(userYawRad) * 0.052 - Math.sin(userYawRad) * Math.sin(userPitchRad) * 0.035) *
        frontWeight;
    }

    // Combine autonomous/emotional/gesture head roll with camera-relative roll, strictly clamped to anatomical limit
    const desiredHeadRollRad = THREE.MathUtils.clamp(
      intent.headTiltRollRad + camCoupledRollRad,
      -MAX_HEAD_ROLL_ANATOMICAL_RAD,
      MAX_HEAD_ROLL_ANATOMICAL_RAD,
    );

    // 4. Frame-rate-independent damping: eyes lead briskly, head follows smoothly
    const eyeLambda = intent.isRecovering ? 20.0 : 14.5;
    const headLambda = intent.isRecovering ? 8.2 : 4.6;

    this.currentEyeYawDeg = dampScalar(
      this.currentEyeYawDeg,
      desiredGazeYawDeg,
      eyeLambda,
      deltaTime,
    );
    this.currentEyePitchDeg = dampScalar(
      this.currentEyePitchDeg,
      desiredGazePitchDeg,
      eyeLambda,
      deltaTime,
    );

    this.currentHeadYawRad = dampScalar(
      this.currentHeadYawRad,
      desiredHeadYawRad,
      headLambda,
      deltaTime,
    );
    this.currentHeadPitchRad = dampScalar(
      this.currentHeadPitchRad,
      desiredHeadPitchRad,
      headLambda,
      deltaTime,
    );
    this.currentHeadRollRad = dampScalar(
      this.currentHeadRollRad,
      desiredHeadRollRad,
      headLambda * 0.85,
      deltaTime,
    );

    // 5. Distribute coordinated rotation across neck (35%) and head (65%)
    const neckNode = vrm.humanoid.getNormalizedBoneNode('neck');
    const headNode = vrm.humanoid.getNormalizedBoneNode('head');

    if (neckNode && headNode) {
      this.tmpEuler.set(
        this.currentHeadPitchRad * 0.35,
        this.currentHeadYawRad * 0.35,
        this.currentHeadRollRad * 0.3,
        'YXZ',
      );
      this.tmpQuat.setFromEuler(this.tmpEuler);
      neckNode.quaternion.copy(this.neckRestQuat).multiply(this.tmpQuat);

      this.tmpEuler.set(
        this.currentHeadPitchRad * 0.65,
        this.currentHeadYawRad * 0.65,
        this.currentHeadRollRad * 0.7,
        'YXZ',
      );
      this.tmpQuat.setFromEuler(this.tmpEuler);
      headNode.quaternion.copy(this.headRestQuat).multiply(this.tmpQuat);
    } else if (headNode) {
      this.tmpEuler.set(
        this.currentHeadPitchRad,
        this.currentHeadYawRad,
        this.currentHeadRollRad,
        'YXZ',
      );
      this.tmpQuat.setFromEuler(this.tmpEuler);
      headNode.quaternion.copy(this.headRestQuat).multiply(this.tmpQuat);
    }

    // 6. Vestibulo-ocular residual eye angle (eyes compensate for head turn without double-rotating)
    // Note: VRMLookAtyaw/pitch follow Euler('YXZ') degrees on +Z: +yaw = left (+X), +pitch = down (-Y), -pitch = up (+Y).
    if (vrm.lookAt) {
      const headWorldYawDeg = THREE.MathUtils.radToDeg(this.currentHeadYawRad);
      const headWorldPitchUpDeg = -THREE.MathUtils.radToDeg(this.currentHeadPitchRad);

      const residualYawDeg = this.currentEyeYawDeg - headWorldYawDeg;
      const residualPitchUpDeg = this.currentEyePitchDeg - headWorldPitchUpDeg;

      vrm.lookAt.autoUpdate = false;
      vrm.lookAt.yaw = THREE.MathUtils.clamp(
        residualYawDeg * this.eyePresenceScale,
        -72,
        72,
      );
      vrm.lookAt.pitch = THREE.MathUtils.clamp(
        -residualPitchUpDeg * this.eyePresenceScale,
        -68,
        68,
      );
    }

    // 7. Forward saccade blink hint to dedicated BlinkController (GazeController never writes blink expressions)
    if (intent.saccadeBlinkSuggested) {
      this.onSaccadeBlinkSuggestion?.();
    }
  }

  public dispose(): void {
    if (this.vrm) {
      const neckNode = this.vrm.humanoid.getNormalizedBoneNode('neck');
      const headNode = this.vrm.humanoid.getNormalizedBoneNode('head');
      if (neckNode) {
        neckNode.quaternion.copy(this.neckRestQuat);
      }
      if (headNode) {
        headNode.quaternion.copy(this.headRestQuat);
      }
      if (this.vrm.lookAt) {
        this.vrm.lookAt.reset();
      }
      this.vrm = null;
    }

    this.camera = null;
  }

  public destroy(): void {
    this.dispose();
    if (this.ownsAttention) {
      this.attention.dispose();
    }
  }
}
