import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { QualitySettings } from '../../core/models/experience.model';
import { MODEL_OFFSET } from '../../core/world/world.config';

/**
 * The city.
 *
 * The model is seated at the explicit offset in `world.config.ts` rather than
 * being recentred on its own bounding box. It is a hillside, not a diorama: the
 * bounds span 63 metres vertically and 284 horizontally, so their centre lands
 * in mid-air over a valley and has nothing to do with where anyone walks.
 *
 * Meshes are collected into flat arrays for the camera rig to raycast against
 * (so the follow camera pulls in rather than clipping through a facade) and for
 * the ground probe to stand on.
 */
/**
 * Materials the character may stand on.
 *
 * Naming the surfaces is far more reliable than inferring walkability from
 * height. This model stacks roads, terraces and rooftops through 25 metres of
 * elevation, and several rooftops sit at exactly the height of a road one street
 * over, so any height-band test would hand back a roof as ground.
 *
 * `darkconcrete` is deliberately absent: it is the interior flooring, and it
 * exists at first- and second-storey levels as well as at street level.
 */
const WALKABLE_SURFACE = /^(atlas_street|ground|concretopoor)$/;

/**
 * Scenery that must never stop the camera or count as an obstacle: window glass,
 * the alpha-carded plants, and the emissive strips inside the street lamps.
 */
const SEE_THROUGH = /^(glasss|atlas_plantsTRP|emitYELL|emiWHITE)$/;

export class Environment {
  readonly root: THREE.Group;
  /** Flat list of solid meshes, for camera occlusion tests. */
  readonly colliders: THREE.Mesh[] = [];
  /** Subset the character can actually stand on, for the ground probe. */
  readonly walkableSurfaces: THREE.Mesh[] = [];

  constructor(gltf: GLTF, quality: QualitySettings) {
    this.root = gltf.scene;
    this.root.name = 'city';

    this.root.position.copy(MODEL_OFFSET);

    // Flush the placement into every child's world matrix straight away.
    //
    // Three's Raycaster does not update world matrices — it reads whatever was
    // last computed, and matrices are normally only refreshed during a render.
    // Moving the model above therefore leaves every mesh's matrixWorld
    // describing where it used to be, and anything that raycasts before the
    // first frame is measuring the old position. That included the probe that
    // decides the height the arrival touches down at, whose result is then
    // cached — so a single stale read put the landing at the wrong height and
    // kept it there.
    this.root.updateMatrixWorld(true);

    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.castShadow = quality.shadows;
      mesh.receiveShadow = quality.shadows;

      if (matches(mesh, WALKABLE_SURFACE)) this.walkableSurfaces.push(mesh);

      // Everything solid enough to hide the character counts as a collider, so
      // the camera never parks inside a wall. Glass and foliage cards are the
      // exception: flinching away from a shopfront window looks like a fault.
      if (!matches(mesh, SEE_THROUGH)) this.colliders.push(mesh);
    });
  }

  dispose(): void {
    this.colliders.length = 0;
    this.walkableSurfaces.length = 0;
    this.root.removeFromParent();
  }
}

/** True when any of the mesh's materials matches the pattern. */
function matches(mesh: THREE.Mesh, pattern: RegExp): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((m) => pattern.test(m?.name ?? ''));
}
