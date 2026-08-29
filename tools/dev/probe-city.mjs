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
 * Every triangle belonging to a standable material is transformed to world space
 * and rasterised onto an XZ grid, keeping the highest surface per cell. Solid
 * geometry is rasterised separately so cells with something standing in them can
 * be excluded. The result is an ASCII map plus the numbers that go into
 * `world.config.ts` — derived from the mesh, not from a screenshot.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFile } from 'node:fs/promises';

const SRC = 'assets-src/models/popular_streets_of_lima/scene.gltf';

/**
 * Materials the character may stand on.
 *
 * MUST match `WALKABLE_SURFACE` in `src/app/three/world/environment.ts`. The two
 * answer the same question in different places — this one decides where the
 * blockers go, that one decides where the runtime probe finds ground — so a
 * disagreement between them produces exactly the bug the blockers exist to
 * prevent, in exactly the places nobody checked.
 */
const WALKABLE = new Set(['atlas_street', 'ground', 'concretopoor']);
/** Materials that are scenery only — never a floor, always an obstacle. */
const SEE_THROUGH = new Set(['glasss', 'atlas_plantsTRP', 'emitYELL', 'emiWHITE']);

const CELL = 1.0;
const X0 = -60, X1 = 60;
const Z0 = -60, Z1 = 60;
/** A surface counts as standable only if it is near level. */
const MAX_SLOPE_RISE = 0.6; // metres of rise across one cell
/** Headroom a cell needs above its floor to be enterable. */
const CLEARANCE = 2.2;

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

/** Yields world-space triangles as [ax,ay,az, bx,by,bz, cx,cy,cz] with material name. */
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

const floor = new Float32Array(COLS * ROWS).fill(NaN);   // highest walkable surface
const slope = new Float32Array(COLS * ROWS).fill(0);     // steepest gradient seen
const ceiling = new Float32Array(COLS * ROWS).fill(Infinity); // lowest solid above floor
const solidLow = new Float32Array(COLS * ROWS).fill(Infinity);
const solidHigh = new Float32Array(COLS * ROWS).fill(-Infinity);
const floorMat = new Array(COLS * ROWS).fill(null);   // which material floors each cell
const roofY = new Float32Array(COLS * ROWS).fill(Infinity); // lowest solid anywhere above the floor

const cx = (col) => X0 + (col + 0.5) * CELL;
const cz = (row) => Z0 + (row + 0.5) * CELL;

/**
 * Two passes, because the second needs the answer from the first.
 *
 * Pass 1 finds the floor. Pass 2 asks what is above it — and "above the floor"
 * cannot be evaluated until the floor is known. A single pass can only keep the
 * lowest solid overall, which for a cell whose building is modelled from below
 * the roadway is a point *under* the road, and the roof three metres overhead
 * goes unnoticed.
 */
for (const pass of [1, 2]) {
for (const { mat, a, b, c } of triangles()) {
  const walkable = WALKABLE.has(mat);
  const solid = !walkable && !SEE_THROUGH.has(mat);
  if (!walkable && !solid) continue;
  if (pass === 1 ? !walkable : !solid) continue;

  const minX = Math.min(a[0], b[0], c[0]), maxX = Math.max(a[0], b[0], c[0]);
  const minZ = Math.min(a[2], b[2], c[2]), maxZ = Math.max(a[2], b[2], c[2]);
  if (maxX < X0 || minX > X1 || maxZ < Z0 || minZ > Z1) continue;

  // Surface normal, for the slope test.
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-9) continue;
  // Rise per unit travelled horizontally: |horizontal normal| / |vertical normal|.
  const rise = Math.hypot(nx, nz) / Math.max(Math.abs(ny), 1e-6);

  const c0 = Math.max(0, Math.floor((minX - X0) / CELL));
  const c1 = Math.min(COLS - 1, Math.ceil((maxX - X0) / CELL));
  const r0 = Math.max(0, Math.floor((minZ - Z0) / CELL));
  const r1 = Math.min(ROWS - 1, Math.ceil((maxZ - Z0) / CELL));

  const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
  if (Math.abs(d) < 1e-9) continue; // edge-on to the ground plane

  for (let col = c0; col <= c1; col++) {
    for (let row = r0; row <= r1; row++) {
      const px = cx(col), pz = cz(row);
      // Barycentric coordinates in the XZ plane.
      const w0 = ((px - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (pz - a[2])) / d;
      const w1 = ((b[0] - a[0]) * (pz - a[2]) - (px - a[0]) * (b[2] - a[2])) / d;
      if (w0 < -1e-6 || w1 < -1e-6 || w0 + w1 > 1 + 1e-6) continue;
      const y = a[1] + w0 * (b[1] - a[1]) + w1 * (c[1] - a[1]);
      const k = row * COLS + col;

      if (walkable) {
        if (Number.isNaN(floor[k]) || y > floor[k]) { floor[k] = y; slope[k] = rise; floorMat[k] = mat; }
      } else {
        if (y < solidLow[k]) solidLow[k] = y;
        if (y > solidHigh[k]) solidHigh[k] = y;
        // Lowest thing overhead, measured from the floor rather than from zero.
        if (!Number.isNaN(floor[k]) && y > floor[k] + 0.35 && y < roofY[k]) roofY[k] = y;
      }
    }
  }
}
}

