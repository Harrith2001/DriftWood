import * as THREE from 'three';
import {
  ACCELERATION,
  BLOCKERS,
  BODY_RADIUS,
  GRAVITY,
  GROUND_Y,
  HOTSPOTS,
  JUMP_SPEED,
  RUN_MULTIPLIER,
  STRIDE_SPEED,
  TURN_SPEED,
  WALKABLE,
  WALK_SPEED,
} from '../../core/world/world.config';
import type { PanelId } from '../../core/models/experience.model';
import type { Character } from '../character/character';
import type { GroundSampler } from '../world/ground-sampler';
import type { BodyCollider } from './body-collider';

/** Normalised movement intent, produced by keyboard or on-screen touch pad. */
export interface MoveIntent {
  /** -1 back … +1 forward */
  forward: number;
  /** -1 right … +1 left (positive turns anticlockwise) */
  turn: number;
  run: boolean;
  /** One-shot: true on the frame the jump was requested. */
  jump: boolean;
}

/**
 * Third-person ground movement.
 *
 * Axes are resolved independently so that walking into a wall diagonally slides
 * along it instead of stopping dead, which is what makes the narrow spots — the
 * alley mouths, the gap between a stall and a facade — feel navigable rather
 * than sticky.
 *
 * Speed is carried rather than switched. Setting it straight from the key state
 * meant the character reached a jog in one frame and stopped dead in another,
 * with the walk cycle snapping between rates underneath — the single thing that
 * most made him read as a puppet rather than someone walking.
 */
export class WalkController {
  private x: number;
  private z: number;
  private yaw: number;

  /** Signed ground speed, m/s. Ramps toward what the intent asks for. */
  private speed = 0;
  /** Eased surface height under the character. */
  private groundHeight = GROUND_Y;
  /** Feet height. Equal to the ground except while airborne. */
  private feetHeight = GROUND_Y;
  private verticalSpeed = 0;
  private airborne = false;
  /** Decays after a landing, driving the knee bend that absorbs it. */
  private landingRecovery = 0;

  /** How far the eased height may trail the real surface, in metres. */
  private static readonly MAX_GROUND_LAG = 0.28;
  /** Backing up is slower, as it is in every third-person game ever shipped. */
  private static readonly REVERSE_SCALE = 0.55;
  /** Knee bend held in the air, and the spike on touching down. */
  private static readonly AIR_CROUCH = 0.22;
  private static readonly LAND_CROUCH = 0.55;

  constructor(
    private readonly character: Character,
    startX: number,
    startZ: number,
    startYaw: number,
    /**
     * Optional geometry probe. When supplied it has the final say on whether a
     * position has ground under it.
     */
    private readonly ground?: GroundSampler,
    /**
     * Optional obstacle sweep. Without it the character walks through railings,
     * balustrades and parked cars — anything standing on ground that is walkable
     * either side of it.
     */
    private readonly collider?: BodyCollider,
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
  /**
   * Surface the character is standing on. The camera rig anchors to this rather
   * than to the feet, so a jump does not throw the camera half a metre upward.
   */
  get surfaceY(): number {
    return this.groundHeight;
  }
  get isAirborne(): boolean {
    return this.airborne;
  }
  /** Where the feet actually are. Above the ground only while jumping. */
  get feetY(): number {
    return this.feetHeight;
  }

  /**
   * Teleports the controller, e.g. after the arrival hands over control.
   *
   * `nearY` is the height to look for ground around. It matters on the hill:
   * teleporting to a hotspot down the stair street and searching around the
   * plaza's height would find no road there at all.
   */
  reset(x: number, z: number, yaw: number, nearY: number = GROUND_Y): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.verticalSpeed = 0;
    this.airborne = false;
    this.landingRecovery = 0;
    this.groundHeight = this.ground?.heightAt(x, z, nearY) ?? GROUND_Y;
    this.feetHeight = this.groundHeight;
    this.character.setCrouch(0);
    this.character.setGroundPosition(x, z, this.feetHeight);
    this.character.setYaw(yaw);
  }

  update(delta: number, intent: MoveIntent): void {
    this.yaw += intent.turn * TURN_SPEED * delta;

    this.advance(delta, intent);
    this.followGround(delta);
    this.applyJump(delta, intent);

    this.character.setGroundPosition(this.x, this.z, this.feetHeight);
    this.character.setYaw(this.yaw);

    this.drivePose(delta);
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  /** Ramps toward the requested speed and moves, one axis at a time. */
  private advance(delta: number, intent: MoveIntent): void {
    const top = WALK_SPEED * (intent.run ? RUN_MULTIPLIER : 1);
    const wanted = intent.forward * top * (intent.forward < 0 ? WalkController.REVERSE_SCALE : 1);

    // Air control is real but weak — you cannot change your mind mid-jump.
    const rate = ACCELERATION * (this.airborne ? 0.25 : 1) * delta;
    this.speed = moveToward(this.speed, wanted, rate);

    const distance = this.speed * delta;
    if (Math.abs(distance) < 1e-6) return;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);

    // Independent axis resolution → wall sliding.
    const nextX = this.x + sin * distance;
    if (this.canStand(nextX, this.z) && this.canReach(nextX, this.z)) this.x = nextX;

    const nextZ = this.z + cos * distance;
    if (this.canStand(this.x, nextZ) && this.canReach(this.x, nextZ)) this.z = nextZ;
  }

