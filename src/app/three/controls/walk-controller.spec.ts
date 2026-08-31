import { WalkController } from './walk-controller';
import type { Character } from '../character/character';
import type { GroundSampler } from '../world/ground-sampler';
import {
  BLOCKERS,
  BODY_RADIUS,
  HOTSPOTS,
  LANDING,
  WALKABLE,
  YAW_STREET,
} from '../../core/world/world.config';

/**
 * Movement constraints. These assert the character cannot leave the dressed part
 * of the city or walk through geometry — the boundaries the visitor is never
 * told about but would immediately notice the absence of.
 */
describe('WalkController', () => {
  /** Minimal Character stand-in; the controller only pushes pose into it. */
  function characterStub(): Character {
    return {
      setGroundPosition: () => {},
      setYaw: () => {},
      transitionTo: () => {},
      setWalkSpeed: () => {},
    } as unknown as Character;
  }

  /** A probe that reports flat ground everywhere except inside `solid`. */
  function groundStub(solid: (x: number, z: number) => boolean = () => false): GroundSampler {
    return {
      heightAt: (x: number, z: number) => (solid(x, z) ? null : 0),
      hasGround: (x: number, z: number) => !solid(x, z),
    } as unknown as GroundSampler;
  }

  function controller(ground?: GroundSampler): WalkController {
    return new WalkController(characterStub(), LANDING.x, LANDING.z, YAW_STREET, ground);
  }

  const bounds = WALKABLE[0];

  it('accepts the landing point in the plaza', () => {
    expect(controller().isWalkable(LANDING.x, LANDING.z)).toBe(true);
  });

  it('rejects everything outside the play bounds', () => {
    const walk = controller();
    expect(walk.isWalkable(bounds.maxX + 5, LANDING.z)).toBe(false);
    expect(walk.isWalkable(bounds.minX - 5, LANDING.z)).toBe(false);
    expect(walk.isWalkable(LANDING.x, bounds.maxZ + 5)).toBe(false);
    expect(walk.isWalkable(LANDING.x, bounds.minZ - 5)).toBe(false);
  });

  it('keeps a body-width clear of the boundary', () => {
    // Exactly on the edge must fail; the inset is what stops the character
    // standing with half his body in undressed geometry. Tested on the east
    // edge, which is open roadway at z=0 — the west edge is a steep bank and is
    // covered by the generated blockers, so it would pass for the wrong reason.
    expect(controller().isWalkable(bounds.maxX, 0)).toBe(false);
    expect(controller().isWalkable(bounds.maxX - BODY_RADIUS - 0.01, 0)).toBe(true);
  });

  /**
   * The rectangle is a fence, not a map. Everything that actually stops the
   * character — facades, kerbs, the edge of a terrace — is geometry, and this is
   * the seam where that authority is handed over. On the beach the equivalent
   * check was the only thing preventing a stroll out across open water.
   */
  it('lets the ground probe overrule the rectangle', () => {
    const wall = (x: number) => x > 4 && x < 6;
    const walk = controller(groundStub((x) => wall(x)));

    expect(walk.isWalkable(2, LANDING.z)).toBe(true);
    expect(walk.isWalkable(5, LANDING.z)).toBe(false);
  });

  it('does not move when there is no input', () => {
    const walk = controller();
    walk.update(1 / 60, { forward: 0, turn: 0, run: false });
    expect(walk.positionX).toBeCloseTo(LANDING.x, 5);
    expect(walk.positionZ).toBeCloseTo(LANDING.z, 5);
  });

  it('moves along its facing when walking forward', () => {
    const walk = controller();
    const startZ = walk.positionZ;
    // YAW_STREET faces +Z, up the hill, so forward increases Z.
    for (let i = 0; i < 30; i++) walk.update(1 / 60, { forward: 1, turn: 0, run: false });
    expect(walk.positionZ).toBeGreaterThan(startZ);
  });

  it('refuses to leave the walkable area however long you push', () => {
    const walk = controller();
    // Two hundred frames of running straight at the boundary.
    for (let i = 0; i < 200; i++) walk.update(1 / 60, { forward: -1, turn: 0, run: true });
    expect(walk.isWalkable(walk.positionX, walk.positionZ)).toBe(true);
    expect(walk.positionZ).toBeGreaterThanOrEqual(bounds.minZ);
  });

  it('stops at a wall instead of walking through it', () => {
    // A wall across the street ahead, reported by geometry alone.
    const walk = controller(groundStub((_x, z) => z > 6));
    for (let i = 0; i < 200; i++) walk.update(1 / 60, { forward: 1, turn: 0, run: true });
    expect(walk.positionZ).toBeLessThanOrEqual(6);
  });

  /**
   * The stair flights run at a 1.2 gradient, so walking up one lifts the ground
   * under the character at about five metres a second. The easing that makes
   * kerbs feel like a settle rather than a snap cannot follow that on its own —
   * he waded through the treads up to the knee the whole way up.
   */
  it('keeps up with ground that climbs as fast as the stairs do', () => {
    const character = characterStub();
    const heights: number[] = [];
    (character as unknown as { setGroundPosition: (x: number, z: number, y: number) => void })
      .setGroundPosition = (_x, _z, y) => heights.push(y);

    // A 1.2 gradient running the length of the walk, as the stair flights do.
    const slope = {
      heightAt: (_x: number, z: number) => (z - LANDING.z) * 1.2,
      hasGround: () => true,
    } as unknown as GroundSampler;

    const walk = new WalkController(character, LANDING.x, LANDING.z, YAW_STREET, slope);
    for (let i = 0; i < 120; i++) walk.update(1 / 60, { forward: 1, turn: 0, run: false });

    const expected = (walk.positionZ - LANDING.z) * 1.2;
    expect(Math.abs(walk.surfaceY - expected))
      .withContext('character height against the real stair surface')
      .toBeLessThan(0.3);
  });

  it('reports a hotspot once inside its radius', () => {
    const spot = HOTSPOTS[0];
    const walk = new WalkController(characterStub(), spot.x, spot.z, YAW_STREET);
    expect(walk.findNearbyHotspot()).toBe(spot.id);
  });

  it('reports nothing when clear of every hotspot', () => {
    const walk = new WalkController(characterStub(), 16, -30, YAW_STREET);
    expect(walk.findNearbyHotspot()).toBeNull();
  });

  it('places every hotspot inside the play bounds', () => {
    // A beacon the character cannot reach is a dead end for the visitor.
    const walk = controller();
    for (const spot of HOTSPOTS) {
      expect(walk.isWalkable(spot.x, spot.z))
        .withContext(`hotspot "${spot.id}" at (${spot.x}, ${spot.z})`)
        .toBe(true);
    }
  });

  it('rejects the inside of every generated blocker', () => {
    const walk = controller();
    for (const b of BLOCKERS) {
      const x = (b.minX + b.maxX) / 2;
      const z = (b.minZ + b.maxZ) / 2;
      expect(walk.isWalkable(x, z))
        .withContext(`blocker centred on (${x}, ${z})`)
        .toBe(false);
    }
  });

  it('keeps every hotspot clear of every blocker', () => {
    // A beacon standing inside a parked car is a dead end for the visitor, and
    // the two lists are generated and authored separately — nothing but this
    // test connects them.
    for (const spot of HOTSPOTS) {
      for (const b of BLOCKERS) {
        const inside =
          spot.x >= b.minX - BODY_RADIUS && spot.x <= b.maxX + BODY_RADIUS &&
          spot.z >= b.minZ - BODY_RADIUS && spot.z <= b.maxZ + BODY_RADIUS;
        expect(inside)
          .withContext(`hotspot "${spot.id}" against blocker (${b.minX}..${b.maxX}, ${b.minZ}..${b.maxZ})`)
          .toBe(false);
      }
    }
  });

  it('keeps the hotspots far enough apart to be told apart', () => {
    // Overlapping radii would make the prompt flicker between two panels.
    for (const a of HOTSPOTS) {
      for (const b of HOTSPOTS) {
        if (a.id === b.id) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z))
          .withContext(`"${a.id}" and "${b.id}"`)
          .toBeGreaterThan(a.radius + b.radius);
      }
    }
  });
});
