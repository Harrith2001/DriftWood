import * as THREE from 'three';
import { GroundSampler } from './ground-sampler';
import { GROUND_Y } from '../../core/world/world.config';

/**
 * Regression cover for a landing bug that only showed on a freshly loaded scene.
 *
 * Three's Raycaster reads world matrices, it does not refresh them, and matrices
 * are normally only recomputed during a render. The island is recentred right
 * after it loads, so anything raycasting before the first frame measures the
 * model's *old* position. The arrival's touchdown height is probed exactly
 * there — and the result is cached — so one stale read put the landing at the
 * wrong height and kept it wrong.
 */
describe('GroundSampler', () => {
  /** A deck at a known height, parented so it can be moved like the island is. */
  function makeDeck(atY: number): { root: THREE.Object3D; deck: THREE.Mesh } {
    const root = new THREE.Object3D();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.2, 20),
      new THREE.MeshBasicMaterial(),
    );
    root.add(deck);
    root.position.y = atY;
    return { root, deck };
  }

  it('reports the surface height under a point', () => {
    const { root, deck } = makeDeck(GROUND_Y);
    root.updateMatrixWorld(true);

    const sampler = new GroundSampler();
    sampler.setTargets([deck]);

    const height = sampler.heightAt(0, 0);
    expect(height).not.toBeNull();
    expect(height!).toBeCloseTo(GROUND_Y + 0.1, 1);
  });

  it('reports nothing where there is no ground', () => {
    const { root, deck } = makeDeck(GROUND_Y);
    root.updateMatrixWorld(true);

    const sampler = new GroundSampler();
    sampler.setTargets([deck]);

    // Far outside the 20x20 deck.
    expect(sampler.heightAt(200, 200)).toBeNull();
    expect(sampler.hasGround(200, 200)).toBe(false);
  });

  it('measures the moved position once world matrices are refreshed', () => {
    const { root, deck } = makeDeck(GROUND_Y);
    root.updateMatrixWorld(true);

    const sampler = new GroundSampler();
    sampler.setTargets([deck]);
    const before = sampler.heightAt(0, 0)!;

    // Move the deck the way the island is recentred on load, and flush the
    // change through to world matrices as Environment now does.
    root.position.y = GROUND_Y - 0.5;
    root.updateMatrixWorld(true);
    sampler.setTargets([deck]); // clears the cache

    const after = sampler.heightAt(0, 0)!;
    expect(after).toBeCloseTo(before - 0.5, 2);
  });

  it('clears cached heights when the targets change', () => {
    const { root, deck } = makeDeck(GROUND_Y);
    root.updateMatrixWorld(true);

    const sampler = new GroundSampler();
    sampler.setTargets([deck]);
    sampler.heightAt(0, 0);

    // A stale cache is how one bad reading outlived the frame that caused it.
    sampler.setTargets([]);
    expect(sampler.heightAt(0, 0)).toBe(GROUND_Y);
  });
});
