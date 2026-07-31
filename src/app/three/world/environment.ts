import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { QualitySettings } from '../../core/models/experience.model';

/**
 * The island diorama.
 *
 * The model is recentred so world origin sits at the middle of the island with
 * its base at y=0, which is what every coordinate in `world.config.ts` assumes.
 * Meshes are also collected into a flat array for the camera rig to raycast
 * against, so the follow camera can pull in rather than clipping through a wall.
 */
/**
 * Materials the character may stand on.
 *
 * The diorama names its surfaces explicitly, which is far more reliable than
 * inferring walkability from height: `M_Water`, `M_SandWater` (submerged sand)
 * and `M_GroundPlaneBottom` (sea bed) all sit close enough to beach level that a
 * height-band test happily accepted them, and the character strolled out across
 * the bay. `M_SandWaterEdge` is the damp strip at the waterline and is kept, so
 * he can walk right down to the water without walking onto it.
 */
const WALKABLE_SURFACE = /^M_(SandTop|SandWaterEdge|Pier|Pier_Trim)$/;

export class Environment {
  readonly root: THREE.Group;
  /** Flat list of solid meshes, for camera occlusion tests. */
  readonly colliders: THREE.Mesh[] = [];
  /** Subset the character can actually stand on, for the ground probe. */
  readonly walkableSurfaces: THREE.Mesh[] = [];

  constructor(gltf: GLTF, quality: QualitySettings) {
    this.root = gltf.scene;
    this.root.name = 'island';

    const box = new THREE.Box3().setFromObject(this.root);
    const center = box.getCenter(new THREE.Vector3());
    this.root.position.set(-center.x, -box.min.y, -center.z);

    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.castShadow = quality.shadows;
      mesh.receiveShadow = quality.shadows;

      // Everything solid enough to hide the character counts as a collider,
      // foliage included. An earlier version excluded palm fronds on the theory
      // that alpha-tested cards would make the camera flinch — but the result
      // was the camera parking *inside* a palm crown with the character
      // completely hidden, which is far worse than an occasional nudge.
      this.colliders.push(mesh);

      if (isWalkableSurface(mesh)) this.walkableSurfaces.push(mesh);
    });
  }

  dispose(): void {
    this.colliders.length = 0;
    this.walkableSurfaces.length = 0;
    this.root.removeFromParent();
  }
}

/** True when any of the mesh's materials names a standable surface. */
function isWalkableSurface(mesh: THREE.Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((m) => WALKABLE_SURFACE.test(m?.name ?? ''));
}
