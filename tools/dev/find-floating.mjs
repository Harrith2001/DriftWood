/**
 * Finds geometry that hangs in mid-air above the terrain.
 *
 *   node tools/dev/find-floating.mjs
 *
 * The hillside shacks in this model were built to be looked at from the street
 * below, where a gap under a floor is hidden by the ridge line. Once the whole
 * neighbourhood became walkable the visitor can stand up there, and anything
 * left hovering is suddenly the most obvious thing in frame.
 *
 * Terrain height is rasterised first, then every mesh is measured against the
 * ground beneath its own footprint. Reported in world coordinates.
 *
 * What it found, for the record: nothing. The shack that looked like it was
 * hovering over the ridge is a tall wall whose top clears the crest, seen from
 * below — the model has no genuinely floating geometry. The real problem was
 * that the entire hilltop is undressed backdrop, which is why the fix was a
 * height cap in `probe-city.mjs` rather than nudging a prop. Kept because
 * ruling a cause out is worth as much as confirming one, and the next person to
 * see something hanging in the air will want to check the same thing.
 *
 * Two traps this walked into, both worth knowing before trusting its output:
 * measuring a mesh's base against the terrain flags every roof in the model, and
 * matching meshes by their bounding-box centre misses any node that is one slice
 * of a material shared across the whole map.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const SRC = 'assets-src/models/popular_streets_of_lima/scene.gltf';

/** Materials that make up the ground: terrain, roads, yards. */
const TERRAIN = new Set(['ground', 'rocks', 'atlas_street', 'concretopoor', 'grass']);
/** Things that are supposed to be off the ground. */
const AERIAL = /^(emitYELL|emiWHITE|glasss|atlas_plantsTRP|metalRusty|woodR|damagedmetal)$/;

/** Where the model is seated; see MODEL_OFFSET in world.config.ts. */
const PLACEMENT = { x: 29, y: 2.2, z: -6 };

const CELL = 1.0;
const X0 = -105, X1 = 48;
const Z0 = -205, Z1 = 85;
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

function* primitives() {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = worldMatrix(node);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      yield { node, prim, m, mat: prim.getMaterial()?.getName() ?? '(none)', pos };
    }
  }
}

// ── Terrain height ───────────────────────────────────────────────────────────

const terrain = new Float32Array(COLS * ROWS).fill(NaN);
const cx = (col) => X0 + (col + 0.5) * CELL;
const cz = (row) => Z0 + (row + 0.5) * CELL;

for (const { m, mat, prim, pos } of primitives()) {
  if (!TERRAIN.has(mat)) continue;
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  const at = (i) => {
    const v = pos.getElement(idx ? idx.getScalar(i) : i, []);
    return apply(m, v[0], v[1], v[2]);
  };
  for (let i = 0; i + 2 < count; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-9) continue;

    const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - X0) / CELL));
    const c1 = Math.min(COLS - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - X0) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - Z0) / CELL));
    const r1 = Math.min(ROWS - 1, Math.ceil((Math.max(a[2], b[2], c[2]) - Z0) / CELL));

    for (let col = c0; col <= c1; col++) {
      for (let row = r0; row <= r1; row++) {
        const px = cx(col), pz = cz(row);
        const w0 = ((px - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (pz - a[2])) / d;
        const w1 = ((b[0] - a[0]) * (pz - a[2]) - (px - a[0]) * (b[2] - a[2])) / d;
        if (w0 < -1e-6 || w1 < -1e-6 || w0 + w1 > 1 + 1e-6) continue;
        const y = a[1] + w0 * (b[1] - a[1]) + w1 * (c[1] - a[1]);
        const k = row * COLS + col;
        if (Number.isNaN(terrain[k]) || y > terrain[k]) terrain[k] = y;
      }
    }
  }
}

// ── Measure every mesh against the ground under it ───────────────────────────

const findings = [];
for (const { node, m, mat, prim, pos } of primitives()) {
  if (TERRAIN.has(mat) || AERIAL.test(mat)) continue;

  const lo = pos.getMin([]), hi = pos.getMax([]);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = apply(m, i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  }

  const footprint = (max[0] - min[0]) * (max[2] - min[2]);
  if (footprint < 2) continue; // too small to read as a building

  // Highest terrain anywhere under the footprint. Highest rather than average,
  // because a shack on a ridge only looks wrong where the ridge is closest.
  let under = -Infinity, samples = 0;
  const c0 = Math.max(0, Math.floor((min[0] - X0) / CELL));
  const c1 = Math.min(COLS - 1, Math.ceil((max[0] - X0) / CELL));
  const r0 = Math.max(0, Math.floor((min[2] - Z0) / CELL));
  const r1 = Math.min(ROWS - 1, Math.ceil((max[2] - Z0) / CELL));
  for (let col = c0; col <= c1; col++) {
    for (let row = r0; row <= r1; row++) {
      const t = terrain[row * COLS + col];
      if (Number.isNaN(t)) continue;
      samples++;
      if (t > under) under = t;
    }
  }
  if (!samples) continue; // nothing below it at all — off the map, not floating

  // How much of the footprint actually has ground close under it.
  //
  // The gap alone is the wrong measure and says so loudly: it flags every roof
  // in the model, because a roof's base is metres above the terrain by
  // definition. What reads as floating on screen is a building with daylight
  // under part of it — perched half off a ridge, with the slope falling away
  // beneath the overhanging half.
  let supported = 0, covered = 0;
  for (let col = c0; col <= c1; col++) {
    for (let row = r0; row <= r1; row++) {
      const t = terrain[row * COLS + col];
      if (Number.isNaN(t)) continue;
      covered++;
      if (t >= min[1] - 2.5 && t <= min[1] + 0.6) supported++;
    }
  }
  const support = covered ? supported / covered : 0;

  const gap = min[1] - under;
  // Only walls and floors: a roof plane is meant to be off the ground.
  const isShell = max[1] - min[1] > 1.2;
  if (isShell && gap > 0.4 && support < 0.35) {
    findings.push({
      name: node.getName(), mat, gap, footprint, support,
      world: {
        x: (min[0] + max[0]) / 2 + PLACEMENT.x,
        y: min[1] + PLACEMENT.y,
        z: (min[2] + max[2]) / 2 + PLACEMENT.z,
      },
      groundWorld: under + PLACEMENT.y,
    });
  }
}