// Anything solid sitting in the space the body would occupy blocks the cell.
for (let k = 0; k < floor.length; k++) {
  if (Number.isNaN(floor[k])) continue;
  if (solidHigh[k] > floor[k] + 0.35 && solidLow[k] < floor[k] + CLEARANCE) ceiling[k] = solidLow[k];
}

/**
 * A cell with a roof over it is indoors, and indoors is not the experience.
 *
 * Headroom alone does not settle this: shop interiors here have three-metre
 * ceilings, which clear the body comfortably, so a clearance test walks the
 * visitor straight through a shopfront and leaves him standing in a stockroom
 * looking at the inside of a wall. What separates a street from a room is
 * simply whether the sky is above it.
 *
 * The limit is set above awning height and below the power lines that cross the
 * street, so a pavement under a shop canopy stays walkable and the road does
 * not get fenced off by its own cabling.
 */
const ROOF_LIMIT = 5.0;
const enclosed = (k) => roofY[k] < floor[k] + ROOF_LIMIT;

const open = (k) =>
  !Number.isNaN(floor[k]) && slope[k] <= MAX_SLOPE_RISE && ceiling[k] === Infinity && !enclosed(k);

// ── Reachability ─────────────────────────────────────────────────────────────

/**
 * An open cell is not necessarily a cell the character can get to. The hillside
 * terrain, the building interiors and a few rooftops all rasterise as level
 * ground, but nothing connects them to the street. Flood filling from each
 * unvisited cell and keeping only steps a walker could actually take separates
 * "there is a floor here" from "you can walk here from there".
 */
const MAX_STEP = 0.45; // metres of height change between adjacent cells

const label = new Int32Array(COLS * ROWS).fill(-1);
const components = [];

for (let seed = 0; seed < label.length; seed++) {
  if (label[seed] !== -1 || !open(seed)) continue;

  const id = components.length;
  const cells = [];
  const stack = [seed];
  label[seed] = id;

  while (stack.length) {
    const k = stack.pop();
    cells.push(k);
    const col = k % COLS, row = (k - col) / COLS;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const nk = nr * COLS + nc;
      if (label[nk] !== -1 || !open(nk)) continue;
      if (Math.abs(floor[nk] - floor[k]) > MAX_STEP) continue;
      label[nk] = id;
      stack.push(nk);
    }
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (const k of cells) {
    const col = k % COLS, row = (k - col) / COLS;
    minX = Math.min(minX, cx(col)); maxX = Math.max(maxX, cx(col));
    minZ = Math.min(minZ, cz(row)); maxZ = Math.max(maxZ, cz(row));
    lo = Math.min(lo, floor[k]); hi = Math.max(hi, floor[k]); sum += floor[k];
  }
  components.push({ id, cells, minX, maxX, minZ, maxZ, lo, hi, mean: sum / cells.length });
}

components.sort((a, b) => b.cells.length - a.cells.length);

console.log('\n=== Connected walkable regions (largest first) ===');
console.log('  area   X range        Z range        floor y');
for (const c of components.slice(0, 8)) {
  console.log(
    `  ${String(c.cells.length).padStart(5)}m²` +
    `  [${c.minX.toFixed(0).padStart(4)}..${c.maxX.toFixed(0).padStart(4)}]` +
    `  [${c.minZ.toFixed(0).padStart(4)}..${c.maxZ.toFixed(0).padStart(4)}]` +
    `  ${c.lo.toFixed(2).padStart(7)} .. ${c.hi.toFixed(2).padStart(6)}  mean ${c.mean.toFixed(2)}`,
  );
}

