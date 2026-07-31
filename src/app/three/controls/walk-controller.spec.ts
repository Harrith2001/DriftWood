import { WalkController } from './walk-controller';
import type { Character } from '../character/character';
import { BLOCKERS, HOTSPOTS, LANDING, WALKABLE, YAW_INLAND } from '../../core/world/world.config';

/**
 * Movement constraints. These assert the character cannot walk off the sand,
 * into the sea, or through the beach house — the boundaries the visitor is never
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

  function controller(): WalkController {
    return new WalkController(characterStub(), LANDING.x, LANDING.z, YAW_INLAND);
  }

  it('accepts the landing point on the pier', () => {
    expect(controller().isWalkable(LANDING.x, LANDING.z)).toBe(true);
  });

  it('rejects open water beyond the pier', () => {
    const walk = controller();
    // Well past the seaward end of every walkable region.
    expect(walk.isWalkable(20, 0.7)).toBe(false);
    expect(walk.isWalkable(LANDING.x, 40)).toBe(false);
  });

  it('rejects the interior of the beach house', () => {
    const house = BLOCKERS[0];
    const centreX = (house.minX + house.maxX) / 2;
    const centreZ = (house.minZ + house.maxZ) / 2;
    expect(controller().isWalkable(centreX, centreZ)).toBe(false);
  });

  it('rejects the interior of the changing cabin', () => {
    const cabin = BLOCKERS[1];
    const centreX = (cabin.minX + cabin.maxX) / 2;
    const centreZ = (cabin.minZ + cabin.maxZ) / 2;
    expect(controller().isWalkable(centreX, centreZ)).toBe(false);
  });

  it('keeps a body-width clear of walkable edges', () => {
    const sand = WALKABLE[1];
    // Exactly on the boundary must fail; the inset is what stops the character
    // standing half-submerged at the waterline.
    expect(controller().isWalkable(sand.minX, 0)).toBe(false);
  });

  it('does not move when there is no input', () => {
    const walk = controller();
    walk.update(1 / 60, { forward: 0, turn: 0, run: false });
    expect(walk.positionX).toBeCloseTo(LANDING.x, 5);
    expect(walk.positionZ).toBeCloseTo(LANDING.z, 5);
  });

  it('moves along its facing when walking forward', () => {
    const walk = controller();
    const startX = walk.positionX;
    // Facing inland (-X), so forward decreases X.
    for (let i = 0; i < 30; i++) walk.update(1 / 60, { forward: 1, turn: 0, run: false });
    expect(walk.positionX).toBeLessThan(startX);
  });

  it('refuses to leave the walkable area however long you push', () => {
    const walk = controller();
    // Two hundred frames of running straight at the sea.
    for (let i = 0; i < 200; i++) walk.update(1 / 60, { forward: -1, turn: 0, run: true });
    expect(walk.isWalkable(walk.positionX, walk.positionZ)).toBe(true);
  });

  it('reports a hotspot once inside its radius', () => {
    const spot = HOTSPOTS[0];
    const walk = new WalkController(characterStub(), spot.x, spot.z, YAW_INLAND);
    expect(walk.findNearbyHotspot()).toBe(spot.id);
  });

  it('reports nothing when clear of every hotspot', () => {
    // Far corner of the sand, deliberately away from all four beacons.
    const walk = new WalkController(characterStub(), -10, 9, YAW_INLAND);
    expect(walk.findNearbyHotspot()).toBeNull();
  });

  it('places every hotspot on walkable ground', () => {
    // A beacon the character cannot reach is a dead end for the visitor.
    const walk = controller();
    for (const spot of HOTSPOTS) {
      expect(walk.isWalkable(spot.x, spot.z)).toBe(true);
    }
  });
});
