import * as THREE from 'three';

/**
 * Fades any geometry standing between the camera and the character.
 *
 * Pulling the camera in on contact (see `CameraRig`) handles walls, but it
 * cannot help in a diorama this dense: railings, fences and hut walls sit at
 * exactly body height, and a camera far enough back to frame the character is
 * often behind one of them. A single ray from chest height also sails over low
 * obstacles that still hide the legs, so three heights are sampled.
 *
 * The fade is applied by swapping the *mesh's* material for a translucent
 * clone, never by mutating the material in place. Materials in this model are
 * shared across dozens of meshes — the first version edited them directly and
 * one railing in the way turned the entire island transparent.
 */
export class OccluderFade {
  private readonly raycaster = new THREE.Raycaster();
  private readonly direction = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();

  /** Meshes currently swapped to their faded clone. */
  private readonly faded = new Set<THREE.Mesh>();
  /** Meshes found occluding this frame. */
  private readonly current = new Set<THREE.Mesh>();
  /** Original material per mesh, restored when it stops occluding. */
  private readonly originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  /** Faded clone per mesh, built once and reused. */
  private readonly clones = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  private targets: readonly THREE.Object3D[] = [];

  private static readonly FADED_OPACITY = 0.18;
  /** Sample heights above the ground, so legs, torso and head are all covered. */
  private static readonly SAMPLE_HEIGHTS = [0.5, 1.2, 1.7];

  setTargets(targets: readonly THREE.Object3D[]): void {
    this.targets = targets;
  }

  /** How many meshes are currently faded. */
  get fadedCount(): number {
    return this.faded.size;
  }

  update(camera: THREE.Camera, footX: number, footZ: number, groundY: number): void {
    if (!this.targets.length) return;
    this.current.clear();

    for (const height of OccluderFade.SAMPLE_HEIGHTS) {
      this.origin.set(footX, groundY + height, footZ);
      this.direction.subVectors(camera.position, this.origin);
      const distance = this.direction.length();
      if (distance < 0.01) continue;
      this.direction.divideScalar(distance);

      this.raycaster.set(this.origin, this.direction);
      // Stop short of the camera so its own near-plane volume is ignored.
      this.raycaster.far = distance - 0.2;

      for (const hit of this.raycaster.intersectObjects(this.targets as THREE.Object3D[], false)) {
        this.current.add(hit.object as THREE.Mesh);
      }
    }

    for (const mesh of this.current) {
      if (!this.faded.has(mesh)) this.fade(mesh);
    }

    for (const mesh of [...this.faded]) {
      if (!this.current.has(mesh)) this.restore(mesh);
    }
  }

  private fade(mesh: THREE.Mesh): void {
    if (!this.originals.has(mesh)) this.originals.set(mesh, mesh.material);

    let clone = this.clones.get(mesh);
    if (!clone) {
      const source = this.originals.get(mesh)!;
      clone = Array.isArray(source)
        ? source.map((m) => makeTranslucent(m))
        : makeTranslucent(source);
      this.clones.set(mesh, clone);
    }

    mesh.material = clone;
    this.faded.add(mesh);
  }

  private restore(mesh: THREE.Mesh): void {
    const original = this.originals.get(mesh);
    if (original) mesh.material = original;
    this.faded.delete(mesh);
  }

  /** Restores every faded mesh and releases the clones. */
  reset(): void {
    for (const mesh of [...this.faded]) this.restore(mesh);
    for (const clone of this.clones.values()) {
      if (Array.isArray(clone)) clone.forEach((m) => m.dispose());
      else clone.dispose();
    }
    this.clones.clear();
    this.originals.clear();
    this.current.clear();
  }
}

function makeTranslucent(source: THREE.Material): THREE.Material {
  const clone = source.clone();
  clone.transparent = true;
  clone.opacity = OccluderFadeOpacity;
  clone.depthWrite = false;
  // Occluders must never cast a shadow onto the character they are hiding.
  clone.side = THREE.FrontSide;
  clone.needsUpdate = true;
  return clone;
}

/** Kept outside the class so the helper above can read it. */
const OccluderFadeOpacity = 0.18;
