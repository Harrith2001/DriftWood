import * as THREE from 'three';
import type { Hotspot, Region } from '../models/experience.model';

/**
 * Every hard-coded world coordinate lives here.
 *
 * The values were measured against the beach diorama from a bird's-eye render,
 * so they are tied to that model's scale and origin. If the environment model
 * is ever swapped, this file is the only place that needs re-measuring.
 */

/** Ground plane height. Pier deck sits at ~2.79, sand at ~2.88. */
export const GROUND_Y = 2.8;

/** Feet height where the arrival begins. */
export const SKY_Y = 36;

/**
 * Landing column — the open (seaward) end of the pier. Deliberately out over
 * the water so the touchdown shot frames the island instead of a palm trunk.
 */
export const LANDING = { x: 5.0, z: 0.7 } as const;

/** Facing (yaw) the character holds during the intro portrait: toward +X, i.e. the viewer. */
export const YAW_PORTRAIT = Math.PI / 2;
/** Facing after touchdown: toward -X, i.e. inland, ready to walk. */
export const YAW_INLAND = -Math.PI / 2;

// ── Camera keyframes ─────────────────────────────────────────────────────────

/**
 * Intro: a portrait framed head-to-thigh, not a face close-up.
 *
 * At FOV 40 the visible height is `2·d·tan(20°) ≈ 0.73·d`, so a 3.6-unit standoff
 * frames roughly 2.6 m — a 1.8 m character filling ~70% of the height with
 * headroom above and space for the title block. Aimed at mid-torso with the
 * camera slightly above it, which reads as eye contact rather than a low angle.
 */
export const CAM_INTRO_POS = new THREE.Vector3(LANDING.x + 3.6, SKY_Y + 1.35, LANDING.z + 0.55);
export const CAM_INTRO_TARGET = new THREE.Vector3(LANDING.x, SKY_Y + 1.05, LANDING.z);
export const FOV_INTRO = 40;

/** Exploration: third-person over-the-shoulder. */
export const FOV_EXPLORE = 58;

// ── Walkable ground ──────────────────────────────────────────────────────────

/**
 * Walkable areas. A position is valid when it falls inside at least one of
 * these and outside every blocker below.
 */
export const WALKABLE: readonly Region[] = [
  // Pier decking, running seaward from the beach.
  { minX: 0.3, maxX: 7.65, minZ: -1.09, maxZ: 2.5 },
  // The sand belt across the front of the island.
  { minX: -11.0, maxX: 0.3, minZ: -10.0, maxZ: 10.0 },
];

/** Solid geometry the character must not walk through. */
export const BLOCKERS: readonly Region[] = [
  // Main beach house footprint.
  { minX: -8.71, maxX: -3.71, minZ: -6.14, maxZ: 0.36 },
  // Changing cabin.
  { minX: -7.28, maxX: -4.37, minZ: 3.34, maxZ: 5.21 },
];

/** Keeps the character a body-width clear of blocker walls and water edges. */
export const BODY_RADIUS = 0.45;

// ── Movement ─────────────────────────────────────────────────────────────────

export const WALK_SPEED = 4.2; // world units / second
export const RUN_MULTIPLIER = 1.9;
export const TURN_SPEED = 2.9; // radians / second

// ── Third-person camera rig ──────────────────────────────────────────────────

export const CAM_FOLLOW_DISTANCE = 6.0;
/**
 * Height above the ground plane, not above the character.
 *
 * Kept deliberately low: at 4.3 the rig sat around y=7, which is exactly the
 * height of the palm crowns, so walking inland parked the camera inside a
 * canopy. Sitting below the fronds also gives the flatter, over-the-shoulder
 * framing that reads as a game camera rather than a drone.
 */
export const CAM_FOLLOW_HEIGHT = 2.7;
/** How far in front of the character the rig aims. */
export const CAM_LOOK_AHEAD = 2.0;
export const CAM_LOOK_HEIGHT = 1.55;
/** Closest the rig may pull in when geometry blocks the ideal position. */
export const CAM_MIN_DISTANCE = 2.6;

// ── Hotspots ─────────────────────────────────────────────────────────────────

/**
 * Discoverable locations. Each sits on walkable ground beside the landmark it
 * describes, clear of the blocker rectangles above.
 */
export const HOTSPOTS: readonly Hotspot[] = [
  {
    id: 'projects',
    label: 'Projects',
    x: 2.4,
    z: 0.7, // pier decking, between the landing point and the beach
    radius: 1.9,
    color: 0x5ecfff,
  },
  {
    id: 'about',
    label: 'About',
    x: -2.6,
    z: -2.4, // sand east of the beach house
    radius: 1.9,
    color: 0xffb703,
  },
  {
    id: 'skills',
    label: 'Skills',
    x: -3.2,
    z: 4.4, // sand east of the changing cabin
    radius: 1.9,
    color: 0xa78bfa,
  },
  {
    id: 'contact',
    label: 'Contact',
    x: -1.6,
    z: -7.2, // quiet south end of the beach
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
  island: 'assets/models/island.glb',
  character: 'assets/models/character.glb',
  animations: {
    idle: 'assets/models/anim-idle.glb',
    walk: 'assets/models/anim-walk.glb',
    fall: 'assets/models/anim-fall.glb',
  },
} as const;
