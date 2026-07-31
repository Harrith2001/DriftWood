import * as THREE from 'three';
import {
  CAM_FOLLOW_DISTANCE,
  CAM_FOLLOW_HEIGHT,
  CAM_LOOK_AHEAD,
  CAM_LOOK_HEIGHT,
  CAM_MIN_DISTANCE,
  GROUND_Y,
} from '../../core/world/world.config';

/**
 * Camera rig with occlusion handling.
 *
 * The rig holds a desired position and target which callers set per frame; the
 * camera then eases toward them, so a snapped change of intent still reads as a
 * move rather than a cut.
 *
 * `followCharacter` additionally casts a ray from the character out to the ideal
 * camera position and pulls the camera in front of whatever it hits. Without
 * this the third-person camera walked straight into the beach house and the
 * palm trunks as the visitor moved inland, filling the screen with roof tiles.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();
  private desiredFov: number;

  private readonly raycaster = new THREE.Raycaster();
  private colliders: readonly THREE.Object3D[] = [];

  /** Scratch vectors, reused to keep the render loop allocation-free. */
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpOrigin = new THREE.Vector3();
  private readonly tmpIdeal = new THREE.Vector3();

  /** Smoothed occlusion distance, so brushing past a post does not snap the camera. */
  private occludedDistance = CAM_FOLLOW_DISTANCE;

  /**
   * Trauma-based shake. Stored as trauma rather than raw offset and applied as
   * trauma², so it decays smoothly and a big hit reads very differently from a
   * small one instead of everything looking like the same rattle.
   */
  private trauma = 0;
  private shakeSeed = Math.random() * 1000;
  private readonly shakeOffset = new THREE.Vector3();

  constructor(aspect: number, fov: number, position: THREE.Vector3, target: THREE.Vector3) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 900);
    this.camera.position.copy(position);
    this.camera.lookAt(target);

    this.desiredPosition.copy(position);
    this.desiredTarget.copy(target);
    this.currentTarget.copy(target);
    this.desiredFov = fov;
  }

  setColliders(colliders: readonly THREE.Object3D[]): void {
    this.colliders = colliders;
  }

  /** Directly sets where the rig should be heading. */
  setDesired(position: THREE.Vector3, target: THREE.Vector3, fov?: number): void {
    this.desiredPosition.copy(position);
    this.desiredTarget.copy(target);
    if (fov !== undefined) this.desiredFov = fov;
  }

  /**
   * Places the rig behind a character facing `yaw`, pulling in when geometry
   * blocks the line of sight.
   */
  followCharacter(x: number, z: number, yaw: number, delta: number, fov: number): void {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    // Ray starts at roughly chest height so it is not blocked by the ground.
    this.tmpOrigin.set(x, GROUND_Y + 1.4, z);
    // Ideal seat: straight back along the facing vector, raised.
    this.tmpIdeal.set(
      x - sin * CAM_FOLLOW_DISTANCE,
      GROUND_Y + CAM_FOLLOW_HEIGHT,
      z - cos * CAM_FOLLOW_DISTANCE,
    );

    let allowed = CAM_FOLLOW_DISTANCE;
    if (this.colliders.length) {
      this.tmpDir.copy(this.tmpIdeal).sub(this.tmpOrigin);
      const idealDistance = this.tmpDir.length();
      this.tmpDir.normalize();

      this.raycaster.set(this.tmpOrigin, this.tmpDir);
      this.raycaster.far = idealDistance;
      const hits = this.raycaster.intersectObjects(this.colliders as THREE.Object3D[], false);

      if (hits.length) {
        // Stop short of the surface so the near plane never crosses it.
        const clearance = 0.45;
        allowed = THREE.MathUtils.clamp(
          hits[0].distance - clearance,
          CAM_MIN_DISTANCE,
          CAM_FOLLOW_DISTANCE,
        );
      }
    }

    // Snap inward quickly (a wall is urgent), ease back out slowly.
    const easing = allowed < this.occludedDistance ? 0.5 : Math.min(1, delta * 2.2);
    this.occludedDistance = THREE.MathUtils.lerp(this.occludedDistance, allowed, easing);

    // Drop the height with the distance, otherwise a pulled-in camera looks
    // down at the character's scalp.
    const heightScale = this.occludedDistance / CAM_FOLLOW_DISTANCE;
    this.desiredPosition.set(
      x - sin * this.occludedDistance,
      GROUND_Y + CAM_FOLLOW_HEIGHT * Math.max(0.55, heightScale),
      z - cos * this.occludedDistance,
    );
    this.desiredTarget.set(x + sin * CAM_LOOK_AHEAD, GROUND_Y + CAM_LOOK_HEIGHT, z + cos * CAM_LOOK_AHEAD);
    this.desiredFov = fov;
  }

  /** Adds impact energy. Values are additive and clamped; 1 is a hard landing. */
  addTrauma(amount: number): void {
    this.trauma = THREE.MathUtils.clamp(this.trauma + amount, 0, 1);
  }

  /** Eases the camera toward its desired state. `responsiveness` is 0..1-ish per frame. */
  update(delta: number, responsiveness = 3.5): void {
    const t = 1 - Math.exp(-responsiveness * delta); // frame-rate independent easing

    this.camera.position.lerp(this.desiredPosition, t);
    this.currentTarget.lerp(this.desiredTarget, t);
    this.camera.lookAt(this.currentTarget);

    // Shake is layered on after lookAt so it displaces the whole view rather
    // than fighting the easing toward the desired position.
    if (this.trauma > 0.001) {
      this.trauma = Math.max(0, this.trauma - delta * 1.6);
      const magnitude = this.trauma * this.trauma;
      this.shakeSeed += delta * 34;

      // Cheap deterministic noise: three offset sine pairs read as random
      // enough at shake frequencies and cost nothing.
      this.shakeOffset.set(
        Math.sin(this.shakeSeed * 1.7) * Math.cos(this.shakeSeed * 0.9),
        Math.sin(this.shakeSeed * 2.3 + 1.7) * Math.cos(this.shakeSeed * 1.1),
        Math.sin(this.shakeSeed * 1.3 + 3.1) * Math.cos(this.shakeSeed * 1.9),
      );
      this.camera.position.addScaledVector(this.shakeOffset, magnitude * 0.45);
      // A little roll sells the hit far more than translation alone.
      this.camera.rotateZ(Math.sin(this.shakeSeed * 2.1) * magnitude * 0.035);
    }

    if (Math.abs(this.camera.fov - this.desiredFov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.desiredFov, t);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Jumps straight to the desired state, with no easing. */
  snap(): void {
    this.camera.position.copy(this.desiredPosition);
    this.currentTarget.copy(this.desiredTarget);
    this.camera.lookAt(this.currentTarget);
    this.camera.fov = this.desiredFov;
    this.camera.updateProjectionMatrix();
    this.occludedDistance = CAM_FOLLOW_DISTANCE;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
