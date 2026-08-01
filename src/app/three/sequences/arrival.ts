import * as THREE from 'three';
import gsap from 'gsap';
import {
  FOV_EXPLORE,
  FOV_INTRO,
  GROUND_Y,
  LANDING,
  SKY_Y,
  YAW_INLAND,
  YAW_PORTRAIT,
} from '../../core/world/world.config';
import type { Character } from '../character/character';
import type { CameraRig } from '../camera/camera-rig';
import type { CloudField } from '../world/clouds';
import type { ImpactBurst } from '../effects/impact-burst';

/**
 * The cinematic arrival.
 *
 * One input arms it and it plays through as an uninterruptible piece of
 * choreography — no scrubbing, no parachute. The beats:
 *
 *   0.0  the portrait breaks; the body tips into a belly-to-earth dive
 *   0.0  accelerating freefall, camera trailing, clouds tearing past
 *   2.4  time dilates and the body swings feet-down for the landing
 *   3.3  IMPACT — dust ring, shockwave, camera shake, hard cut to a low angle
 *   3.3  held in a deep three-point crouch
 *   4.1  rise to standing, time returns to normal
 *   5.3  the rig settles behind the shoulder and control is handed over
 *
 * `applyState` is a pure projection of the tweened numbers onto the scene, so
 * any point on the timeline produces a coherent frame.
 */

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

/**
 * Orientation keyframes.
 *
 * `Q_DIVE` composes the inland yaw with a pitch so the pitch happens in the
 * body's own frame — belly to earth while still facing the island. A bare
 * world-X rotation would silently discard the yaw and the dive would read as a
 * lopsided diagonal tumble.
 */
const Q_PORTRAIT = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, YAW_PORTRAIT);
const Q_DIVE = new THREE.Quaternion()
  .setFromAxisAngle(AXIS_Y, YAW_INLAND)
  .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, Math.PI * 0.46));
const Q_LAND = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, YAW_INLAND);

/** Height at which the descent slows and the body rotates upright to land. */
const FLARE_Y = 11;

interface ArrivalState {
  /** Height of the soles above world zero. */
  feetY: number;
  /** 0 → portrait, 1 → belly-down dive, 2 → upright, feet first. */
  orientation: number;
  /** Landing crouch, 0..1. */
  crouch: number;
  /** Impact effect progress; 0 or 1 means dormant. */
  impact: number;
  /** Blends the camera from the descent rig to the low hero angle, 0..1. */
  heroAngle: number;
}

export class ArrivalSequence {
  private timeline: gsap.core.Timeline | null = null;
  private readonly state: ArrivalState = {
    feetY: SKY_Y,
    orientation: 0,
    crouch: 0,
    impact: 0,
    heroAngle: 0,
  };

  private readonly scratchQuat = new THREE.Quaternion();
  private readonly camPosition = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly heroPosition = new THREE.Vector3();
  private readonly heroTarget = new THREE.Vector3();

  constructor(
    private readonly character: Character,
    private readonly rig: CameraRig,
    private readonly clouds: CloudField,
    private readonly impact: ImpactBurst,
    /**
     * Height of the deck he actually lands on. Probed from geometry, because
     * the nominal ground constant sits ~0.4 above the pier and touching down on
     * it left him hovering, then popping down when control was handed over.
     */
    private readonly landingY: number = GROUND_Y,
  ) {}

