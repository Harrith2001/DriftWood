/**
 * Walkability probe for the city environment.
 *
 *   node tools/dev/probe-city.mjs
 *
 * The beach diorama's walkable areas were hand-measured off a bird's-eye render,
 * which cost a long chain of bugs: rectangles that overhung the shoreline, a
 * dead zone where two abutting rectangles were both inset, and a character who
 * strolled out across the bay. This does the measuring properly instead.
 *
 * Every triangle is transformed to world space and rasterised onto an XZ grid.
 * Standable materials contribute a floor height per cell; everything else
 * contributes the vertical span of whatever is standing there. The grid is then
 * flood-filled from the landing point, keeping only steps a walker could
 * actually take, and everything the fill could not reach becomes a blocker.
 *
 * Outputs `src/app/core/world/city-blockers.ts` plus the numbers that go into
 * `world.config.ts` — derived from the mesh, not from a screenshot.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFile } from 'node:fs/promises';

const SRC = 'assets-src/models/popular_streets_of_lima/scene.gltf';
const OUT = 'src/app/core/world/city-blockers.ts';

/**
 * Materials the character may stand on.
 *
 * MUST match `WALKABLE_SURFACE` in `src/app/three/world/environment.ts`. The two
 * answer the same question in different places — this one decides where the
 * blockers go, that one decides where the runtime probe finds ground — so a
 * disagreement between them produces exactly the bug the blockers exist to
 * prevent, in exactly the places nobody checked.
 *
 * `darkconcrete` is deliberately absent: it is the interior flooring, and it
 * exists at first- and second-storey levels as well as at street level.
 */
const WALKABLE = new Set(['atlas_street', 'ground', 'concretopoor']);
/** Scenery that is never a floor and never an obstacle. */
const SEE_THROUGH = new Set(['glasss', 'atlas_plantsTRP', 'emitYELL', 'emiWHITE']);

/**
 * Half-metre cells.
 *
 * Resolution is not cosmetic here: the limit on how steep a climb can be is
 * expressed as a height change between neighbouring cells, so halving the cell
 * halves the rise the walker has to manage in one step. At one-metre cells the
 * stair flights — 2.4 m of rise across 2.0 m of ground — needed a step limit so
 * generous that it also let the character walk up dirt banks.
 */
const CELL = 0.5;
const X0 = -105, X1 = 48;
const Z0 = -205, Z1 = 85;

/**
 * Steepest climb a walker will take, as rise over run.
 *
 * Set from the stairs, which are the steepest thing that must stay traversable:
 * the flights either side of the plaza run at 1.2, and the visitor is meant to
 * be able to use them. Anything appreciably steeper than a staircase is not
 * somewhere a person walks, so the fill stops there.
 */
const MAX_GRADIENT = 1.4;
const MAX_STEP = MAX_GRADIENT * CELL;

/** Headroom the body needs to stand somewhere. */
const CLEARANCE = 2.2;
/** Ignore anything lying flat on the ground: kerbstones, gutters, debris. */
const STEP_OVER = 0.35;
/**
 * A cell with something solid this close overhead is indoors.
 *
 * Headroom alone does not settle this: shop interiors here have three-metre
 * ceilings, which clear the body comfortably, so a clearance test walks the
 * visitor straight through a shopfront and leaves him in a stockroom looking at
 * the inside of a wall. What separates a street from a room is whether the sky
 * is above it. Set above awning height and below the power lines that cross the
 * street, so a pavement under a canopy stays walkable and the road does not get
 * fenced off by its own cabling.
 */
const ROOF_LIMIT = 5.0;

/** Where the model is seated; see MODEL_OFFSET in world.config.ts. */
const PLACEMENT = { x: 29, y: 2.2, z: -6 };
/** Where the arrival puts the character down, in world coordinates. */
const LANDING = { x: 0, z: 2 };

const COLS = Math.round((X1 - X0) / CELL);
const ROWS = Math.round((Z1 - Z0) / CELL);

// ── glTF traversal ───────────────────────────────────────────────────────────

