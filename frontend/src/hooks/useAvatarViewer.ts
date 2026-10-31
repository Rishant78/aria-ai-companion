import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VRM } from '@pixiv/three-vrm';
import {
  computeAvatarFraming,
  disposeVrm,
  loadCompanionVrm,
} from '../character';
import type {
  AvatarController,
  AvatarControllerSlots,
  AvatarLoadState,
  AvatarModelSummary,
  CameraFraming,
  FramingMode,
} from '../character';

const PORTRAIT_FOV_DEG = 28;
const MAX_DELTA_SECONDS = 0.05;

const INITIAL_LOADING_STATE: AvatarLoadState = {
  status: 'loading',
  progress: null,
  errorMessage: null,
};

interface ViewerSnapshot {
  key: string;
  loadState: AvatarLoadState;
  modelSummary: AvatarModelSummary | null;
}

export interface UseAvatarViewerOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  modelUrl: string;
  controllers?: AvatarControllerSlots;
  initialFramingMode?: FramingMode;
  onModelLoaded?: (summary: AvatarModelSummary, vrm: VRM) => void;
  onError?: (error: Error) => void;
}

export interface UseAvatarViewerResult {
  loadState: AvatarLoadState;
  modelSummary: AvatarModelSummary | null;
  framingMode: FramingMode;
  setFramingMode: (mode: FramingMode) => void;
  toggleFramingMode: () => void;
  resetFraming: () => void;
  retryLoad: () => void;
}

function flattenControllerSlots(slots?: AvatarControllerSlots): AvatarController[] {
  if (!slots) {
    return [];
  }
  const ordered: AvatarController[] = [];
  // Orchestrator first (publishes coordinated offsets, zero direct bone writes), then
  // root-to-leaves bone/morph owners: LowerBody -> Gesture -> Breathing (Idle) -> Gaze -> Expression -> SpeechMouth -> Extensions
  if (slots.orchestrator) {
    ordered.push(slots.orchestrator);
  }
  if (slots.lowerBody) {
    ordered.push(slots.lowerBody);
  }
  if (slots.gesture) {
    ordered.push(slots.gesture);
  }
  if (slots.idle) {
    ordered.push(slots.idle);
  }
  if (slots.gaze) {
    ordered.push(slots.gaze);
  }
  if (slots.expression) {
    ordered.push(slots.expression);
  }
  if (slots.speechMouth) {
    ordered.push(slots.speechMouth);
  }
  if (slots.extensions) {
    ordered.push(...slots.extensions);
  }
  return ordered;
}

