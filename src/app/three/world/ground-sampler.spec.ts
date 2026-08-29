import * as THREE from 'three';
import { GroundSampler } from './ground-sampler';
import { GROUND_Y } from '../../core/world/world.config';

describe('GroundSampler', () => {
  /** A slab at a known height, parented so it can be moved like the city is. */
  function makeDeck(atY: number, size = 20): { root: THREE.Object3D; deck: THREE.Mesh } {
    const root = new THREE.Object3D();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(size, 0.2, size),
      new THREE.MeshBasicMaterial(),
    );
    root.add(deck);
    root.position.y = atY;
    root.updateMatrixWorld(true);
    return { root, deck };
  }

  it('reports the surface height under a point', () => {
    const { deck } = makeDeck(GROUND_Y);
    const sampler = new GroundSampler();
    sampler.setTargets([deck]);

    const height = sampler.heightAt(0, 0);
    expect(height).not.toBeNull();
    expect(height!).toBeCloseTo(GROUND_Y + 0.1, 1);
  });

  it('reports nothing where there is no ground', () => {
    const { deck } = makeDeck(GROUND_Y);
    const sampler = new GroundSampler();
    sampler.setTargets([deck]);

    // Far outside the 20x20 deck.
    expect(sampler.heightAt(200, 200)).toBeNull();
    expect(sampler.hasGround(200, 200)).toBe(false);
  });

  /**
   * Regression cover for a landing bug that only showed on a freshly loaded scene.
   *
   * Three's Raycaster reads world matrices, it does not refresh them, and matrices
   * are normally only recomputed during a render. The city is seated right after
   * it loads, so anything raycasting before the first frame measures the model's
   * *old* position. The arrival's touchdown height is probed exactly there — and
   * the result is cached — so one stale read put the landing at the wrong height
   * and kept it wrong.
   */
  it('measures the moved position once world matrices are refreshed', () => {
    const { root, deck } = makeDeck(GROUND_Y);
    const sampler = new GroundSampler();
    sampler.setTargets([deck]);
    const before = sampler.heightAt(0, 0)!;

    root.position.y = GROUND_Y - 0.5;
    root.updateMatrixWorld(true);
    sampler.setTargets([deck]); // clears the cache

    const after = sampler.heightAt(0, 0)!;
    expect(after).toBeCloseTo(before - 0.5, 2);
  });

  it('clears cached heights when the targets change', () => {
    const { deck } = makeDeck(GROUND_Y);
    const sampler = new GroundSampler();
    sampler.setTargets([deck]);
    sampler.heightAt(0, 0);

    // A stale cache is how one bad reading outlived the frame that caused it.
    sampler.setTargets([]);
    expect(sampler.heightAt(0, 0)).toBe(GROUND_Y);
  });

  /**
   * The city is a hillside: the playable streets alone span 25 metres of
   * elevation. A probe window pinned to one world height — all a flat beach ever
   * needed — finds the road only where the road happens to be near that height,
   * and reports open air everywhere else.
   */
  describe('on sloping ground', () => {
    it('finds a road well below the reference height when asked to look there', () => {
      const { deck } = makeDeck(-8);
      const sampler = new GroundSampler();
      sampler.setTargets([deck]);

      expect(sampler.heightAt(0, 0)).toBeNull();
      expect(sampler.heightAt(0, 0, -8)).toBeCloseTo(-7.9, 1);
    });

    it('does not reach through one storey to the one below', () => {
      // A roof at street level and the street a full storey down.
      const upper = makeDeck(0).deck;
      const lower = makeDeck(-6).deck;
      const sampler = new GroundSampler();
      sampler.setTargets([upper, lower]);

      // Standing up top, the probe must not fall through to the lower road.
      expect(sampler.heightAt(0, 0, 0)).toBeCloseTo(0.1, 1);
      // Standing below, it must not grab the one overhead.
      expect(sampler.heightAt(0, 0, -6)).toBeCloseTo(-5.9, 1);
    });

    it('caches each height band separately', () => {
      const upper = makeDeck(0).deck;
      const lower = makeDeck(-6).deck;
      const sampler = new GroundSampler();
      sampler.setTargets([upper, lower]);

      // Query the upper first; a cache keyed on (x, z) alone would then hand
      // back the upper road to somebody standing on the lower one.
      expect(sampler.heightAt(0, 0, 0)).toBeCloseTo(0.1, 1);
      expect(sampler.heightAt(0, 0, -6)).toBeCloseTo(-5.9, 1);
    });
  });

  /**
   * Documents why the sampler answers only half the question.
   *
   * Whether something is *standing* on a road is deliberately not asked here,
   * and this is the reason: the buildings in this model are meshed from below
   * the roadway up through it, so a probe of the space the body would occupy
   * lies strictly inside the solid — no face anywhere along it, in any
   * direction, whichever way the material faces. A raycast finds surfaces, and
   * there are none to find. `city-blockers.ts` answers it offline instead, by
   * rasterising triangles, where the full vertical span of a cell is known.
   *
   * This test would fail the moment someone "fixed" the sampler by adding an
   * obstacle cast, which is exactly the warning it is here to give.
   */
  it('cannot see a solid that fully contains the probe segment', () => {
    const { deck } = makeDeck(GROUND_Y);

    // A building spanning from below the road to well above head height, as
    // most of them do — its faces are at -2 and +6, and nothing in between.
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(4, 8, 4),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    building.position.y = 2;
    building.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, GROUND_Y + 2.3, 0),
      new THREE.Vector3(0, -1, 0),
      0,
      1.85, // the clearance band an obstacle probe would sweep
    );
    expect(raycaster.intersectObject(building, false).length)
      .withContext('a cast through the body space finds no face to hit')
      .toBe(0);

    // So the sampler reports standable road, and the baked blockers are what
    // actually keep the character out of this square metre.
    const sampler = new GroundSampler();
    sampler.setTargets([deck]);
    expect(sampler.heightAt(0, 0)).toBeCloseTo(0.1, 1);
  });
});
