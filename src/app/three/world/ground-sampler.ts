import * as THREE from 'three';
import { GROUND_Y } from '../../core/world/world.config';

/**
 * Answers "is there solid ground here, and how high is it?" by casting against
 * the real island geometry.
 *
 * The walkable areas in `world.config.ts` are hand-measured rectangles, and a
 * rectangle can only ever approximate an irregular island. The sand rectangle
 * reached past the western shoreline, so the character could walk off the beach
 * and stand on open sea with the island receding behind him.
 *
 * The surface height matters just as much. Sand on this model runs from about
 * 2.24 to 2.79 and the pier deck sits near 2.37, so pinning the character to a
 * single constant left him hovering half a metre above the jetty in places.
 *
 * Results are cached on a quarter-unit grid; the character advances ~0.07 units
 * per frame, so nearly every query is a cache hit.
 */
export class GroundSampler {
  private readonly raycaster = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private static readonly DOWN = new THREE.Vector3(0, -1, 0);

  /** Quantised (x,z) → surface height, or null where there is no ground. */
  private readonly cache = new Map<number, number | null>();
  private targets: readonly THREE.Object3D[] = [];

  /**
   * The probe starts this far above the nominal ground plane and reaches this
   * far down. The window is deliberately narrow: starting below the rooflines
   * means a roof is never mistaken for ground, and stopping above the sea bed
   * means open water returns nothing.
   */
  private static readonly PROBE_ABOVE = 2.0;
  private static readonly PROBE_DEPTH = 3.0;
  /** Cache resolution, in world units. */
  private static readonly GRID = 0.25;
  /** Offset of the extra samples used to bridge the gaps between deck planks. */
  private static readonly SPREAD = 0.16;

  setTargets(targets: readonly THREE.Object3D[]): void {
    this.targets = targets;
    this.cache.clear();
  }

  /** Surface height at a point, or null where nothing standable exists. */
  heightAt(x: number, z: number): number | null {
    if (!this.targets.length) return GROUND_Y; // nothing loaded yet — do not block

    const gx = Math.round(x / GroundSampler.GRID);
    const gz = Math.round(z / GroundSampler.GRID);
    const key = gx * 100000 + gz;

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const cx = gx * GroundSampler.GRID;
    const cz = gz * GroundSampler.GRID;
    const o = GroundSampler.SPREAD;

    // Several samples, taking the first that lands. The pier is planked with
    // real gaps between the boards, and a single point ray drops straight
    // through them — which read as a chequerboard of standable and unstandable
    // spots along the jetty and stopped the character within a stride of
    // landing on it.
    const height =
      this.castAt(cx, cz) ??
      this.castAt(cx + o, cz) ??
      this.castAt(cx - o, cz) ??
      this.castAt(cx, cz + o) ??
      this.castAt(cx, cz - o);

    this.cache.set(key, height);
    return height;
  }

  hasGround(x: number, z: number): boolean {
    return this.heightAt(x, z) !== null;
  }

  /** One downward ray; returns the surface height it lands on, or null. */
  private castAt(x: number, z: number): number | null {
    this.origin.set(x, GROUND_Y + GroundSampler.PROBE_ABOVE, z);
    this.raycaster.set(this.origin, GroundSampler.DOWN);
    this.raycaster.far = GroundSampler.PROBE_DEPTH;

    const hit = this.raycaster.intersectObjects(this.targets as THREE.Object3D[], false)[0];
    return hit ? hit.point.y : null;
  }
}
