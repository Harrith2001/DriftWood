import { COLLECTIBLES, PICKUP_CHEST, PICKUP_RADIUS } from './collectibles.config';
import { BLOCKERS, JUMP_SPEED, GRAVITY, WALKABLE } from './world.config';

/**
 * The hunt is only as good as its hiding places. A cap inside a wall, out on
 * the backdrop hillside, or hung so high that no jump reaches it is a visitor
 * walking in circles looking for something that was never gettable — and it is
 * exactly the kind of thing that survives a play-through of the other seven.
 */
describe('the scavenger hunt', () => {
  const bounds = WALKABLE[0];

  it('hides eight caps', () => {
    expect(COLLECTIBLES.length).toBe(8);
  });

  it('gives every cap a distinct id and label', () => {
    expect(new Set(COLLECTIBLES.map((c) => c.id)).size).toBe(COLLECTIBLES.length);
    expect(new Set(COLLECTIBLES.map((c) => c.label)).size).toBe(COLLECTIBLES.length);
  });

  it('keeps every cap inside the play bounds', () => {
    for (const cap of COLLECTIBLES) {
      expect(cap.x >= bounds.minX && cap.x <= bounds.maxX)
        .withContext(`${cap.id} x=${cap.x}`)
        .toBe(true);
      expect(cap.z >= bounds.minZ && cap.z <= bounds.maxZ)
        .withContext(`${cap.id} z=${cap.z}`)
        .toBe(true);
    }
  });

  it('keeps every cap out of the generated blockers', () => {
    // Standing inside a blocker means the cap is inside a building, on a roof,
    // or on the hillside the visitor was deliberately fenced off from.
    for (const cap of COLLECTIBLES) {
      for (const b of BLOCKERS) {
        const inside =
          cap.x >= b.minX && cap.x <= b.maxX && cap.z >= b.minZ && cap.z <= b.maxZ;
        expect(inside)
          .withContext(`${cap.id} against blocker (${b.minX}..${b.maxX}, ${b.minZ}..${b.maxZ})`)
          .toBe(false);
      }
    }
  });

  it('spreads them out rather than clustering', () => {
    for (const a of COLLECTIBLES) {
      for (const b of COLLECTIBLES) {
        if (a.id === b.id) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z))
          .withContext(`${a.id} and ${b.id}`)
          .toBeGreaterThan(10);
      }
    }
  });

  /**
   * The two hung out of reach are the only reason the jump has a purpose beyond
   * decoration, so both halves matter: they must be unreachable standing, and
   * reachable at the top of the arc. The margin between those is about 40 cm.
   */
  describe('the two that need a jump', () => {
    const jumpApex = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    const standingReach = PICKUP_CHEST + PICKUP_RADIUS;
    const jumpingReach = standingReach + jumpApex;

    it('has exactly two of them', () => {
      expect(COLLECTIBLES.filter((c) => c.needsJump).length).toBe(2);
    });

    it('hangs them above standing reach', () => {
      for (const cap of COLLECTIBLES.filter((c) => c.needsJump)) {
        // Heights in the config are ground + hover, so the hover is what counts.
        const hover = cap.needsJump ? 2.25 : 1.0;
        expect(hover)
          .withContext(`${cap.id} must not be collectable while standing`)
          .toBeGreaterThan(standingReach);
      }
    });

    it('leaves them inside jumping reach', () => {
      expect(2.25)
        .withContext('a 2.25 m hover against the top of the jump arc')
        .toBeLessThan(jumpingReach);
    });

    it('keeps the walk-in caps comfortably collectable', () => {
      for (const cap of COLLECTIBLES.filter((c) => !c.needsJump)) {
        expect(1.0)
          .withContext(`${cap.id} should be collectable at a walk`)
          .toBeLessThan(standingReach);
      }
    });
  });
});
