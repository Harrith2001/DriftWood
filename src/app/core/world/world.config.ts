import * as THREE from 'three';
import type { Hotspot, Region } from '../models/experience.model';

/**
 * Every hard-coded world coordinate lives here.
 *
 * The values are measured against the city model by `tools/dev/probe-city.mjs`,
 * which rasterises the real triangles onto a grid and flood-fills the result, so
 * these numbers describe ground the character can genuinely reach rather than a
 * rectangle drawn over a screenshot. Re-run that script after swapping the model
 * and copy its output back here.
 */

/**
 * Where the model is seated, chosen so the plaza centre is the world origin with
 * its road surface at y=0.
 *
 * Deliberately explicit rather than "recentre on the bounding box". The scene is
 * a hillside that drops 63 metres from rooftop to the bottom of the valley, so
 * centring it on its own bounds would have parked the playable street some 30
 * units up and 60 out, and every coordinate below would have had to carry that
 * accident around.
 */
export const MODEL_OFFSET = new THREE.Vector3(29, 2.2, -6);

/** Road surface across the plaza. The ground probe supersedes this everywhere it can. */
export const GROUND_Y = 0;

/** Feet height where the arrival begins — well clear of the tallest roofline (~36). */
export const SKY_Y = 58;

/**
 * Landing column — the middle of the plaza, the one place with 30 metres of
 * clear ground in every direction and no overhang to fall through.
 */
export const LANDING = { x: 0, z: 2 } as const;

/** Facing during the intro portrait: toward -Z, i.e. the camera. */
export const YAW_PORTRAIT = Math.PI;
/**
 * Facing after touchdown: toward +Z, up the hill.
 *
 * The same side as the intro camera, so handing control over is a settle rather
 * than a whip-pan, and it puts the stacked hillside houses dead ahead — the
 * single most characteristic view in the model.
 */
export const YAW_STREET = 0;

// ── Camera keyframes ─────────────────────────────────────────────────────────

/**
 * Intro: a portrait framed head-to-thigh, not a face close-up.
 *
 * At FOV 40 the visible height is `2·d·tan(20°) ≈ 0.73·d`, so a 3.6-unit standoff
 * frames roughly 2.6 m — a 1.8 m character filling ~70% of the height with
 * headroom above and space for the title block. Aimed at mid-torso with the
 * camera slightly above it, which reads as eye contact rather than a low angle.
 */
export const CAM_INTRO_POS = new THREE.Vector3(LANDING.x + 0.55, SKY_Y + 1.35, LANDING.z - 3.6);
export const CAM_INTRO_TARGET = new THREE.Vector3(LANDING.x, SKY_Y + 1.05, LANDING.z);
export const FOV_INTRO = 40;

/** Exploration: third-person over-the-shoulder. */
export const FOV_EXPLORE = 58;

// ── Walkable ground ──────────────────────────────────────────────────────────

/**
 * Outer fence for the playable area: the whole neighbourhood.
 *
 * Derived, not authored — this is the bounding box of everything the walkability
 * probe could actually reach on foot from the landing point, which is 10,500 m²
 * of plaza, side streets, stair flights and hillside spanning 52 metres of
 * climb. Re-run `tools/dev/probe-city.mjs` after changing the model and paste
 * its reported bounds back here.
 *
 * This is a boundary, not a map. On the beach these rectangles tried to describe
 * the walkable surface itself and cost a long run of bugs: one overhung the
 * shoreline, two abutting ones left a dead seam, and none of them knew about the
 * water. Here the geometry answers that question directly, and the rectangle
 * only catches anything the probe's own bounds did not.
 */
export const WALKABLE: readonly Region[] = [
  { minX: -74, maxX: 75, minZ: -162, maxZ: 74 },
];

/**
 * Places inside those bounds that have a road surface but cannot be stood on.
 *
 * Generated, not measured — see `city-blockers.ts` for why they have to be baked
 * rather than probed each frame.
 */
export { BLOCKERS } from './city-blockers';

/** Keeps the character a body-width clear of kerbs and walls. */
export const BODY_RADIUS = 0.45;

// ── Movement ─────────────────────────────────────────────────────────────────

/**
 * Walking pace, in metres per second.
 *
 * A real walk is about 1.4 and a jog about 3. This sat at 4.2 — a sprint, played
 * through a walk cycle, which is why the feet skated: no playback rate makes a
 * walk animation cover four metres a second honestly. Slower reads as walking,
 * and the run multiplier is there for covering ground.
 */
