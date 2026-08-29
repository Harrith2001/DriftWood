import type { Region } from '../models/experience.model';

/**
 * GENERATED FILE — do not edit by hand.
 * Produced by `node tools/dev/probe-city.mjs`; re-run it after changing the model.
 *
 * Places inside the play bounds that have a road surface underneath but cannot
 * be stood on: 34 rectangles covering 290 square metres of
 * buildings raised off the roadway, parked cars, market stalls and banks too
 * steep to climb.
 *
 * These are baked rather than probed at runtime because a raycast cannot see
 * them. Most of these buildings are modelled from below the road up through it,
 * so the space the body would occupy lies strictly inside the solid, with no
 * face along it to hit — casting finds surfaces, and here there are none to
 * find. Offline the question is answered by rasterising triangles, which knows
 * the full vertical span covering each cell and has no such blind spot.
 *
 * Note what these are *not*: the beach's hand-measured rectangles, drawn over a
 * screenshot and wrong at every edge. Every number below was read off the mesh.
 */
export const BLOCKERS: readonly Region[] = [
  { minX: -2, maxX: 13, minZ: 9, maxZ: 15 },
  { minX: -19, maxX: -12, minZ: -5, maxZ: 1 },
  { minX: -19, maxX: -16, minZ: 7, maxZ: 15 },
  { minX: 1, maxX: 2, minZ: -34, maxZ: -18 },
  { minX: -19, maxX: -17, minZ: -13, maxZ: -5 },
  { minX: -12, maxX: -11, minZ: -27, maxZ: -15 },
  { minX: 2, maxX: 6, minZ: 5, maxZ: 7 },
  { minX: 2, maxX: 9, minZ: -19, maxZ: -18 },
  { minX: -3, maxX: -1, minZ: -27, maxZ: -24 },
  { minX: -19, maxX: -17, minZ: 1, maxZ: 4 },
  { minX: -6, maxX: -4, minZ: 12, maxZ: 15 },
  { minX: -10, maxX: -9, minZ: -26, maxZ: -21 },
  { minX: -12, maxX: -11, minZ: -10, maxZ: -5 },
  { minX: -7, maxX: -2, minZ: 9, maxZ: 10 },
  { minX: 15, maxX: 16, minZ: -7, maxZ: -3 },
  { minX: -17, maxX: -15, minZ: 3, maxZ: 5 },
  { minX: -19, maxX: -17, minZ: 5, maxZ: 7 },
  { minX: -16, maxX: -15, minZ: 8, maxZ: 12 },
  { minX: 7, maxX: 11, minZ: 8, maxZ: 9 },
  { minX: 2, maxX: 4, minZ: -31, maxZ: -30 },
  { minX: -3, maxX: -2, minZ: -29, maxZ: -27 },
  { minX: -17, maxX: -16, minZ: -7, maxZ: -5 },
  { minX: 9, maxX: 11, minZ: -4, maxZ: -3 },
  { minX: 14, maxX: 16, minZ: 10, maxZ: 11 },
  { minX: -7, maxX: -6, minZ: 13, maxZ: 15 },
  { minX: -4, maxX: -2, minZ: 14, maxZ: 15 },
  { minX: 4, maxX: 5, minZ: -32, maxZ: -31 },
  { minX: 2, maxX: 3, minZ: -30, maxZ: -29 },
  { minX: 15, maxX: 16, minZ: -15, maxZ: -14 },
  { minX: -19, maxX: -18, minZ: -14, maxZ: -13 },
  { minX: -16, maxX: -15, minZ: -13, maxZ: -12 },
  { minX: 6, maxX: 7, minZ: -4, maxZ: -3 },
  { minX: -17, maxX: -16, minZ: 2, maxZ: 3 },
  { minX: -19, maxX: -18, minZ: 4, maxZ: 5 },
];
