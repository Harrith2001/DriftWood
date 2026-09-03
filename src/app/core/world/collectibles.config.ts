/**
 * The scavenger hunt.
 *
 * Eight bottle caps — *chapas*, the thing children on these streets actually
 * collect — hidden across the neighbourhood. Walking into one picks it up; find
 * all eight and a hidden panel opens.
 *
 * The hunt exists because a place you can only walk around is a place you look
 * at once. Something to find turns the streets from scenery into a reason to go
 * down them, and the reward is the part of the portfolio that would otherwise
 * never get read.
 *
 * It is never a gate. Every content panel stays reachable from the HUD list,
 * whether or not a single cap is found.
 */

export interface Collectible {
  readonly id: string;
  /** Where it hangs, in world coordinates — y already includes the hover. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Shown when it is picked up. */
  readonly label: string;
  /**
   * True when it sits above standing reach and has to be jumped for. Kept
   * explicit so the two of them are obvious in review rather than implied by a
   * height that looks like any other.
   */
  readonly needsJump?: boolean;
}

/**
 * Positions chosen by `tools/dev/probe-city.mjs`, which picks them in bands of
 * distance from the landing point — two within thirty metres, two by fifty-five,
 * and so on out to a hundred and twenty.
 *
 * Banding rather than simply spreading them out, because maximising the spread
 * put every one of them at the far edge of the model, on the bare backdrop road
 * a hundred and sixty metres away. Bands pull the visitor outward through the
 * streets in stages, which is the point.
 *
 * The heights below are the probed ground plus a hover: `HOVER` for the six you
 * can walk into, `JUMP_HOVER` for the two that need the jump.
 */
const HOVER = 1.0;
const JUMP_HOVER = 2.25;

export const COLLECTIBLES: readonly Collectible[] = [
  { id: 'cap-1', x: -7, y: -2.29 + HOVER, z: -27, label: 'Down the first slope' },
  { id: 'cap-2', x: -6, y: 5.04 + HOVER, z: 29, label: 'Top of the plaza road' },
  { id: 'cap-3', x: 54, y: 1.15 + JUMP_HOVER, z: -7, label: 'Above the east junction', needsJump: true },
  { id: 'cap-4', x: 7, y: -6.9 + HOVER, z: -52, label: 'Halfway down the steps' },
  { id: 'cap-5', x: 66, y: -1.13 + HOVER, z: -40, label: 'The far end of the main road' },
  { id: 'cap-6', x: -6, y: -14.29 + JUMP_HOVER, z: -83, label: 'Over the stairway', needsJump: true },
  { id: 'cap-7', x: 4, y: -20.43 + HOVER, z: -117, label: 'The bottom of the hill' },
  { id: 'cap-8', x: -18, y: -19.37 + HOVER, z: -112, label: 'The last corner' },
];

/**
 * How close the character's chest must come to a cap to take it.
 *
 * Deliberately generous horizontally and tight vertically: brushing past one at
 * street level should collect it, but the two hanging out of reach must stay out
 * of reach until you jump. Standing, the chest reaches about 1.9 m; jumping adds
 * the 0.42 m arc, which is what clears a cap at 2.25.
 */
export const PICKUP_RADIUS = 1.15;
/** Height of the chest above the feet, where the pickup is measured from. */
export const PICKUP_CHEST = 0.95;