// ── Focused query ────────────────────────────────────────────────────────────

/**
 * `node tools/dev/find-floating.mjs <worldX> <worldZ> [radius]` lists everything
 * near a point, gap or no gap. The whole-model sweep above only reports meshes
 * that clear the ground; something can look like it is hanging in the air for
 * other reasons — a ridge falling away behind it, a wall whose base is buried —
 * and those need eyes on the actual numbers.
 */
if (process.argv.length >= 4) {
  const qx = Number(process.argv[2]) - PLACEMENT.x;
  const qz = Number(process.argv[3]) - PLACEMENT.z;
  const radius = Number(process.argv[4] ?? 12);

  const near = [];
  for (const { node, m, mat, prim, pos } of primitives()) {
    const lo = pos.getMin([]), hi = pos.getMax([]);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
      const p = apply(m, i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]);
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
    }
    const midX = (min[0] + max[0]) / 2, midZ = (min[2] + max[2]) / 2;
    // Match either the mesh's centre or any part of its footprint, so a node
    // that happens to be one slice of a sprawling merged mesh is still found.
    const overlaps =
      qx >= min[0] - radius && qx <= max[0] + radius &&
      qz >= min[2] - radius && qz <= max[2] + radius;
    if (!overlaps && Math.hypot(midX - qx, midZ - qz) > radius) continue;

    let under = -Infinity;
    const c0 = Math.max(0, Math.floor((min[0] - X0) / CELL));
    const c1 = Math.min(COLS - 1, Math.ceil((max[0] - X0) / CELL));
    const r0 = Math.max(0, Math.floor((min[2] - Z0) / CELL));
    const r1 = Math.min(ROWS - 1, Math.ceil((max[2] - Z0) / CELL));
    for (let col = c0; col <= c1; col++) {
      for (let row = r0; row <= r1; row++) {
        const t = terrain[row * COLS + col];
        if (!Number.isNaN(t) && t > under) under = t;
      }
    }

    near.push({
      name: node.getName(), mat,
      x: midX + PLACEMENT.x, z: midZ + PLACEMENT.z,
      baseY: min[1] + PLACEMENT.y, topY: max[1] + PLACEMENT.y,
      ground: under === -Infinity ? null : under + PLACEMENT.y,
    });
  }

  near.sort((a, b) => a.baseY - b.baseY);
  console.log(`\nWithin ${radius} m of world (${process.argv[2]}, ${process.argv[3]}) — ${near.length} meshes\n`);
  console.log('base'.padStart(7), 'top'.padStart(7), 'ground'.padStart(8), 'gap'.padStart(7), '  centre'.padEnd(18), 'material'.padEnd(20), 'node');
  for (const n of near) {
    const gap = n.ground === null ? null : n.baseY - n.ground;
    console.log(
      n.baseY.toFixed(2).padStart(7),
      n.topY.toFixed(2).padStart(7),
      (n.ground === null ? '—' : n.ground.toFixed(2)).padStart(8),
      (gap === null ? '—' : gap.toFixed(2)).padStart(7),
      `  (${n.x.toFixed(0)}, ${n.z.toFixed(0)})`.padEnd(18),
      n.mat.padEnd(20),
      n.name,
    );
  }
  process.exit(0);
}

findings.sort((a, b) => b.gap - a.gap);

console.log(`\n${findings.length} meshes sit clear of the ground beneath them\n`);
console.log('gap'.padStart(7), 'support'.padStart(8), 'footprint'.padStart(10), '  world position'.padEnd(28), 'material'.padEnd(20), 'node');
for (const f of findings.slice(0, 25)) {
  console.log(
    f.gap.toFixed(2).padStart(7),
    (Math.round(f.support*100)+'%').padStart(8),
    (f.footprint.toFixed(0) + ' m²').padStart(10),
    `  (${f.world.x.toFixed(0)}, ${f.world.y.toFixed(1)}, ${f.world.z.toFixed(0)}) on ${f.groundWorld.toFixed(1)}`.padEnd(28),
    f.mat.padEnd(20),
    f.name,
  );
}
