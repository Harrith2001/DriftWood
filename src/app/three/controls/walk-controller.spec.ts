import { WalkController } from './walk-controller';
import type { Character } from '../character/character';
import type { GroundSampler } from '../world/ground-sampler';
import type { BodyCollider } from './body-collider';
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
      setCrouch: () => {},
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
    walk.update(1 / 60, { forward: 0, turn: 0, run: false, jump: false });
    expect(walk.positionX).toBeCloseTo(LANDING.x, 5);
    expect(walk.positionZ).toBeCloseTo(LANDING.z, 5);
  });

  it('moves along its facing when walking forward', () => {
    const walk = controller();
    const startZ = walk.positionZ;
    // YAW_STREET faces +Z, up the hill, so forward increases Z.
    for (let i = 0; i < 30; i++) walk.update(1 / 60, { forward: 1, turn: 0, run: false, jump: false });
    expect(walk.positionZ).toBeGreaterThan(startZ);
  });

  it('refuses to leave the walkable area however long you push', () => {
    const walk = controller();
    // Two hundred frames of running straight at the boundary.
    for (let i = 0; i < 200; i++) walk.update(1 / 60, { forward: -1, turn: 0, run: true, jump: false });
    expect(walk.isWalkable(walk.positionX, walk.positionZ)).toBe(true);
    expect(walk.positionZ).toBeGreaterThanOrEqual(bounds.minZ);
  });

  it('stops at a wall instead of walking through it', () => {
    // A wall across the street ahead, reported by geometry alone.
    const walk = controller(groundStub((_x, z) => z > 6));
    for (let i = 0; i < 200; i++) walk.update(1 / 60, { forward: 1, turn: 0, run: true, jump: false });
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
    for (let i = 0; i < 120; i++) walk.update(1 / 60, { forward: 1, turn: 0, run: false, jump: false });

    const expected = (walk.positionZ - LANDING.z) * 1.2;
    expect(Math.abs(walk.surfaceY - expected))
      .withContext('character height against the real stair surface')
      .toBeLessThan(0.3);
  });

  /**
   * The baked blockers describe unreachable *ground*, on a half-metre grid
   * merged into axis-aligned rectangles. Railings, balustrades, lamp posts and
   * parked cars stand on ground that is walkable either side of them, so nothing
   * in that map stops the character walking straight through — only a sweep
   * against the real geometry does.
   */
  describe('obstacle sweep', () => {
    /** A collider that reports a wall across a band of Z. */
    function colliderStub(hits: (toZ: number) => boolean): BodyCollider {
      return {
        setColliders: () => {},
        blocked: (_fx: number, _fy: number, _fz: number, _tx: number, _ty: number, tz: number) =>
          hits(tz),
      } as unknown as BodyCollider;
    }

    it('stops at a railing standing on perfectly walkable ground', () => {
      const walk = new WalkController(
        characterStub(), LANDING.x, LANDING.z, YAW_STREET,
        groundStub(), // ground everywhere: the map alone would let him through
        colliderStub((toZ) => toZ > LANDING.z + 3),
      );
      for (let i = 0; i < 300; i++) {
        walk.update(1 / 60, { forward: 1, turn: 0, run: true, jump: false });
      }
      expect(walk.positionZ).toBeLessThanOrEqual(LANDING.z + 3);
    });

    it('walks freely when nothing is in the way', () => {
      const walk = new WalkController(
        characterStub(), LANDING.x, LANDING.z, YAW_STREET,
        groundStub(),
        colliderStub(() => false),
      );
      for (let i = 0; i < 120; i++) {
        walk.update(1 / 60, { forward: 1, turn: 0, run: false, jump: false });
      }
      expect(walk.positionZ).toBeGreaterThan(LANDING.z + 3);
    });
  });

  describe('jumping', () => {
    /** Records the feet height the controller pushes into the character. */
    function trackingCharacter(): { character: Character; heights: number[] } {
      const heights: number[] = [];
      const character = {
        setGroundPosition: (_x: number, _z: number, y: number) => heights.push(y),
        setYaw: () => {},
        transitionTo: () => {},
        setWalkSpeed: () => {},
        setCrouch: () => {},
      } as unknown as Character;
      return { character, heights };
    }

    it('leaves the ground and comes back to it', () => {
      const { character, heights } = trackingCharacter();
      const walk = new WalkController(character, LANDING.x, LANDING.z, YAW_STREET, groundStub());

      walk.update(1 / 60, { forward: 0, turn: 0, run: false, jump: true });
      expect(walk.isAirborne).withContext('airborne on the frame after take-off').toBe(true);

      for (let i = 0; i < 120; i++) {
        walk.update(1 / 60, { forward: 0, turn: 0, run: false, jump: false });
      }

      expect(walk.isAirborne).withContext('back on the ground within two seconds').toBe(false);
      expect(Math.max(...heights)).withContext('peak height').toBeGreaterThan(0.3);
      expect(heights.at(-1)).withContext('settled back on the ground').toBeCloseTo(0, 2);
    });

    it('ignores a second jump while still in the air', () => {
      const { character, heights } = trackingCharacter();
      const walk = new WalkController(character, LANDING.x, LANDING.z, YAW_STREET, groundStub());

      // Hold jump for the whole flight: without the airborne guard this climbs
      // forever, which is the classic infinite-jump bug.
      for (let i = 0; i < 60; i++) {
        walk.update(1 / 60, { forward: 0, turn: 0, run: false, jump: true });
      }
      expect(Math.max(...heights)).toBeLessThan(1.2);
    });

    it('does not jump when the request never comes', () => {
      const { character, heights } = trackingCharacter();
      const walk = new WalkController(character, LANDING.x, LANDING.z, YAW_STREET, groundStub());
      for (let i = 0; i < 60; i++) {
        walk.update(1 / 60, { forward: 0, turn: 0, run: false, jump: false });
      }
      expect(Math.max(...heights)).toBeCloseTo(0, 3);
      expect(walk.isAirborne).toBe(false);
    });
  });

  describe('the walk itself', () => {
    /** Captures the playback rate pushed into the walk clip. */
    function rateTracking(): { character: Character; rates: number[] } {
      const rates: number[] = [];
      const character = {
        setGroundPosition: () => {},
        setYaw: () => {},
        transitionTo: () => {},
        setWalkSpeed: (r: number) => rates.push(r),
        setCrouch: () => {},
      } as unknown as Character;
      return { character, rates };
    }

    it('builds up to speed instead of starting at a sprint', () => {
      const walk = controller(groundStub());
      const after: number[] = [];
      for (let i = 0; i < 6; i++) {
        walk.update(1 / 60, { forward: 1, turn: 0, run: false, jump: false });
        after.push(walk.positionZ - LANDING.z);
      }
      // Each step is larger than the one before while the ramp is running.
      const steps = after.map((d, i) => d - (after[i - 1] ?? 0));
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]).withContext(`step ${i} against step ${i - 1}`).toBeGreaterThan(steps[i - 1]);
      }
    });

    it('comes to a stop rather than halting dead', () => {
      const walk = controller(groundStub());
      for (let i = 0; i < 120; i++) {
        walk.update(1 / 60, { forward: 1, turn: 0, run: false, jump: false });
      }
      const atRelease = walk.positionZ;
      walk.update(1 / 60, { forward: 0, turn: 0, run: false, jump: false });
      const firstFrame = walk.positionZ - atRelease;
      expect(firstFrame).withContext('still carrying speed the frame after release').toBeGreaterThan(0);

      for (let i = 0; i < 120; i++) {
        walk.update(1 / 60, { forward: 0, turn: 0, run: false, jump: false });
      }
      const settled = walk.positionZ;
      walk.update(1 / 60, { forward: 0, turn: 0, run: false, jump: false });
      expect(walk.positionZ).withContext('fully stopped').toBeCloseTo(settled, 5);
    });

    /**
     * Foot sliding is the single clearest tell that a character is being dragged
     * rather than walking, and it is what a fixed playback rate guarantees.
     */
    it('scales playback with ground speed so the feet stay planted', () => {
      const slow = rateTracking();
      const walkSlow = new WalkController(slow.character, 0, 0, YAW_STREET, groundStub());
      for (let i = 0; i < 200; i++) {
        walkSlow.update(1 / 60, { forward: 1, turn: 0, run: false, jump: false });
      }

      const fast = rateTracking();
      const walkFast = new WalkController(fast.character, 0, 0, YAW_STREET, groundStub());
      for (let i = 0; i < 200; i++) {
        walkFast.update(1 / 60, { forward: 1, turn: 0, run: true, jump: false });
      }

      const walkRate = slow.rates.at(-1)!;
      const runRate = fast.rates.at(-1)!;
      expect(walkRate).withContext('walk plays at roughly its authored rate').toBeCloseTo(1, 1);
      expect(runRate).withContext('running steps faster than walking').toBeGreaterThan(walkRate * 1.5);
    });
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

  /**
   * The model is only dressed up to about six metres above the plaza. Above that
   * it is bare hillside carrying backdrop geometry built to be read from the
   * street far below — walls that stop in mid-air, a shack over a gap, slopes too
   * steep for the camera to sit on. The generated blockers fence it off, and this
   * is what notices if a regenerated map ever stops doing so.
   */
  it('keeps the visitor off the undressed hillside', () => {
    const walk = controller();
    // Spots measured on the bare hill, all previously reachable.
    for (const [x, z] of [[-30, 40], [-26, 30], [-28, 20], [-24, 14], [-21, 12]]) {
      expect(walk.isWalkable(x, z))
        .withContext(`bare hillside at (${x}, ${z})`)
        .toBe(false);
    }
  });

  it('keeps every hotspot below the dressed ceiling', () => {
    // A beacon up on the backdrop terrain is both unreachable and ugly.
    for (const spot of HOTSPOTS) {
      expect(spot.y).withContext(`hotspot "${spot.id}" height`).toBeLessThan(6);
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