  /**
   * True when nothing solid stands between here and there.
   *
   * Skipped while airborne: mid-jump the body is above the step ray, and testing
   * from the ground would refuse a jump over the very thing being cleared.
   */
  private canReach(toX: number, toZ: number): boolean {
    if (!this.collider || this.airborne) return true;
    const toY = this.ground?.heightAt(toX, toZ, this.groundHeight) ?? this.groundHeight;
    return !this.collider.blocked(this.x, this.groundHeight, this.z, toX, toY, toZ);
  }

  /** Follows the real surface, easing over kerbs but never lagging far behind. */
  private followGround(delta: number): void {
    const surface = this.ground?.heightAt(this.x, this.z, this.groundHeight) ?? GROUND_Y;

    // The streets climb and fall by 52 metres across the neighbourhood, and
    // kerbs put pavement and roadway at different heights within a stride of
    // each other, so a fixed height would leave the character hovering in some
    // places and sunk in others. Eased, so a kerb is a settle rather than a snap.
    this.groundHeight = THREE.MathUtils.lerp(this.groundHeight, surface, Math.min(1, delta * 12));

    // …but never more than a stride behind it. The stair flights run at a 1.2
    // gradient, so climbing one lifts the ground at several metres a second —
    // far faster than the easing can follow, and he waded through the treads up
    // to the knee the whole way.
    this.groundHeight = THREE.MathUtils.clamp(
      this.groundHeight,
      surface - WalkController.MAX_GROUND_LAG,
      surface + WalkController.MAX_GROUND_LAG,
    );
  }

  /** Take-off, flight and touchdown. */
  private applyJump(delta: number, intent: MoveIntent): void {
    if (intent.jump && !this.airborne) {
      this.airborne = true;
      this.verticalSpeed = JUMP_SPEED;
    }

    if (!this.airborne) {
      this.feetHeight = this.groundHeight;
      return;
    }

    this.verticalSpeed -= GRAVITY * delta;
    this.feetHeight += this.verticalSpeed * delta;

    // Landing. Coming down onto ground higher than take-off — a kerb, the next
    // step of a flight — lands early, which is the point of jumping onto it.
    if (this.verticalSpeed <= 0 && this.feetHeight <= this.groundHeight) {
      this.feetHeight = this.groundHeight;
      this.airborne = false;
      // Scale the knee bend to the speed of the impact, so hopping down a kerb
      // and dropping off a wall do not read as the same landing.
      this.landingRecovery = THREE.MathUtils.clamp(-this.verticalSpeed / JUMP_SPEED, 0.25, 1);
      this.verticalSpeed = 0;
    }
  }

  // ── Pose ───────────────────────────────────────────────────────────────────

  private drivePose(delta: number): void {
    this.landingRecovery = Math.max(0, this.landingRecovery - delta * 4);

    const crouch = this.airborne
      ? WalkController.AIR_CROUCH
      : this.landingRecovery * WalkController.LAND_CROUCH;
    this.character.setCrouch(crouch);

    if (this.airborne) {
      // Hold whatever cycle was running rather than cutting to a clip that does
      // not exist: the only airborne animation in the set is a skydive, which
      // over half a second of hop reads as a bug rather than a jump. The tucked
      // knees above carry it.
      return;
    }

    const pace = Math.abs(this.speed);
    if (pace > 0.15) {
      this.character.transitionTo('walking', 0.18);
      // Playback tracks ground speed, so the feet stay planted. Floored so a
      // creep does not become a slideshow, capped so a sprint through a walk
      // cycle does not turn the legs into a blur.
      this.character.setWalkSpeed(THREE.MathUtils.clamp(pace / STRIDE_SPEED, 0.5, 2.1));
    } else {
      this.character.transitionTo('idle', 0.25);
    }
  }

  // ── Constraints ────────────────────────────────────────────────────────────

  /**
   * A position is valid when the body fits inside the play bounds, is clear of
   * the generated blockers, and has real ground under it.
   *
   * The body radius is checked with probe points rather than by shrinking the
   * rectangle, which is what lets several rectangles meet without a seam: an
   * inset applied to each individually leaves a band belonging to neither, and
   * on the beach that band ran the full length of the pier and stopped the
   * character stepping off it entirely.
   */
  canStand(x: number, z: number, nearY: number = this.groundHeight): boolean {
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

    // Ground with no route to it: interiors, rooftops, banks too steep to climb.
    // Inflated by the body radius so he stops short rather than clipping a
    // shoulder through. Generated from the mesh — see `city-blockers.ts`.
    const blocked = BLOCKERS.some(
      (b) => x >= b.minX - r && x <= b.maxX + r && z >= b.minZ - r && z <= b.maxZ + r,
    );
    if (blocked) return false;

    // Centre point only — probing the whole footprint as well sounds safer but
    // is far too strict on narrow geometry, and on the beach that mistake pinned
    // the character to the spot he landed on. Standing with a heel over a kerb
    // is normal; stepping off a terrace into thin air is not.
    return this.ground ? this.ground.hasGround(x, z, nearY) : true;
  }

  /** @deprecated Kept as the name the tests and older callers use. */
  isWalkable(x: number, z: number, nearY: number = GROUND_Y): boolean {
    return this.canStand(x, z, nearY);
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

/** Steps `current` toward `target` by at most `maxDelta`. */
function moveToward(current: number, target: number, maxDelta: number): number {
  const difference = target - current;
  if (Math.abs(difference) <= maxDelta) return target;
  return current + Math.sign(difference) * maxDelta;
}