function trs(node) {
  const [tx, ty, tz] = node.getTranslation();
  const [qx, qy, qz, qw] = node.getRotation();
  const [sx, sy, sz] = node.getScale();
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function apply(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}
function worldMatrix(node) {
  const chain = [];
  let n = node;
  while (n && n.propertyType === 'Node') { chain.unshift(n); n = n.getParentNode?.() ?? null; }
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const c of chain) m = mul(m, trs(c));
  return m;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);

/** Yields every world-space triangle with the name of its material. */
function* triangles() {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = worldMatrix(node);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const mat = prim.getMaterial()?.getName() ?? '(none)';
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const at = (i) => {
        const v = pos.getElement(idx ? idx.getScalar(i) : i, []);
        return apply(m, v[0], v[1], v[2]);
      };
      for (let i = 0; i + 2 < count; i += 3) yield { mat, a: at(i), b: at(i + 1), c: at(i + 2) };
    }
  }
}

// ── Rasterisation ────────────────────────────────────────────────────────────

const floor = new Float32Array(COLS * ROWS).fill(NaN);
const solidLow = new Float32Array(COLS * ROWS).fill(Infinity);
const solidHigh = new Float32Array(COLS * ROWS).fill(-Infinity);
const roofY = new Float32Array(COLS * ROWS).fill(Infinity);

const cx = (col) => X0 + (col + 0.5) * CELL;
const cz = (row) => Z0 + (row + 0.5) * CELL;

/**
 * Two passes, because the second needs the answer from the first.
 *
 * Pass 1 finds the floor. Pass 2 asks what is above it — and "above the floor"
 * cannot be evaluated until the floor is known. A single pass can only keep the
 * lowest solid overall, which for a cell whose building is modelled from below
 * the roadway is a point *under* the road, leaving the roof three metres
 * overhead unnoticed.
 */
for (const pass of [1, 2]) {
  for (const { mat, a, b, c } of triangles()) {
    const walkable = WALKABLE.has(mat);
    const solid = !walkable && !SEE_THROUGH.has(mat);
    if (pass === 1 ? !walkable : !solid) continue;

    const minX = Math.min(a[0], b[0], c[0]), maxX = Math.max(a[0], b[0], c[0]);
    const minZ = Math.min(a[2], b[2], c[2]), maxZ = Math.max(a[2], b[2], c[2]);
    if (maxX < X0 || minX > X1 || maxZ < Z0 || minZ > Z1) continue;

    const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-9) continue; // edge-on to the ground plane

    const c0 = Math.max(0, Math.floor((minX - X0) / CELL));
    const c1 = Math.min(COLS - 1, Math.ceil((maxX - X0) / CELL));
    const r0 = Math.max(0, Math.floor((minZ - Z0) / CELL));
    const r1 = Math.min(ROWS - 1, Math.ceil((maxZ - Z0) / CELL));

    for (let col = c0; col <= c1; col++) {
      for (let row = r0; row <= r1; row++) {
        const px = cx(col), pz = cz(row);
        const w0 = ((px - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (pz - a[2])) / d;
        const w1 = ((b[0] - a[0]) * (pz - a[2]) - (px - a[0]) * (b[2] - a[2])) / d;
        if (w0 < -1e-6 || w1 < -1e-6 || w0 + w1 > 1 + 1e-6) continue;
        const y = a[1] + w0 * (b[1] - a[1]) + w1 * (c[1] - a[1]);
        const k = row * COLS + col;

        if (walkable) {
          if (Number.isNaN(floor[k]) || y > floor[k]) floor[k] = y;
        } else {
          if (y < solidLow[k]) solidLow[k] = y;
          if (y > solidHigh[k]) solidHigh[k] = y;
          if (!Number.isNaN(floor[k]) && y > floor[k] + STEP_OVER && y < roofY[k]) roofY[k] = y;
        }
      }
    }
  }
}

/**
 * A cell you could stand in, if you could get to it.
 *
 * Note what is *not* tested: the steepness of the triangles under the cell. It
 * is the wrong question for a staircase, whose risers are vertical and whose
 * treads are flat, so a per-triangle slope test rejects every stair in the model
 * while happily accepting a smooth 30° bank. Whether a walker can make progress
 * is a question about the height difference between one foothold and the next,
 * which is what the flood fill below actually measures.
 */
