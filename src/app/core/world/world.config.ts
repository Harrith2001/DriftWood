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
 * Outer fence for the playable area — the plaza plus the street that descends
 * away from it to the north.
 *
 * This is a boundary, not a map. On the beach these rectangles tried to describe
 * the walkable surface itself and cost a long run of bugs: one overhung the
 * shoreline, two abutting ones left a dead seam, and none of them knew about the
 * water. Here the geometry answers that question directly — the rectangle only
 * stops the visitor wandering the full 284 metres of hillside into parts of the
 * model that were never dressed for a close look.
 */
export const WALKABLE: readonly Region[] = [
  { minX: -19, maxX: 19, minZ: -34, maxZ: 15 },
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

export const WALK_SPEED = 4.2; // world units / second
export const RUN_MULTIPLIER = 1.9;
export const TURN_SPEED = 2.9; // radians / second

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
/** Closest the rig may pull in when geometry blocks the ideal position. */
export const CAM_MIN_DISTANCE = 2.6;

// ── Hotspots ─────────────────────────────────────────────────────────────────

/**
 * Discoverable locations, all verified by the probe to sit on reachable,
 * near-level ground. Colours read as street lighting rather than as UI: the
 * model's own emissive materials are sodium orange and white, so these sit in
 * the same family.
 */
export const HOTSPOTS: readonly Hotspot[] = [
  {
    id: 'projects',
    label: 'Projects',
    x: -10,
    z: 2, // west side of the plaza
    y: 0.0,
    radius: 1.9,
    color: 0x5ecfff,
  },
  {
    id: 'about',
    label: 'About',
    x: 10,
    z: -1, // east side, below the tenement block
    y: 0.84,
    radius: 1.9,
    color: 0xffa53d,
  },
  {
    id: 'skills',
    label: 'Skills',
    x: -8,
    z: 8, // outside the shopfronts on the north side
    y: 0.2,
    radius: 1.9,
    color: 0xc08bff,
  },
  {
    id: 'contact',
    label: 'Contact',
    x: -2,
    z: -22, // down the street that descends to the north
    y: -1.16,
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
