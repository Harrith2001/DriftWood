import * as THREE from 'three';
import gsap from 'gsap';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PanelId, QualitySettings } from '../core/models/experience.model';
import {
  ASSETS,
  CAM_INTRO_POS,
  CAM_INTRO_TARGET,
  FOV_EXPLORE,
  FOV_INTRO,
  GROUND_Y,
  LANDING,
  SKY_Y,
  YAW_INLAND,
} from '../core/world/world.config';
import { RenderPipeline } from './engine/renderer';
import { AssetLoader } from './loading/asset-loader';
import { createLighting } from './world/lighting';
import { createSky } from './world/sky';
import { CloudField } from './world/clouds';
import { Environment } from './world/environment';
import { Beacons } from './world/beacons';
import { GroundSampler } from './world/ground-sampler';
import { Character } from './character/character';
import { CameraRig } from './camera/camera-rig';
import { OccluderFade } from './camera/occluder-fade';
import { ArrivalSequence } from './sequences/arrival';
import { ImpactBurst } from './effects/impact-burst';
import { WalkController } from './controls/walk-controller';
import { InputSource } from './controls/input-source';
import { disposeObject } from './util/dispose';

/**
 * Callbacks the world uses to report upward. Keeps this layer free of any
 * Angular dependency — the component adapts these onto signals.
 */
export interface WorldCallbacks {
  onLoadProgress(fraction01: number): void;
  onLoadError(message: string): void;
  onReady(): void;
  onLanded(): void;
  onNearbyHotspotChange(id: PanelId | null): void;
  onInteract(): void;
}

/**
 * Owns the entire Three.js side of the experience: scene graph, render loop,
 * and the handover from the autoplayed arrival to visitor-driven exploration.
 *
 * Framework-agnostic by design. It is constructed with a canvas and a set of
 * callbacks, and knows nothing about how the surrounding UI is rendered.
 */
export class OceanWorld {
  private readonly scene = new THREE.Scene();
  /**
   * Timer rather than the deprecated Clock. It also clamps automatically while
   * the tab is hidden, which stops a background tab from accumulating a
   * multi-second delta and teleporting the character on return.
   */
  private readonly timer = new THREE.Timer();
  private rafId: number | null = null;
  private disposed = false;

  private pipeline!: RenderPipeline;
  private rig!: CameraRig;
  private clouds!: CloudField;
  private beacons!: Beacons;
  private environment!: Environment;
  private character!: Character;
  private impact!: ImpactBurst;
  private arrival!: ArrivalSequence;
  private occluders = new OccluderFade();
  private groundSampler = new GroundSampler();
  private walk!: WalkController;
  private input!: InputSource;

  private phase: 'loading' | 'intro' | 'arrival' | 'explore' = 'loading';
  private nearbyHotspot: PanelId | null = null;
  private movementEnabled = true;
  private discovered: ReadonlySet<PanelId> = new Set();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly quality: QualitySettings,
    private readonly callbacks: WorldCallbacks,
    private readonly reducedMotion: boolean,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    const { mesh: sky, fog } = createSky();
    this.scene.add(sky);
    this.scene.fog = fog;
    this.scene.add(createLighting(this.quality));

    this.clouds = new CloudField(this.quality.cloudCount);
    this.scene.add(this.clouds.group);

    this.rig = new CameraRig(
      window.innerWidth / window.innerHeight,
      FOV_INTRO,
      CAM_INTRO_POS,
      CAM_INTRO_TARGET,
    );

    this.pipeline = new RenderPipeline(this.canvas, this.scene, this.rig.camera, this.quality);

    // Start the loop immediately: the sky and clouds render while the heavy
    // assets stream in, so the first frame is never a black canvas.
    this.tick();

    let assets: Record<'island' | 'character' | 'idle' | 'walk' | 'fall', GLTF>;
    try {
      const loader = new AssetLoader((p) => this.callbacks.onLoadProgress(p));
      assets = await loader.loadAll([
        // Weights approximate the byte sizes so the bar moves at a sane rate.
        { key: 'island', url: ASSETS.island, weight: 10 },
        { key: 'character', url: ASSETS.character, weight: 4 },
        { key: 'idle', url: ASSETS.animations.idle, weight: 1 },
        { key: 'walk', url: ASSETS.animations.walk, weight: 1 },
        { key: 'fall', url: ASSETS.animations.fall, weight: 1 },
      ]);
    } catch (error) {
      this.callbacks.onLoadError(
        error instanceof Error ? error.message : 'The island could not be loaded.',
      );
      return;
    }
    if (this.disposed) return;

    this.environment = new Environment(assets.island, this.quality);
    this.scene.add(this.environment.root);
    this.rig.setColliders(this.environment.colliders);
    this.occluders.setTargets(this.environment.colliders);
    // Only real sand and decking — never the water plane or the sea bed.
    this.groundSampler.setTargets(this.environment.walkableSurfaces);

    this.character = new Character(
      assets.character,
      {
        idle: assets.idle.animations[0],
        walk: assets.walk.animations[0],
        fall: assets.fall.animations[0],
      },
      this.quality,
    );
    this.scene.add(this.character.root);

    this.impact = new ImpactBurst();
    this.scene.add(this.impact.group);

    this.beacons = new Beacons();
    this.scene.add(this.beacons.group);

