import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { applyNaturalRestArms } from './framing';
import type { AvatarModelSummary } from './types';

export interface LoadCompanionVrmOptions {
  onProgress?: (percent: number | null) => void;
  applyRelaxedPose?: boolean;
}

export interface LoadedVrmResult {
  vrm: VRM;
  summary: AvatarModelSummary;
}

function buildModelSummary(vrm: VRM): AvatarModelSummary {
  const meta = vrm.meta;
  const specVersion: '1.0' | '0.0' = meta.metaVersion === '1' ? '1.0' : '0.0';

  const name =
    meta.metaVersion === '1'
      ? meta.name || 'Companion'
      : meta.title || 'Companion';

  const authors =
    meta.metaVersion === '1'
      ? meta.authors ?? []
      : meta.author
        ? [meta.author]
        : [];

  const presetExpressions = Object.keys(vrm.expressionManager?.presetExpressionMap ?? {});
  const customExpressions = Object.keys(vrm.expressionManager?.customExpressionMap ?? {});
  const allExpressions = [...presetExpressions, ...customExpressions];

  return {
    name,
    specVersion,
    authors,
    presetExpressions,
    customExpressions,
    allExpressions,
    springBoneJointCount: vrm.springBoneManager?.joints.size ?? 0,
    springBoneColliderCount: vrm.springBoneManager?.colliders.length ?? 0,
  };
}

/**
 * Loads a VRM 1.0 (or VRM 0.x) model via Three.js GLTFLoader + VRMLoaderPlugin
 * while preserving all VRM expressions, morph targets, MToon materials, and spring bones.
 */
export function loadCompanionVrm(
  url: string,
  options: LoadCompanionVrmOptions = {},
): Promise<LoadedVrmResult> {
  const { onProgress, applyRelaxedPose = true } = options;

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));

  return new Promise<LoadedVrmResult>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          VRMUtils.deepDispose(gltf.scene);
          reject(new Error(`Loaded asset "${url}" does not contain valid VRM data.`));
          return;
        }

        // Only rotates VRM 0.x (-Z forward) by 180 deg; VRM 1.0 (+Z forward) stays untouched
        VRMUtils.rotateVRM0(vrm);

        // Prevent close-up camera frustum culling issues on skinned meshes & blendshapes
        vrm.scene.traverse((obj) => {
          obj.frustumCulled = false;
        });

        if (applyRelaxedPose) {
          applyNaturalRestArms(vrm);
        }

        // Reset expressions cleanly to 0 while keeping all preset/custom expressions registered
        vrm.expressionManager?.resetValues();

        // Sync normalized humanoid pose, expressions, & SpringBone rest state before first render
        vrm.update(0);
        vrm.scene.updateMatrixWorld(true);
        vrm.springBoneManager?.reset();

        resolve({
          vrm,
          summary: buildModelSummary(vrm),
        });
      },
      (event) => {
        if (!onProgress) {
          return;
        }
        if (event.lengthComputable && event.total > 0) {
          const pct = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
          onProgress(pct);
        } else {
          onProgress(null);
        }
      },
      (unknownError) => {
        if (unknownError instanceof Error) {
          reject(unknownError);
          return;
        }
        reject(new Error(`Failed to load VRM model from "${url}". Ensure the file exists in public/models/.`));
      },
    );
  });
}

/**
 * Removes a VRM from its scene and deeply disposes geometries, MToon materials, and GPU textures.
 */
export function disposeVrm(vrm: VRM | null, parentScene?: THREE.Scene): void {
  if (!vrm) {
    return;
  }
  if (parentScene) {
    parentScene.remove(vrm.scene);
  } else if (vrm.scene.parent) {
    vrm.scene.parent.remove(vrm.scene);
  }
  VRMUtils.deepDispose(vrm.scene);
}

