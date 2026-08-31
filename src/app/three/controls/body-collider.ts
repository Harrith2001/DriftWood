import * as THREE from 'three';
import { BODY_RADIUS, CHEST_HEIGHT, STEP_HEIGHT } from '../../core/world/world.config';

/**
 * Stops the character walking through things, by asking the geometry rather than
 * a map of it.
 *
 * The baked blockers in `city-blockers.ts` answer a different question — which
 * *ground* is unreachable — and they answer it on a half-metre grid, merged into
 * axis-aligned rectangles. That is the right tool for "this terrace has no route
 * up to it" and the wrong one for a stair balustrade, a railing, a lamp post or
 * a parked car: those stand on ground that is perfectly walkable either side of
 * them, at a scale and angle no rectangle grid describes. Walking through them
 * is exactly what it looks like.
 *
 * So the step itself is swept. Two rays, because one is not enough:
 *
 *   at chest height — the wall, the van, the balustrade
 *   at step height  — the low wall, the kerbstone stack, the bollard
 *
 * Anything below the step ray is walked over rather than into, which is what
 * keeps kerbs and thresholds from behaving like fences.
 *
 * Both rays run between the two ends' own ground heights rather than
 * horizontally. On a 1.2-gradient stair a horizontal ray at step height buries
 * itself in the flight ahead within half a metre, and the character would refuse
 * to climb his own staircase.
 */
export class BodyCollider {
  private readonly raycaster = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private colliders: readonly THREE.Object3D[] = [];

  setColliders(colliders: readonly THREE.Object3D[]): void {
    this.colliders = colliders;
  }

  /**
   * True when something solid stands between the two positions.
   *
   * `fromY` and `toY` are the ground heights at each end, not body positions.
   */
  blocked(
    fromX: number, fromY: number, fromZ: number,
    toX: number, toY: number, toZ: number,
  ): boolean {
    if (!this.colliders.length) return false;
    return (
      this.sweep(fromX, fromY, fromZ, toX, toY, toZ, CHEST_HEIGHT) ||
      this.sweep(fromX, fromY, fromZ, toX, toY, toZ, STEP_HEIGHT + 0.05)
    );
  }

  private sweep(
    fromX: number, fromY: number, fromZ: number,
    toX: number, toY: number, toZ: number,
    height: number,
  ): boolean {
    this.origin.set(fromX, fromY + height, fromZ);
    this.direction.set(toX - fromX, toY - fromY, toZ - fromZ);

    const travelled = this.direction.length();
    if (travelled < 1e-6) return false;
    this.direction.divideScalar(travelled);

    this.raycaster.set(this.origin, this.direction);
    // Look a body's width beyond the step, so he stops short of a wall rather
    // than with his nose against it — and so a fast frame cannot step past a
    // thin railing before the next check runs.
    this.raycaster.far = travelled + BODY_RADIUS;

    return this.raycaster.intersectObjects(this.colliders as THREE.Object3D[], false).length > 0;
  }
}