    this.walk = new WalkController(
      this.character,
      LANDING.x,
      LANDING.z,
      YAW_INLAND,
      this.groundSampler,
    );
    this.input = new InputSource();
    this.input.setEnabled(false); // no walking until touchdown

    // Probe the deck once so the arrival touches down on the real surface.
    const landingY = this.groundSampler.heightAt(LANDING.x, LANDING.z) ?? GROUND_Y;
    this.arrival = new ArrivalSequence(
      this.character,
      this.rig,
      this.clouds,
      this.impact,
      landingY,
    );

    // Intro pose: standing tall in the sky, facing the camera.
    this.character.setFeetHeight(LANDING.x, SKY_Y, LANDING.z);
    this.character.snapTo('idle');
    this.rig.setDesired(CAM_INTRO_POS, CAM_INTRO_TARGET, FOV_INTRO);
    this.rig.snap();

    this.phase = 'intro';
    this.callbacks.onReady();

    // Reduced motion: skip the fall outright rather than autoplay a long,
    // camera-heavy sequence at someone who asked the OS not to.
    if (this.reducedMotion) this.beginExploration(true);
  }

  /** Arms the arrival. Safe to call more than once; only the first takes effect. */
  startArrival(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'arrival';

    if (this.reducedMotion) {
      this.beginExploration(true);
      return;
    }
    this.arrival.play(() => this.beginExploration(false));
  }

  /**
   * Jumps straight to exploration, skipping the arrival choreography.
   *
   * Valid from the intro *or* mid-arrival: a visitor who decides four seconds in
   * that they would rather just look around should not have to wait it out.
   */
  skipArrival(): void {
    if (this.phase === 'explore') return;
    this.arrival?.skipToLanding();
    this.beginExploration(true);
  }

  private beginExploration(immediate: boolean): void {
    if (this.phase === 'explore') return;
    if (immediate) this.arrival?.skipToLanding();

    this.phase = 'explore';
    this.character.setCrouch(0);
    this.walk.reset(LANDING.x, LANDING.z, YAW_INLAND);
    this.character.snapTo('idle');

    // Seat the camera behind the character before the first explore frame, so
    // control does not begin with a lurch from the landing shot.
    this.rig.followCharacter(LANDING.x, LANDING.z, YAW_INLAND, 1 / 60, FOV_EXPLORE);
    if (immediate) this.rig.snap();

    this.input.setEnabled(true);
    this.callbacks.onLanded();
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  private readonly tick = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);

    // Clamp anyway: a stalled frame on a weak device would otherwise let the
    // character step straight through a collision check.
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 1 / 20);

    this.character?.update(delta);

    if (!this.reducedMotion) this.clouds.update(delta);

    if (this.phase === 'explore') this.updateExploration(delta);

    this.beacons?.update(delta, this.nearbyHotspot, this.discovered);

    // The arrival owns the camera outright; exploration wants a snappier rig.
    this.rig.update(delta, this.phase === 'arrival' ? 9 : 4.5);
    this.pipeline.render();
  };

  private updateExploration(delta: number): void {
    if (this.input.consumeInteract()) this.callbacks.onInteract();

    const intent = this.movementEnabled
      ? this.input.readIntent()
      : { forward: 0, turn: 0, run: false };

    this.walk.update(delta, intent);

    const nearby = this.walk.findNearbyHotspot();
    if (nearby !== this.nearbyHotspot) {
      this.nearbyHotspot = nearby;
      this.callbacks.onNearbyHotspotChange(nearby);
    }

    this.rig.followCharacter(
      this.walk.positionX,
      this.walk.positionZ,
      this.walk.facing,
      delta,
      FOV_EXPLORE,
    );

    // Anything still between the camera and the character goes translucent.
    this.occluders.update(this.rig.camera, this.walk.positionX, this.walk.positionZ, GROUND_Y);
  }

  // ── External control ───────────────────────────────────────────────────────

  /** Suspends movement (but not rendering) while a panel is open. */
  setMovementEnabled(enabled: boolean): void {
    this.movementEnabled = enabled;
    this.input?.setEnabled(enabled);
  }

  setDiscovered(discovered: ReadonlySet<PanelId>): void {
    this.discovered = discovered;
  }

  setTouchAxes(forward: number, turn: number): void {
    this.input?.setTouchAxes(forward, turn);
  }

  requestInteract(): void {
    this.input?.queueInteract();
  }

  /** Walks the visitor's view to a hotspot without them having to find it. */
  teleportToHotspot(x: number, z: number): void {
    if (this.phase !== 'explore') return;
    this.walk.reset(x, z, YAW_INLAND);
    this.rig.followCharacter(x, z, YAW_INLAND, 1 / 60, FOV_EXPLORE);
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.rig.resize(width / height);
    this.pipeline.resize(width, height);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;

    gsap.killTweensOf(this.scene);
    this.occluders.reset();
    this.arrival?.dispose();
    this.input?.dispose();
    this.beacons?.dispose();
    this.clouds?.dispose();
    this.impact?.dispose();
    this.character?.dispose();
    this.environment?.dispose();

    // Everything remaining was built here (sky dome, lights) — walk and release.
    for (const child of [...this.scene.children]) disposeObject(child);
    this.scene.clear();

    this.pipeline?.dispose();
  }
}