function standable(k) {
  if (Number.isNaN(floor[k])) return false;
  // Something occupying the space the body would fill.
  if (solidHigh[k] > floor[k] + STEP_OVER && solidLow[k] < floor[k] + CLEARANCE) return false;
  // A roof overhead: indoors.
  if (roofY[k] < floor[k] + ROOF_LIMIT) return false;
  return true;
}

// ── Reachability ─────────────────────────────────────────────────────────────

/**
 * Flood fill from the landing point.
 *
 * Seeded there rather than taking the largest region, because the question that
 * matters is not "what is the biggest patch of ground" but "what can the visitor
 * get to from where they are put down".
 */
const seedCol = Math.floor((LANDING.x - PLACEMENT.x - X0) / CELL);
const seedRow = Math.floor((LANDING.z - PLACEMENT.z - Z0) / CELL);
const seed = seedRow * COLS + seedCol;

if (!standable(seed)) {
  console.error(`\nThe landing point (${LANDING.x}, ${LANDING.z}) is not standable. Nothing to fill.`);
  process.exit(1);
}

const reached = new Uint8Array(COLS * ROWS);
{
  const stack = [seed];
  reached[seed] = 1;
  while (stack.length) {
    const k = stack.pop();
    const col = k % COLS, row = (k - col) / COLS;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const nk = nr * COLS + nc;
      if (reached[nk] || !standable(nk)) continue;
      if (Math.abs(floor[nk] - floor[k]) > MAX_STEP) continue;
      reached[nk] = 1;
      stack.push(nk);
    }
  }
}

let reachedCount = 0;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
let loY = Infinity, hiY = -Infinity;
for (let k = 0; k < reached.length; k++) {
  if (!reached[k]) continue;
  reachedCount++;
  const col = k % COLS, row = (k - col) / COLS;
  const wx = cx(col) + PLACEMENT.x, wz = cz(row) + PLACEMENT.z;
  minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
  minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
  loY = Math.min(loY, floor[k] + PLACEMENT.y); hiY = Math.max(hiY, floor[k] + PLACEMENT.y);
}

const area = reachedCount * CELL * CELL;
console.log(`\nReachable on foot from the landing point: ${area.toFixed(0)} m²`);
console.log(`  world X[${minX.toFixed(1)} .. ${maxX.toFixed(1)}]  Z[${minZ.toFixed(1)} .. ${maxZ.toFixed(1)}]`);
console.log(`  floor height ${loY.toFixed(2)} .. ${hiY.toFixed(2)}  (${(hiY - loY).toFixed(1)} m of climb)`);

// Play bounds, padded so the fence never clips ground the fill did reach.
const PAD = 1;
const bounds = {
  minX: Math.floor(minX) - PAD, maxX: Math.ceil(maxX) + PAD,
  minZ: Math.floor(minZ) - PAD, maxZ: Math.ceil(maxZ) + PAD,
};
console.log(`\nWALKABLE bounds for world.config.ts:`);
console.log(`  { minX: ${bounds.minX}, maxX: ${bounds.maxX}, minZ: ${bounds.minZ}, maxZ: ${bounds.maxZ} }`);

// ── Map ──────────────────────────────────────────────────────────────────────

/** Downsampled so the whole neighbourhood fits in a terminal. */
const STRIDE = Math.max(1, Math.round(2 / CELL) * 2);
console.log(`\n=== Reachable ground, ${(STRIDE * CELL).toFixed(0)}m per character ===`);
console.log('  #  reachable on foot     ~  ground, but cut off      .  nothing to stand on\n');
for (let row = 0; row < ROWS; row += STRIDE) {
  const wz = cz(row) + PLACEMENT.z;
  if (wz < bounds.minZ - 6 || wz > bounds.maxZ + 6) continue;
  let line = wz.toFixed(0).padStart(5) + ' ';
  for (let col = 0; col < COLS; col += STRIDE) {
    const wx = cx(col) + PLACEMENT.x;
    if (wx < bounds.minX - 6 || wx > bounds.maxX + 6) continue;
    const k = row * COLS + col;
    line += reached[k] ? '#' : Number.isNaN(floor[k]) ? '.' : '~';
  }
  console.log(line);
}

