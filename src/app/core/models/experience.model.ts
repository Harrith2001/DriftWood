/** Domain types for the 3D experience. */

/**
 * Top-level phase of the experience. Drives which UI overlay is visible and
 * which controller owns the camera.
 *
 *   loading  assets in flight, loader overlay shown
 *   intro    close-up portrait, waiting for the visitor's first input
 *   arrival  autoplayed freefall → impact → recovery (no input accepted)
 *   explore  visitor drives the character around the island
 */
export type Phase = 'loading' | 'intro' | 'arrival' | 'explore';

/** Character animation states. Exactly one is at full weight at any time. */
export type AnimState = 'idle' | 'walking' | 'falling';

/** A discoverable location on the island that reveals a content panel. */
export interface Hotspot {
  readonly id: PanelId;
  /** Short label rendered on the world beacon and the HUD objective list. */
  readonly label: string;
  /** World position on walkable ground. */
  readonly x: number;
  readonly z: number;
  /** Proximity radius, in world units, that arms the "open" prompt. */
  readonly radius: number;
  /** Beacon accent, also used by the panel border. */
  readonly color: number;
}

export type PanelId = 'about' | 'projects' | 'skills' | 'contact';

/** Rectangular region in world XZ. Used for both walkable areas and blockers. */
export interface Region {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Quality tier chosen from device capability; scales cost at startup. */
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  readonly tier: QualityTier;
  readonly pixelRatio: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly cloudCount: number;
  readonly postProcessing: boolean;
}
