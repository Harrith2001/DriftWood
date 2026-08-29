import * as THREE from 'three';
import { GROUND_Y } from '../../core/world/world.config';

/**
 * Answers "is there road here, and how high is it?" by casting against the real
 * city geometry.
 *
 * Authored rectangles cannot describe this. The model is a hillside of roads,
 * terraces, stairs and yards spanning 25 metres of elevation across the playable
 * area alone, cut up into 218 meshes — and several rooftops sit at exactly the
 * height of a road one street over. Anything short of asking the mesh gets it
 * wrong somewhere.
 *
 * The probe window travels with the character, which the beach never needed. A
 * window pinned to one world height finds the road only where the road happens
 * to be near that height, and reports open air everywhere else.
 *
 * What this deliberately does *not* answer is whether something is standing on
 * that road — see `city-blockers.ts`. A cast can only find surfaces, and most of
 * these buildings are modelled from below the roadway up through it, so the
 * space the body would occupy lies strictly inside the solid with no face along
 * it to hit. That question is answered offline, where triangles can be
 * rasterised and the full vertical span of a cell is known.
 *
 * Results are cached on a quarter-unit grid; the character advances ~0.07 units
 * per frame, so nearly every query is a cache hit.
 */
export class GroundSampler {
  private readonly raycaster = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private static readonly DOWN = new THREE.Vector3(0, -1, 0);

  /** Quantised (x, z, height band) → surface height, or null where unstandable. */
  private readonly cache = new Map<number, number | null>();
  private targets: readonly THREE.Object3D[] = [];

  /**
   * The probe starts this far above the reference height and reaches this far
   * down. The window is deliberately narrow: starting below the rooflines means
   * a roof is never mistaken for ground, and the shallow reach means the road on
   * the terrace below is never picked up through the one you are standing on.
   */
  private static readonly PROBE_ABOVE = 2.0;
  private static readonly PROBE_DEPTH = 3.0;
  /** Cache resolution, in world units. */
  private static readonly GRID = 0.25;
  /** Offset of the extra samples used to bridge gaps between kerbs and slabs. */
  private static readonly SPREAD = 0.16;
  /** Height band the cache is keyed on, in world units. */
  private static readonly BAND = 2.0;

  setTargets(targets: readonly THREE.Object3D[]): void {
    this.targets = targets;
    this.cache.clear();
  }

  /**
   * Surface height at a point, or null where nothing standable exists.
   *
   * `nearY` is the height to search around — normally the character's current
   * footing. It is what lets the same query return the road you are on rather
   * than the one on the terrace below.
   */
  heightAt(x: number, z: number, nearY: number = GROUND_Y): number | null {
    if (!this.targets.length) return GROUND_Y; // nothing loaded yet — do not block

    const gx = Math.round(x / GroundSampler.GRID);
    const gz = Math.round(z / GroundSampler.GRID);
    const band = Math.round(nearY / GroundSampler.BAND);
    // Pack all three into one integer key. The playable area is ±19 units, so
    // the grid indices stay well inside the ±2048 the packing allows.
    const key = ((gx + 2048) * 4096 + (gz + 2048)) * 64 + (band + 32);

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const cx = gx * GroundSampler.GRID;
    const cz = gz * GroundSampler.GRID;
    const o = GroundSampler.SPREAD;
    const from = band * GroundSampler.BAND;

    // Several samples, taking the first that lands. Road surfaces here are
    // separate slabs per block with real gaps at the kerbs, and a single point
    // ray drops straight through them — which reads as a chequerboard of
    // standable and unstandable spots along an otherwise continuous street.
    const height =
      this.castAt(cx, cz, from) ??
      this.castAt(cx + o, cz, from) ??
      this.castAt(cx - o, cz, from) ??
      this.castAt(cx, cz + o, from) ??
      this.castAt(cx, cz - o, from);

    this.cache.set(key, height);
    return height;
  }

  hasGround(x: number, z: number, nearY?: number): boolean {
    return this.heightAt(x, z, nearY) !== null;
  }

  /** One downward ray; returns the surface height it lands on, or null. */
  private castAt(x: number, z: number, fromY: number): number | null {
    this.origin.set(x, fromY + GroundSampler.PROBE_ABOVE, z);
    this.raycaster.set(this.origin, GroundSampler.DOWN);
    this.raycaster.far = GroundSampler.PROBE_DEPTH;

    const hit = this.raycaster.intersectObjects(this.targets as THREE.Object3D[], false)[0];
    return hit ? hit.point.y : null;
  }
}