export const WALK_SPEED = 2.9;
export const RUN_MULTIPLIER = 2.0;
/**
 * Ground speed the walk clip is authored for. Playback is scaled by the ratio of
 * actual speed to this, which is what stops the feet sliding.
 */
export const STRIDE_SPEED = 2.9;
/** How hard the character accelerates and brakes, in m/s². */
export const ACCELERATION = 14;
export const TURN_SPEED = 2.9; // radians / second

// ── Jumping ──────────────────────────────────────────────────────────────────

/**
 * Take-off speed and gravity, tuned together for a half-metre hop of about half
 * a second — roughly what a person clears standing, and short enough that it
 * reads as a step over something rather than a flight.
 *
 * Gravity is well above 9.81. Real gravity over a jump this small feels floaty
 * on screen, because the camera is close and there is no body weight to sell the
 * hang time.
 */
export const JUMP_SPEED = 4.0;
export const GRAVITY = 16;
/** Highest step the character walks over without needing to jump. */
export const STEP_HEIGHT = 0.45;
/** Chest height, where the body is widest and collision matters most. */
export const CHEST_HEIGHT = 1.25;

// ── Third-person camera rig ──────────────────────────────────────────────────

export const CAM_FOLLOW_DISTANCE = 6.0;
/**
 * Height above the ground plane, not above the character. Low enough to stay
 * under the first-floor balconies that overhang most of the street.
 */
export const CAM_FOLLOW_HEIGHT = 2.7;
/** How far in front of the character the rig aims. */
export const CAM_LOOK_AHEAD = 2.0;
export const CAM_LOOK_HEIGHT = 1.55;
/**
 * Closest the rig may pull in when geometry blocks the ideal position.
 *
 * This is a floor on the pull-in, so it is also the distance at which the camera
 * stops respecting walls: anything nearer than this and the rig sits inside the
 * geometry regardless. At 2.6 that happened constantly once the alleys and stair
 * flights opened up — they are narrower than the camera's own standoff, so
 * walking one put the lens through a wall and filled a third of the frame with
 * the inside of it. Close enough now to stay in the street; the near plane is
 * 0.4, so there is still room in front of it.
 */
export const CAM_MIN_DISTANCE = 1.5;

// ── Hotspots ─────────────────────────────────────────────────────────────────

/**
 * Discoverable locations, all verified by the probe to sit on reachable ground.
 *
 * Spread across the whole neighbourhood rather than clustered in the plaza: the
 * walkable area is 10,500 m² and 52 metres of climb, so four beacons within one
 * street of each other would have left every other direction empty. They now sit
 * twenty metres apart vertically and up to ninety apart on the ground, which
 * makes reaching each one an actual walk — down the stairs, up the hill, along
 * the main road east.
 *
 * Colours read as street lighting rather than as UI: the model's own emissive
 * materials are sodium orange and white, so these sit in the same family.
 */
export const HOTSPOTS: readonly Hotspot[] = [
  {
    id: 'projects',
    label: 'Projects',
    x: -10,
    z: 2, // the plaza, a few strides from where you land
    y: 0.22,
    radius: 1.9,
    color: 0x5ecfff,
  },
  {
    id: 'about',
    label: 'About',
    x: 48,
    z: -28, // east along the main road, under the tenement blocks
    y: 2.07,
    radius: 1.9,
    color: 0xffa53d,
  },
  {
    id: 'skills',
    label: 'Skills',
    x: -26,
    z: 30, // up the hill, thirteen metres above the plaza
    y: 13.54,
    radius: 1.9,
    color: 0xc08bff,
  },
  {
    id: 'contact',
    label: 'Contact',
    x: -11,
    z: -42, // down the stair street, seven metres below the plaza
    y: -6.88,
    radius: 1.9,
    color: 0xff6b6b,
  },
];

// ── Asset paths ──────────────────────────────────────────────────────────────

/**
 * Runtime assets, produced by `npm run assets:build` from `assets-src/`.
 * The animation files carry a skeleton and keyframes only — no mesh, no
 * textures — and are retargeted onto the shared character at load time.
 */
export const ASSETS = {
  city: 'assets/models/city.glb',
  character: 'assets/models/character.glb',
  animations: {
    idle: 'assets/models/anim-idle.glb',
    walk: 'assets/models/anim-walk.glb',
    fall: 'assets/models/anim-fall.glb',
  },
} as const;