export function useAvatarViewer({
  containerRef,
  modelUrl,
  controllers,
  initialFramingMode = 'waist',
  onModelLoaded,
  onError,
}: UseAvatarViewerOptions): UseAvatarViewerResult {
  const [reloadNonce, setReloadNonce] = useState(0);
  const [framingMode, setFramingModeState] = useState<FramingMode>(initialFramingMode);
  const currentFramingModeRef = useRef<FramingMode>(initialFramingMode);

  const requestKey = `${modelUrl}::${reloadNonce}`;

  const [snapshot, setSnapshot] = useState<ViewerSnapshot>({
    key: requestKey,
    loadState: INITIAL_LOADING_STATE,
    modelSummary: null,
  });

  const loadState =
    snapshot.key === requestKey ? snapshot.loadState : INITIAL_LOADING_STATE;
  const modelSummary =
    snapshot.key === requestKey ? snapshot.modelSummary : null;

  const onModelLoadedRef = useRef(onModelLoaded);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onModelLoadedRef.current = onModelLoaded;
    onErrorRef.current = onError;
  }, [onModelLoaded, onError]);

  const activeControllersRef = useRef<AvatarController[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const defaultFramingRef = useRef<CameraFraming | null>(null);
  const vrmRef = useRef<VRM | null>(null);

  // User manual OrbitControls interaction tracking
  const hasUserAdjustedCameraRef = useRef(false);
  const framingTransitionRef = useRef<{
    targetPosition: THREE.Vector3;
    targetLookAt: THREE.Vector3;
    lambda: number;
  } | null>(null);

  // Keep modular controller slots synchronized when passed or updated by parent
  useEffect(() => {
    const nextControllers = flattenControllerSlots(controllers);
    const prevControllers = activeControllersRef.current;

    const vrm = vrmRef.current;
    const camera = cameraRef.current;
    if (vrm && camera) {
      for (const next of nextControllers) {
        if (!prevControllers.includes(next)) {
          next.attach?.(vrm, camera);
        }
      }
    }

    activeControllersRef.current = nextControllers;
  }, [controllers]);

  const setFramingMode = useCallback((mode: FramingMode) => {
    setFramingModeState(mode);
    currentFramingModeRef.current = mode;
    hasUserAdjustedCameraRef.current = false;

    const vrm = vrmRef.current;
    const camera = cameraRef.current;
    if (vrm && camera) {
      const framing = computeAvatarFraming(
        vrm,
        mode,
        PORTRAIT_FOV_DEG,
        camera.aspect,
      );
      defaultFramingRef.current = framing;
      framingTransitionRef.current = {
        targetPosition: framing.position,
        targetLookAt: framing.target,
        lambda: 7.5,
      };
    }
  }, []);

  const toggleFramingMode = useCallback(() => {
    const next = currentFramingModeRef.current === 'waist' ? 'full' : 'waist';
    setFramingMode(next);
  }, [setFramingMode]);

  const resetFraming = useCallback(() => {
    hasUserAdjustedCameraRef.current = false;
    const vrm = vrmRef.current;
    const camera = cameraRef.current;
    if (vrm && camera) {
      const framing = computeAvatarFraming(
        vrm,
        currentFramingModeRef.current,
        PORTRAIT_FOV_DEG,
        camera.aspect,
      );
      defaultFramingRef.current = framing;
      framingTransitionRef.current = {
        targetPosition: framing.position,
        targetLookAt: framing.target,
        lambda: 7.5,
      };
    }
  }, []);

  const retryLoad = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let isDisposed = false;
    let animationFrameId = 0;

    // 1. Scene & Renderer (calibrated for VRM 1.0 MToon shading in Three.js r155+)
    const scene = new THREE.Scene();

    const initialWidth = Math.max(1, container.clientWidth);
    const initialHeight = Math.max(1, container.clientHeight);

    const camera = new THREE.PerspectiveCamera(
      PORTRAIT_FOV_DEG,
      initialWidth / initialHeight,
      0.1,
      50,
    );
    camera.position.set(0, 1.34, 1.65);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      const errorObj =
        err instanceof Error
          ? err
          : new Error('Unable to initialize WebGL context in this browser.');
      queueMicrotask(() => {
        if (isDisposed) {
          return;
        }
        setSnapshot({
          key: requestKey,
          loadState: {
            status: 'error',
            progress: null,
            errorMessage: errorObj.message,
          },
          modelSummary: null,
        });
        onErrorRef.current?.(errorObj);
      });
      return () => {
        isDisposed = true;
      };
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(initialWidth, initialHeight, false);
    renderer.domElement.className = 'avatar-scene__canvas';
    container.appendChild(renderer.domElement);

    // 2. Camera Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.28, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.75;
    controls.maxDistance = 6.5; // Raised from 3.5m to allow full-body zoom out
    controls.minPolarAngle = Math.PI * 0.22;
    controls.maxPolarAngle = Math.PI * 0.68;
    controls.update();
    controlsRef.current = controls;

    // Detect user manual interaction: immediately yields any in-flight glide
    const onControlStart = () => {
      hasUserAdjustedCameraRef.current = true;
      framingTransitionRef.current = null;
    };
    controls.addEventListener('start', onControlStart);

    // 3. Soft 3-Point Anime Lighting (balanced to ~PI irradiance for MToon BRDF_Lambert)
    const hemiLight = new THREE.HemisphereLight(0xf6f8ff, 0xd8dce8, Math.PI * 0.30);
    hemiLight.position.set(0, 2.5, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffaf4, Math.PI * 0.76);
    keyLight.position.set(1.1, 1.9, 2.2);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xcfe2ff, Math.PI * 0.22);
    rimLight.position.set(-1.3, 1.7, -1.6);
    scene.add(rimLight);

    // 4. Container-Responsive Resize Handling
    const handleResize = () => {
      if (isDisposed) {
        return;
      }
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);

      // Only auto-fit camera if user has not manually orbited/zoomed/panned
      if (!hasUserAdjustedCameraRef.current && vrmRef.current) {
        const framing = computeAvatarFraming(
          vrmRef.current,
          currentFramingModeRef.current,
          PORTRAIT_FOV_DEG,
          camera.aspect,
        );
        defaultFramingRef.current = framing;
        camera.position.copy(framing.position);
        controls.target.copy(framing.target);
        controls.update();
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // 5. Load VRM Model
    const hasGestureController = activeControllersRef.current.some(
      (c) => c.id === 'gesture',
    );

    loadCompanionVrm(modelUrl, {
      applyRelaxedPose: !hasGestureController,
      onProgress: (percent) => {
        if (isDisposed) {
          return;
        }
        setSnapshot((prev) => {
          if (prev.key === requestKey && prev.loadState.status !== 'loading') {
            return prev;
          }
          return {
            key: requestKey,
            loadState: {
              status: 'loading',
              progress: percent,
              errorMessage: null,
            },
            modelSummary: null,
          };
        });
      },
    })
      .then(({ vrm, summary }) => {
        if (isDisposed) {
          disposeVrm(vrm);
          return;
        }

        vrmRef.current = vrm;
        scene.add(vrm.scene);

        // Attach registered modular controllers first
        for (const controller of activeControllersRef.current) {
          controller.attach?.(vrm, camera);
        }

        if (activeControllersRef.current.length > 0) {
          vrm.update(0);
          vrm.scene.updateMatrixWorld(true);
          vrm.springBoneManager?.reset();
        }

        // Frame character cleanly based on requested initial mode and actual aspect ratio
        const framing = computeAvatarFraming(
          vrm,
          currentFramingModeRef.current,
          PORTRAIT_FOV_DEG,
          camera.aspect,
        );
        defaultFramingRef.current = framing;
        camera.position.copy(framing.position);
        controls.target.copy(framing.target);
        controls.update();

        setSnapshot({
          key: requestKey,
          loadState: {
            status: 'ready',
            progress: 100,
            errorMessage: null,
          },
          modelSummary: summary,
        });
        onModelLoadedRef.current?.(summary, vrm);
      })
      .catch((err: unknown) => {
        if (isDisposed) {
          return;
        }
        const errorObj =
          err instanceof Error
            ? err
            : new Error(`Unable to load VRM from "${modelUrl}".`);
        setSnapshot({
          key: requestKey,
          loadState: {
            status: 'error',
            progress: null,
            errorMessage: errorObj.message,
          },
          modelSummary: null,
        });
        onErrorRef.current?.(errorObj);
      });

    // 6. Render & VRM Update Loop
    let previousTimeMs: number | null = null;
    let elapsedSeconds = 0;

    const renderFrame = (nowMs: number) => {
      if (isDisposed) {
        return;
      }
      animationFrameId = window.requestAnimationFrame(renderFrame);

      const rawDelta =
        previousTimeMs === null ? 0 : (nowMs - previousTimeMs) / 1000;
      previousTimeMs = nowMs;
      const deltaTime = Math.min(Math.max(rawDelta, 0), MAX_DELTA_SECONDS);
      elapsedSeconds += deltaTime;

      const currentVrm = vrmRef.current;
      if (currentVrm) {
        // Execute modular controllers in canonical order prior to vrm.update
        for (const controller of activeControllersRef.current) {
          controller.update(currentVrm, deltaTime, elapsedSeconds);
        }
        currentVrm.update(deltaTime);
      }

      // Smooth camera framing transition when user toggles mode or clicks reset
      if (framingTransitionRef.current) {
        const { targetPosition, targetLookAt, lambda } = framingTransitionRef.current;
        const alpha = 1 - Math.exp(-lambda * deltaTime);
        camera.position.lerp(targetPosition, alpha);
        controls.target.lerp(targetLookAt, alpha);
        controls.update();

        if (
          camera.position.distanceTo(targetPosition) < 0.002 &&
          controls.target.distanceTo(targetLookAt) < 0.002
        ) {
          camera.position.copy(targetPosition);
          controls.target.copy(targetLookAt);
          controls.update();
          framingTransitionRef.current = null;
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    // 7. Unmount Cleanup & GPU Resource Disposal
    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlStart);

      controls.dispose();
      controlsRef.current = null;
      cameraRef.current = null;
      defaultFramingRef.current = null;
      framingTransitionRef.current = null;

      if (vrmRef.current) {
        disposeVrm(vrmRef.current, scene);
        vrmRef.current = null;
      }

      scene.remove(hemiLight, keyLight, rimLight);
      hemiLight.dispose();
      keyLight.dispose();
      rimLight.dispose();

      renderer.renderLists.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [containerRef, modelUrl, reloadNonce, requestKey]);

  return {
    loadState,
    modelSummary,
    framingMode,
    setFramingMode,
    toggleFramingMode,
    resetFraming,
    retryLoad,
  };
}