const main = components[0];
console.log(`\n=== Largest region: ${main.cells.length} m², floor ${main.lo.toFixed(2)}..${main.hi.toFixed(2)} ===`);
console.log('  #  reachable on foot     ~  floor, but not connected      .  no floor\n');

let ruler = '     ';
for (let col = 0; col < COLS; col++) ruler += (X0 + col) % 10 === 0 ? '|' : ' ';
console.log(ruler);

for (let row = 0; row < ROWS; row++) {
  if (cz(row) < main.minZ - 2 || cz(row) > main.maxZ + 2) continue;
  let line = String(Z0 + row).padStart(4) + ' ';
  for (let col = 0; col < COLS; col++) {
    const k = row * COLS + col;
    line += label[k] === main.id ? '#' : Number.isNaN(floor[k]) ? '.' : '~';
  }
  console.log(line);
}

// Largest axis-aligned rectangle wholly inside the main region — the safe box
// to author coordinates against.
const heights = new Int32Array(COLS);
let best = { area: 0 };
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    heights[col] = label[row * COLS + col] === main.id ? heights[col] + 1 : 0;
  }
  const stack = [];
  for (let col = 0; col <= COLS; col++) {
    const h = col === COLS ? 0 : heights[col];
    let start = col;
    while (stack.length && stack[stack.length - 1].h >= h) {
      const top = stack.pop();
      const area = top.h * (col - top.col);
      if (area > best.area) {
        best = {
          area,
          minX: X0 + top.col * CELL, maxX: X0 + col * CELL,
          minZ: Z0 + (row + 1 - top.h) * CELL, maxZ: Z0 + (row + 1) * CELL,
        };
      }
      start = top.col;
    }
    stack.push({ col: start, h });
  }
}
console.log(`\nLargest rectangle inside it: X[${best.minX}..${best.maxX}] Z[${best.minZ}..${best.maxZ}]  ${best.area} m²`);

// ── Flattest usable block ────────────────────────────────────────────────────

/**
 * Area alone is the wrong thing to optimise. The largest rectangle spans a
 * hillside and drops seven metres across it, which would put the landing shot
 * and the hotspots at wildly different heights. Search instead for the biggest
 * rectangle whose floor stays within a tolerable band.
 */
const FLAT_BAND = 2.0; // metres between the lowest and highest floor in the block
const MIN_SIDE = 10;   // metres — anything narrower is a corridor, not a place