  /**
   * Builds and plays the arrival.
   * @param onComplete invoked once the character is standing and in control
   */
  play(onComplete: () => void): void {
    this.reset();
    this.impact.setOrigin(LANDING.x, this.landingY + 0.02, LANDING.z);

    const s = this.state;
    this.timeline = gsap.timeline({
      onUpdate: () => this.applyState(),
      onComplete: () => {
        this.applyState();
        onComplete();
      },
    });

    // Note on the "slow motion": it is authored into the durations, not applied
    // by tweening the timeline's own `timeScale`. A timeline that tweens its own
    // timeScale feeds back into the very tween driving it, and the whole
    // sequence collapses to a fraction of its intended length. The flare simply
    // covers 8 units in 1.2 s where the freefall covered 25 in 2.4 s, which
    // reads as time dilating without any of the instability.
    this.timeline
      // ── Freefall ──
      .to(s, { orientation: 1, duration: 0.8, ease: 'power1.inOut' }, 0)
      // power2.in reads as gravity rather than a lerp.
      .to(s, { feetY: FLARE_Y, duration: 2.4, ease: 'power2.in' }, 0)

      // ── The flare: body swings feet-down, camera drops to a hero angle ──
      .to(s, { orientation: 2, duration: 0.7, ease: 'power3.out' }, 2.35)
      .to(s, { heroAngle: 1, duration: 0.8, ease: 'power2.inOut' }, 2.4)
      .to(s, { feetY: this.landingY, duration: 1.2, ease: 'power1.in' }, 2.4)

      // ── Impact ──
      .add(() => this.onImpact(), 3.6)
      .to(s, { crouch: 1, duration: 0.1, ease: 'power4.out' }, 3.6)
      .to(s, { impact: 1, duration: 1.6, ease: 'none' }, 3.6)

      // ── Recovery ──
      // The crouch releases with a slight overshoot so he settles rather than
      // snapping straight, and the rig climbs back out of the hero angle.
      .to(s, { crouch: 0, duration: 0.95, ease: 'back.out(1.5)' }, 4.0)
      .to(s, { heroAngle: 0, duration: 1.2, ease: 'power2.inOut' }, 4.15)
      // Tail so the rig finishes settling before control changes hands.
      .to({}, { duration: 0.45 }, 5.35);
  }

  /** Skips straight to standing — used for reduced-motion visitors. */
  skipToLanding(): void {
    this.timeline?.kill();
    this.timeline = null;
    this.state.feetY = this.landingY;
    this.state.orientation = 2;
    this.state.crouch = 0;
    this.state.impact = 0;
    this.state.heroAngle = 0;
    this.applyState();
  }

  private reset(): void {
    this.state.feetY = SKY_Y;
    this.state.orientation = 0;
    this.state.crouch = 0;
    this.state.impact = 0;
    this.state.heroAngle = 0;
  }

  private onImpact(): void {
    // Trauma, not a fixed offset: the shake decays on its own curve.
    this.rig.addTrauma(0.85);
  }

  /** Projects the tweened state onto character, camera, clouds and effects. */
  private applyState(): void {
    const { feetY, orientation, crouch, impact } = this.state;

    // The crouch drops the body, so the feet stay planted while the knees bend.
    this.character.setCrouch(crouch);
    this.character.setFeetHeight(LANDING.x, feetY - this.character.crouchDrop, LANDING.z);

    if (orientation <= 1) {
      this.scratchQuat.slerpQuaternions(Q_PORTRAIT, Q_DIVE, easeInOut(orientation));
    } else {
      this.scratchQuat.slerpQuaternions(Q_DIVE, Q_LAND, easeInOut(orientation - 1));
    }
    this.character.setQuaternion(this.scratchQuat);

    // Arms-wide freefall clip only while actually falling.
    const falling = orientation > 0.45 && orientation < 1.6;
    this.character.transitionTo(falling ? 'falling' : 'idle', 0.25);

    this.impact.update(impact);

    // ── Camera ──
    const progress = THREE.MathUtils.clamp((SKY_Y - feetY) / (SKY_Y - this.landingY), 0, 1);
    const originY = this.character.position.y;

    // Descent rig: trails behind and above, out over the water.
    const distance = THREE.MathUtils.lerp(4.5, 7.5, progress);
    this.camPosition.set(
      LANDING.x + distance,
      originY + THREE.MathUtils.lerp(6.5, 3.2, progress),
      LANDING.z,
    );
    this.camTarget.set(LANDING.x - 2, originY + THREE.MathUtils.lerp(-2, 1.0, progress), LANDING.z);

    // Hero rig: down at deck level, looking up past him at the sky. Offset in Z
    // so the shot is three-quarter rather than dead-on.
    this.heroPosition.set(LANDING.x + 4.2, this.landingY + 0.55, LANDING.z + 3.1);
    this.heroTarget.set(LANDING.x - 0.4, this.landingY + 1.5, LANDING.z);

    const hero = smoothstep(this.state.heroAngle);
    this.camPosition.lerp(this.heroPosition, hero);
    this.camTarget.lerp(this.heroTarget, hero);

    // Wide at speed, tightening for the hero beat.
    const fov = THREE.MathUtils.lerp(FOV_INTRO + 10, FOV_EXPLORE, progress) - hero * 8;

    this.rig.setDesired(this.camPosition, this.camTarget, fov);
    this.clouds.setVisibility(Math.max(0, 1 - progress * 1.6));
  }

  dispose(): void {
    this.timeline?.kill();
    this.timeline = null;
  }
}

function easeInOut(t: number): number {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
}

function smoothstep(t: number): number {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
}