// ── Blockers ─────────────────────────────────────────────────────────────────

/**
 * Everything inside the fence that has ground but the walker could not reach.
 *
 * These have to be baked rather than probed at runtime. The obvious runtime
 * check — cast down through the space the body would occupy and see if anything
 * is there — cannot work, and not for want of tuning: most of these buildings
 * are modelled from below the roadway up through it, so the probe segment lies
 * strictly *inside* the solid, with no face anywhere along it to hit. Casting
 * only ever finds surfaces, so it finds nothing, whichever way the ray points
 * and whichever way the material faces.
 *
 * Rasterising triangles offline has no such blind spot, and the flood fill adds
 * what no per-cell test can see at all: whether there is a route.
 */
const blocked = new Set();
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const wx = cx(col) + PLACEMENT.x, wz = cz(row) + PLACEMENT.z;
    if (wx < bounds.minX || wx > bounds.maxX || wz < bounds.minZ || wz > bounds.maxZ) continue;
    const k = row * COLS + col;
    if (Number.isNaN(floor[k])) continue; // no ground — the runtime probe handles it
    if (!reached[k]) blocked.add(k);
  }
}

/** Greedily carve the blocked set into as few rectangles as possible. */
function toRectangles(cells) {
  const remaining = new Set(cells);
  const rects = [];

  while (remaining.size) {
    let best = null;
    for (const k of remaining) {
      const col0 = k % COLS, row0 = (k - col0) / COLS;
      let width = Infinity;
      for (let row = row0; row < ROWS; row++) {
        let w = 0;
        while (w < width && remaining.has(row * COLS + col0 + w)) w++;
        if (w === 0) break;
        width = w;
        const a = width * (row - row0 + 1);
        if (!best || a > best.area) best = { area: a, col0, row0, width, rows: row - row0 + 1 };
      }
    }
    for (let r = 0; r < best.rows; r++) {
      for (let c = 0; c < best.width; c++) remaining.delete((best.row0 + r) * COLS + best.col0 + c);
    }
    const round = (v) => Math.round(v * 4) / 4;
    rects.push({
      minX: round(cx(best.col0) - CELL / 2 + PLACEMENT.x),
      maxX: round(cx(best.col0 + best.width - 1) + CELL / 2 + PLACEMENT.x),
      minZ: round(cz(best.row0) - CELL / 2 + PLACEMENT.z),
      maxZ: round(cz(best.row0 + best.rows - 1) + CELL / 2 + PLACEMENT.z),
    });
  }
  return rects;
}

const rects = toRectangles(blocked);
const lines = rects
  .map((r) => `  { minX: ${r.minX}, maxX: ${r.maxX}, minZ: ${r.minZ}, maxZ: ${r.maxZ} },`)
  .join('\n');

const generated = `import type { Region } from '../models/experience.model';

/**
 * GENERATED FILE — do not edit by hand.
 * Produced by \`node tools/dev/probe-city.mjs\`; re-run it after changing the model.
 *
 * Ground inside the play bounds that the visitor cannot reach on foot from the
 * landing point: ${rects.length} rectangles covering ${(blocked.size * CELL * CELL).toFixed(0)} m² of
 * building interiors, rooftops, banks too steep to climb, and ledges with no
 * route up to them.
 *
 * These are baked rather than probed at runtime for two reasons. A raycast
 * cannot see most of them: the buildings are modelled from below the roadway up
 * through it, so the space the body would occupy lies strictly inside the solid,
 * with no face along it to hit — casting finds surfaces, and here there are none
 * to find. And reachability is not a per-cell property at all; it is a question
 * about routes, which only a flood fill over the whole neighbourhood can answer.
 *
 * Note what these are *not*: the beach's hand-measured rectangles, drawn over a
 * screenshot and wrong at every edge. Every number below was read off the mesh.
 */
export const BLOCKERS: readonly Region[] = [
${lines}
];
`;