function flattestRect() {
  const inMain = (col, row) => label[row * COLS + col] === main.id;
  let out = { area: 0 };
  for (let r0 = 0; r0 < ROWS; r0++) {
    for (let c0 = 0; c0 < COLS; c0++) {
      if (!inMain(c0, r0)) continue;
      let cMax = COLS - 1;
      for (let r1 = r0; r1 < ROWS; r1++) {
        let lo = Infinity, hi = -Infinity;
        // Extend right as far as the row allows, shrinking the shared width.
        let c1 = c0 - 1;
        while (c1 + 1 <= cMax && inMain(c1 + 1, r1)) c1++;
        cMax = c1;
        if (c1 < c0) break;
        for (let rr = r0; rr <= r1; rr++) {
          for (let cc = c0; cc <= cMax; cc++) {
            const y = floor[rr * COLS + cc];
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
        }
        if (hi - lo > FLAT_BAND) break;
        const w = cMax - c0 + 1, d = r1 - r0 + 1;
        if (w < MIN_SIDE || d < MIN_SIDE) continue;
        if (w * d > out.area) {
          out = {
            area: w * d, lo, hi,
            minX: X0 + c0 * CELL, maxX: X0 + (cMax + 1) * CELL,
            minZ: Z0 + r0 * CELL, maxZ: Z0 + (r1 + 1) * CELL,
          };
        }
      }
    }
  }
  return out;
}

const flat = flattestRect();
console.log(`\nFlattest block ≥${MIN_SIDE}m a side, within ${FLAT_BAND}m of level:`);
console.log(`  X[${flat.minX}..${flat.maxX}] Z[${flat.minZ}..${flat.maxZ}]  ${flat.area} m²  floor ${flat.lo?.toFixed(2)}..${flat.hi?.toFixed(2)}`);

// ── Height map over the candidate area ───────────────────────────────────────

const HX0 = Math.max(X0, Math.round(flat.minX) - 16), HX1 = Math.min(X1, Math.round(flat.maxX) + 16);
const HZ0 = Math.max(Z0, Math.round(flat.minZ) - 16), HZ1 = Math.min(Z1, Math.round(flat.maxZ) + 16);

console.log(`\n=== Floor heights, X[${HX0}..${HX1}] Z[${HZ0}..${HZ1}] (2m cells, main region only) ===`);
let head = '      ';
for (let x = HX0; x < HX1; x += 2) head += String(x).padStart(4);
console.log(head);
for (let z = HZ0; z < HZ1; z += 2) {
  let line = String(z).padStart(5) + ' ';
  for (let x = HX0; x < HX1; x += 2) {
    const col = Math.floor((x - X0) / CELL), row = Math.floor((z - Z0) / CELL);
    const k = row * COLS + col;
    line += label[k] === main.id ? floor[k].toFixed(1).padStart(4) : '   .';
  }
  console.log(line);
}

// ── Validate the authored world placement ────────────────────────────────────

/**
 * The runtime seats the model with this offset, chosen so the plaza centre is
 * the world origin with its road surface at y=0. Every coordinate in
 * `world.config.ts` is expressed in that frame, so validate them here rather
 * than discovering in the browser that a hotspot sits inside a wall.
 */
const PLACEMENT = { x: 29, y: 2.2, z: -6 };
const toModel = (wx, wz) => [wx - PLACEMENT.x, wz - PLACEMENT.z];

/** Reports the world-space floor height at a world-space point. */
function probeWorld(wx, wz) {
  const [mx, mz] = toModel(wx, wz);
  const col = Math.floor((mx - X0) / CELL), row = Math.floor((mz - Z0) / CELL);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return { ok: false, why: 'off grid' };
  const k = row * COLS + col;
  if (Number.isNaN(floor[k])) return { ok: false, why: 'no floor' };
  if (label[k] !== main.id) return { ok: false, why: 'not reachable from the plaza' };
  return { ok: true, y: floor[k] + PLACEMENT.y, slope: slope[k] };
}

const CANDIDATES = {
  landing: [0, 2],
  projects: [-10, 2],
  about: [10, -1],
  skills: [-8, 8],
  contact: [-2, -22],
};

console.log(`\n=== World placement check (offset ${PLACEMENT.x}, ${PLACEMENT.y}, ${PLACEMENT.z}) ===`);
for (const [name, [wx, wz]] of Object.entries(CANDIDATES)) {
  const r = probeWorld(wx, wz);
  console.log(
    `  ${name.padEnd(9)} world(${String(wx).padStart(4)}, ${String(wz).padStart(4)})  ` +
    (r.ok ? `y=${r.y.toFixed(2).padStart(6)}  slope ${r.slope.toFixed(2)}` : `REJECTED — ${r.why}`),
  );
}

/**
 * How often does a road surface actually run underneath something solid?
 *
 * This decides whether the runtime needs an obstacle test at all. If buildings
 * simply sit where the road mesh stops, the walkable-material allow-list already
 * answers the question and a second cast would be a mechanism with a failure
 * mode and no job.
 */
const PLAY = { minX: -19, maxX: 19, minZ: -34, maxZ: 15 };
let floored = 0, obstructed = 0, steep = 0;
const samples = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const wx = cx(col) + PLACEMENT.x, wz = cz(row) + PLACEMENT.z;
    if (wx < PLAY.minX || wx > PLAY.maxX || wz < PLAY.minZ || wz > PLAY.maxZ) continue;
    const k = row * COLS + col;
    if (Number.isNaN(floor[k])) continue;
    floored++;
    if (slope[k] > MAX_SLOPE_RISE) steep++;
    else if (ceiling[k] !== Infinity) {
      obstructed++;
      if (samples.length < 6) {
        samples.push(`(${wx.toFixed(0)}, ${wz.toFixed(0)}) floor ${(floor[k] + PLACEMENT.y).toFixed(1)}, solid from ${(solidLow[k] + PLACEMENT.y).toFixed(1)} to ${(solidHigh[k] + PLACEMENT.y).toFixed(1)}`);
      }
    }
  }
}
console.log('\n=== Inside the play bounds ===');
console.log(`  cells with a road surface     ${floored}`);
console.log(`  of those, too steep to stand  ${steep}`);
console.log(`  of those, something solid on  ${obstructed}`);
if (samples.length) console.log('  e.g. ' + samples.join('\n       '));

