import * as THREE from 'three';
import {
  BLOCKERS,
  BODY_RADIUS,
  GROUND_Y,
  HOTSPOTS,
  RUN_MULTIPLIER,
  TURN_SPEED,
  WALKABLE,
  WALK_SPEED,
} from '../../core/world/world.config';
import type { PanelId } from '../../core/models/experience.model';
import type { Character } from '../character/character';
import type { GroundSampler } from '../world/ground-sampler';

/** Normalised movement intent, produced by keyboard or on-screen touch pad. */
export interface MoveIntent {
  /** -1 back … +1 forward */
  forward: number;
  /** -1 right … +1 left (positive turns anticlockwise) */
  turn: number;
  run: boolean;
}

/**
 * Third-person ground movement, constrained to the sand and pier.
 *
 * Axes are resolved independently so that walking into a wall diagonally slides
 * along it instead of stopping dead, which is what makes tight spots (the gap
 * between the cabin and the water) feel navigable rather than sticky.
 */
export class WalkController {
  private x: number;
  private z: number;
  private yaw: number;
  /** Smoothed 0..1 gait, used to blend idle → walk and scale playback rate. */
  private gait = 0;
  /** Eased surface height under the character. */
  private groundHeight = GROUND_Y;

  constructor(
    private readonly character: Character,
    startX: number,
    startZ: number,
    startYaw: number,
    /**
     * Optional geometry probe. When supplied it has the final say on whether a
     * position is standable, which keeps the character on the real shoreline
     * rather than on the approximate rectangle drawn around it.
     */
    private readonly ground?: GroundSampler,
  ) {
    this.x = startX;
    this.z = startZ;
    this.yaw = startYaw;
  }

  get positionX(): number {
    return this.x;
  }
  get positionZ(): number {
    return this.z;
  }
  get facing(): number {
    return this.yaw;
  }

  /** Teleports the controller, e.g. after the arrival hands over control. */
  reset(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.gait = 0;
    this.groundHeight = this.ground?.heightAt(x, z) ?? GROUND_Y;
    this.character.setGroundPosition(x, z, this.groundHeight);
    this.character.setYaw(yaw);
  }

  update(delta: number, intent: MoveIntent): void {
    this.yaw += intent.turn * TURN_SPEED * delta;

    const speed = WALK_SPEED * (intent.run ? RUN_MULTIPLIER : 1);
    // Backing up is slower, as it is in every third-person game ever shipped.
    const signedSpeed = intent.forward >= 0 ? speed : speed * 0.55;
    const distance = intent.forward * signedSpeed * delta;

    if (distance !== 0) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);

      // Independent axis resolution → wall sliding.
      const nextX = this.x + sin * distance;
      if (this.isWalkable(nextX, this.z)) this.x = nextX;

      const nextZ = this.z + cos * distance;
      if (this.isWalkable(this.x, nextZ)) this.z = nextZ;
    }

    // Follow the real surface rather than a constant. The beach slopes and the
    // pier deck sits lower than the sand, so a fixed height left the character
    // hovering in some places and sunk in others. Eased, so stepping from sand
    // onto decking is a settle rather than a snap.
    const surface = this.ground?.heightAt(this.x, this.z) ?? GROUND_Y;
    this.groundHeight = THREE.MathUtils.lerp(this.groundHeight, surface, Math.min(1, delta * 12));

    this.character.setGroundPosition(this.x, this.z, this.groundHeight);
    this.character.setYaw(this.yaw);

    // Ease the gait so a tapped key does not stutter the animation.
    const target = Math.abs(intent.forward) > 0.05 ? (intent.run ? 1 : 0.6) : 0;
    this.gait = THREE.MathUtils.lerp(this.gait, target, Math.min(1, delta * 8));

    if (this.gait > 0.08) {
      this.character.transitionTo('walking', 0.18);
      // Map gait onto playback rate so running does not look like slow-motion.
      this.character.setWalkSpeed(THREE.MathUtils.lerp(0.85, 1.75, this.gait));
    } else {
      this.character.transitionTo('idle', 0.25);
    }
  }

  /**
   * A position is valid when the body fits entirely inside the walkable union
   * and clear of every blocker.
   *
   * The body radius is checked with probe points rather than by shrinking each
   * rectangle. Insetting the rectangles individually put a dead zone along every
   * internal seam: the pier ends at x=0.3 and the sand begins at x=0.3, so
   * insetting both left a 0.9-unit band that belonged to neither and the
   * character could never step off the pier onto the island at all. Probing the
   * union instead means a seam is invisible — the probe simply lands in the
   * neighbouring rectangle — while a genuine outer edge still blocks, because
   * there the probe falls into open water.
   */
  isWalkable(x: number, z: number): boolean {
    if (!isInsideWalkable(x, z)) return false;

    const r = BODY_RADIUS;
    if (
      !isInsideWalkable(x + r, z) ||
      !isInsideWalkable(x - r, z) ||
      !isInsideWalkable(x, z + r) ||
      !isInsideWalkable(x, z - r)
    ) {
      return false;
    }

    // Blockers are inflated instead, so the body keeps its distance from walls.
    const blocked = BLOCKERS.some(
      (b) => x >= b.minX - r && x <= b.maxX + r && z >= b.minZ - r && z <= b.maxZ + r,
    );
    if (blocked) return false;

    // Final authority: is there real ground here? The rectangles above are only
    // an approximation of an irregular island, and the sand one overhangs the
    // western shoreline — without this check the character walks out onto open
    // sea with the island receding behind him.
    // Centre point only. Probing the whole footprint as well sounds safer but
    // is far too strict on narrow geometry: the pier decking is barely wider
    // than the body, so requiring ground under every offset blocked movement in
    // all directions and pinned the character to the spot he landed on.
    // Standing with a heel slightly over an edge is normal; walking on water is
    // not, and the centre test is what prevents that.
    return this.ground ? this.ground.hasGround(x, z) : true;
  }

  /** Nearest hotspot within its radius, or null. */
  findNearbyHotspot(): PanelId | null {
    let best: PanelId | null = null;
    let bestDistance = Infinity;

    for (const spot of HOTSPOTS) {
      const distance = Math.hypot(spot.x - this.x, spot.z - this.z);
      if (distance <= spot.radius && distance < bestDistance) {
        bestDistance = distance;
        best = spot.id;
      }
    }
    return best;
  }
}

/** Raw containment test against the walkable union, with no body inset. */
function isInsideWalkable(x: number, z: number): boolean {
  return WALKABLE.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}