await writeFile(OUT, generated, 'utf8');
console.log(`\nWrote ${OUT} — ${rects.length} rectangles, ${(blocked.size * CELL * CELL).toFixed(0)} m² blocked`);

// ── Validate the authored coordinates ────────────────────────────────────────

function probeWorld(wx, wz) {
  const col = Math.floor((wx - PLACEMENT.x - X0) / CELL);
  const row = Math.floor((wz - PLACEMENT.z - Z0) / CELL);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return { ok: false, why: 'off grid' };
  const k = row * COLS + col;
  if (Number.isNaN(floor[k])) return { ok: false, why: 'no ground' };
  if (!reached[k]) return { ok: false, why: 'cannot be reached on foot' };
  return { ok: true, y: floor[k] + PLACEMENT.y };
}

const CANDIDATES = {
  landing: [LANDING.x, LANDING.z],
  projects: [-10, 2],
  about: [10, -1],
  skills: [-8, 8],
  contact: [-2, -22],
};

/**
 * Nearest reachable spot to a point, for when an authored one lands badly.
 *
 * Searches whole-metre coordinates, so what it reports is exactly what was
 * tested — an earlier version searched continuously and rounded the answer for
 * display, which handed back a rounded point that did not itself validate.
 */
function nearestReachable(wx, wz, maxRadius = 14) {
  let best = null;
  for (let dx = -maxRadius; dx <= maxRadius; dx++) {
    for (let dz = -maxRadius; dz <= maxRadius; dz++) {
      const px = Math.round(wx) + dx, pz = Math.round(wz) + dz;
      const hit = probeWorld(px, pz);
      if (!hit.ok) continue;
      const d = Math.hypot(px - wx, pz - wz);
      if (!best || d < best.d) best = { x: px, z: pz, y: hit.y, d };
    }
  }
  return best;
}

/**
 * Optional: check a recorded walk against the map.
 *
 *   node tools/dev/probe-city.mjs path/to/positions.json
 *
 * Takes `[[x, z, y], …]` sampled from the running app and reports any point the
 * probe says is unreachable. This is how the blockers get verified against what
 * the game actually does, rather than against what this script believes — the
 * two disagreeing is precisely the failure mode that let the character walk into
 * a shop, and no amount of re-reading either side on its own would have caught
 * it.
 */
const trace = process.argv[2];
if (trace) {
  const { readFile } = await import('node:fs/promises');
  const points = JSON.parse(await readFile(trace, 'utf8'));
  const bad = [];
  let worstDrift = 0;

  for (const [px, pz, py] of points) {
    const hit = probeWorld(px, pz);
    if (!hit.ok) { bad.push([px, pz, py, hit.why]); continue; }
    if (typeof py === 'number') worstDrift = Math.max(worstDrift, Math.abs(hit.y - py));
  }

  console.log(`\n=== Recorded walk: ${points.length} samples ===`);
  console.log(`  unreachable positions : ${bad.length}`);
  console.log(`  worst height mismatch : ${worstDrift.toFixed(2)} m`);
  for (const [px, pz, py, why] of bad.slice(0, 20)) {
    console.log(`    (${px}, ${pz}) y=${py} — ${why}`);
  }
  if (bad.length > 20) console.log(`    …and ${bad.length - 20} more`);
  process.exit(bad.length ? 1 : 0);
}

console.log('\n=== Authored coordinates ===');
for (const [name, [wx, wz]] of Object.entries(CANDIDATES)) {
  const r = probeWorld(wx, wz);
  if (r.ok) {
    console.log(`  ${name.padEnd(9)} world(${String(wx).padStart(4)}, ${String(wz).padStart(4)})  y = ${r.y.toFixed(2)}`);
    continue;
  }
  const alt = nearestReachable(wx, wz);
  const suggestion = alt
    ? `             nearest reachable: (${alt.x}, ${alt.z}) y = ${alt.y.toFixed(2)}, ${alt.d.toFixed(1)} m away`
    : '             nothing reachable within 14 m';
  console.log(
    `  ${name.padEnd(9)} world(${String(wx).padStart(4)}, ${String(wz).padStart(4)})  REJECTED — ${r.why}\n${suggestion}`,
  );
}