console.log('\n  map — # standable   X obstructed   R roofed   / too steep   . no road');
let phead = '     ';
for (let wx = PLAY.minX; wx <= PLAY.maxX; wx++) phead += wx % 10 === 0 ? '|' : ' ';
console.log(phead);
for (let wz = PLAY.minZ; wz <= PLAY.maxZ; wz++) {
  let line = String(wz).padStart(4) + ' ';
  for (let wx = PLAY.minX; wx <= PLAY.maxX; wx++) {
    const col = Math.floor((wx - PLACEMENT.x - X0) / CELL);
    const row = Math.floor((wz - PLACEMENT.z - Z0) / CELL);
    const k = row * COLS + col;
    line += Number.isNaN(floor[k]) ? '.'
      : slope[k] > MAX_SLOPE_RISE ? '/'
      : ceiling[k] !== Infinity ? 'X'
      : enclosed(k) ? 'R'
      : '#';
  }
  console.log(line);
}

// ── Generate the blocker rectangles ──────────────────────────────────────────

/**
 * Emit the cells the character must be kept out of as merged rectangles.
 *
 * These have to be baked rather than probed at runtime. The obvious runtime
 * check — cast down through the space the body would occupy and see if anything
 * is there — cannot work, and not for want of tuning: most of these buildings
 * are modelled from below the roadway up through it, so the probe segment lies
 * strictly *inside* the solid, with no face anywhere along it to hit. Casting
 * only ever finds surfaces, so it finds nothing, whichever way the ray points
 * and whichever way the material faces.
 *
 * Rasterising triangles offline has no such blind spot: a cell knows the full
 * vertical span of everything covering it. So the geometry still answers the
 * question — it just answers it here, once, instead of every frame. Re-run this
 * script whenever the model changes.
 */
const blocked = new Set();
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const wx = cx(col) + PLACEMENT.x, wz = cz(row) + PLACEMENT.z;
    if (wx < PLAY.minX || wx > PLAY.maxX || wz < PLAY.minZ || wz > PLAY.maxZ) continue;
    const k = row * COLS + col;
    if (Number.isNaN(floor[k])) continue; // no road — the ground probe handles it
    if (slope[k] > MAX_SLOPE_RISE || ceiling[k] !== Infinity || enclosed(k)) blocked.add(k);
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
        const area = width * (row - row0 + 1);
        if (!best || area > best.area) best = { area, col0, row0, width, rows: row - row0 + 1 };
      }
    }
    for (let r = 0; r < best.rows; r++) {
      for (let c = 0; c < best.width; c++) remaining.delete((best.row0 + r) * COLS + best.col0 + c);
    }
    rects.push({
      // Cell centres sit at cx(col); the rectangle spans half a cell either side.
      minX: cx(best.col0) - CELL / 2 + PLACEMENT.x,
      maxX: cx(best.col0 + best.width - 1) + CELL / 2 + PLACEMENT.x,
      minZ: cz(best.row0) - CELL / 2 + PLACEMENT.z,
      maxZ: cz(best.row0 + best.rows - 1) + CELL / 2 + PLACEMENT.z,
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
 * Places inside the play bounds that have a road surface underneath but cannot
 * be stood on: ${rects.length} rectangles covering ${blocked.size} square metres of
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
${lines}
];
`;

await writeFile('src/app/core/world/city-blockers.ts', generated, 'utf8');
console.log(`\nWrote src/app/core/world/city-blockers.ts — ${rects.length} rectangles, ${blocked.size} m² blocked`);

// World-space extent of the reachable region, so the play bounds can be authored.
console.log('\nMain region in world coordinates:');
console.log(
  `  X[${(main.minX + PLACEMENT.x).toFixed(0)}..${(main.maxX + PLACEMENT.x).toFixed(0)}]` +
  `  Z[${(main.minZ + PLACEMENT.z).toFixed(0)}..${(main.maxZ + PLACEMENT.z).toFixed(0)}]` +
  `  y[${(main.lo + PLACEMENT.y).toFixed(1)}..${(main.hi + PLACEMENT.y).toFixed(1)}]`,
);
console.log('Flat plaza in world coordinates:');
console.log(
  `  X[${(flat.minX + PLACEMENT.x).toFixed(0)}..${(flat.maxX + PLACEMENT.x).toFixed(0)}]` +
  `  Z[${(flat.minZ + PLACEMENT.z).toFixed(0)}..${(flat.maxZ + PLACEMENT.z).toFixed(0)}]` +
  `  y[${(flat.lo + PLACEMENT.y).toFixed(1)}..${(flat.hi + PLACEMENT.y).toFixed(1)}]`,
);
