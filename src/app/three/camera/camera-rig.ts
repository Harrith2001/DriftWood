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
 * ── Why there is no occluder fading ─────────────────────────────────────────
 *
 * Pulling the camera in is the *only* occlusion technique used here. Fading
 * whatever stands in the way — the usual companion trick — was tried and
 * removed, because it cannot work against this particular model.
 *
 * Fading needs per-object granularity, and downloaded environments rarely have
 * it. On the beach model this bit hard: every palm trunk was one merged mesh and
 * the fronds were eight meshes shared across many trees, so making a single
 * occluding frond translucent dropped every palm at once — and because the ray
 * flickers between hit and miss through the gaps in a canopy, the whole treeline
 * blinked several times a second.
 *
 * This city is meshed far more finely, so the trap is less likely here. It is
 * still a trap: if scenery ever needs to stop hiding the character, check what
 * a mesh actually contains before fading it, and split the asset if it turns out
 * to be shared.
 *
 * The rig holds a desired position and target which callers set per frame; the
 * camera then eases toward them, so a snapped change of intent still reads as a
 * move rather than a cut.
 *
 * `followCharacter` additionally casts a ray from the character out to the ideal
 * camera position and pulls the camera in front of whatever it hits. Without
 * this the third-person camera walked straight into shopfronts and parked cars
 * as the visitor moved up the street, filling the screen with brickwork.
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
  /** Shortest distance seen within the hold window; what the rig eases toward. */
  private pendingDistance = CAM_FOLLOW_DISTANCE;
  /** Time left before a longer distance is accepted, in seconds. */
  private holdTimer = 0;
  /**
   * How long a pull-in is held before the camera is allowed back out. Long
   * enough to bridge the gaps in railings and cabling, short enough that stepping
   * into the open does not feel sticky.
   */
  private static readonly OCCLUSION_HOLD = 0.35;

  /** Straight down, for the ground-clearance probe. */
  private static readonly DOWN = new THREE.Vector3(0, -1, 0);
  /** How far above the surface beneath it the camera is kept. */
  private static readonly GROUND_CLEARANCE = 0.9;

  /**
   * Trauma-based shake. Stored as trauma rather than raw offset and applied as
   * trauma², so it decays smoothly and a big hit reads very differently from a
   * small one instead of everything looking like the same rattle.
   */
  private trauma = 0;
  private shakeSeed = Math.random() * 1000;
  private readonly shakeOffset = new THREE.Vector3();

  constructor(aspect: number, fov: number, position: THREE.Vector3, target: THREE.Vector3) {
    // The near/far ratio decides depth-buffer precision. At 0.1/900 it was
    // 9000:1, and the overlapping double-sided facades and awnings — dozens of
    // cards at almost identical depths — z-fought, so leaves flickered as the
    // camera moved past them. Nothing ever renders closer than a couple of
    // units (the rig never pulls nearer than CAM_MIN_DISTANCE), and the sky
    // dome has a radius of 500, so this range is comfortable and roughly
    // quadruples the precision where it matters.
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.4, 620);
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
   *
   * `groundY` is the surface the character is standing on, and every height here
   * is measured from it rather than from the world's nominal ground constant.
   * That constant describes the plaza and nothing else: the playable streets fall
   * away by several metres, so anchoring to it left the camera floating high
   * above the character and aiming over his head the moment he walked downhill.
   */
  followCharacter(
    x: number,
    z: number,
    yaw: number,
    delta: number,
    fov: number,
    groundY: number = GROUND_Y,
  ): void {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    // Ray starts at roughly chest height so it is not blocked by the ground.
    this.tmpOrigin.set(x, groundY + 1.4, z);
    // Ideal seat: straight back along the facing vector, raised.
    this.tmpIdeal.set(
      x - sin * CAM_FOLLOW_DISTANCE,
      groundY + CAM_FOLLOW_HEIGHT,
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

    // Hold the shortest distance seen recently rather than reacting to a single
    // frame. Railings and power lines are thin and full of gaps, so the ray flickers between
    // hit and miss several times a second as the character walks past a trunk;
    // acting on each of those made the camera stutter in and out.
    // The timer is recharged for as long as *anything* is in the way, not only
    // when the obstruction gets closer. Keying it off "closer than last frame"
    // meant that during steady occlusion the timer quietly ran down, so by the
    // time a gap between fronds arrived there was no hold left to absorb it.
    if (allowed < CAM_FOLLOW_DISTANCE - 0.001) {
      this.pendingDistance = allowed;
      this.holdTimer = CameraRig.OCCLUSION_HOLD;
    } else {
      this.holdTimer -= delta;
      if (this.holdTimer <= 0) this.pendingDistance = CAM_FOLLOW_DISTANCE;
    }

    // Ease both ways. Pulling in is quicker than easing back out — a wall is
    // urgent, open space is not — but an instant snap inward is what read as a
    // flash, so even the fast direction is now a smoothed, frame-rate
    // independent approach rather than a jump.
    const rate = this.pendingDistance < this.occludedDistance ? 14 : 2.5;
    this.occludedDistance = THREE.MathUtils.lerp(
      this.occludedDistance,
      this.pendingDistance,
      1 - Math.exp(-rate * delta),
    );

    // Drop the height with the distance, otherwise a pulled-in camera looks
    // down at the character's scalp.
    const heightScale = this.occludedDistance / CAM_FOLLOW_DISTANCE;
    this.desiredPosition.set(
      x - sin * this.occludedDistance,
      groundY + CAM_FOLLOW_HEIGHT * Math.max(0.55, heightScale),
      z - cos * this.occludedDistance,
    );
    this.liftAboveGround();
    this.desiredTarget.set(x + sin * CAM_LOOK_AHEAD, groundY + CAM_LOOK_HEIGHT, z + cos * CAM_LOOK_AHEAD);
    this.desiredFov = fov;
  }

  /**
   * Keeps the camera above whatever it is standing over.
   *
   * The seat height above is measured from the *character's* footing, which is
   * the right reference on level ground and wrong on a hill: walking downhill
   * puts the rig six metres back up a slope that has risen several metres in the
   * meantime, so the camera ends up at or under the road behind it and the lower
   * third of the frame fills with tarmac seen edge-on. Sampling the surface
   * directly beneath the seat and lifting to clear it costs one cast and fixes
   * every case, including the stair flights, where the drop is steepest.
   */
  private liftAboveGround(): void {
    if (!this.colliders.length) return;

    // From well above the seat, so the ray starts outside the road slab even
    // when the seat itself has ended up inside it.
    this.tmpOrigin.set(this.desiredPosition.x, this.desiredPosition.y + 6, this.desiredPosition.z);
    this.raycaster.set(this.tmpOrigin, CameraRig.DOWN);
    this.raycaster.far = 12;

    const hit = this.raycaster.intersectObjects(this.colliders as THREE.Object3D[], false)[0];
    if (!hit) return;

    const floor = hit.point.y + CameraRig.GROUND_CLEARANCE;
    if (this.desiredPosition.y < floor) this.desiredPosition.y = floor;
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
