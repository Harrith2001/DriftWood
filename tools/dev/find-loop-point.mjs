/**
 * Diagnostic: for each candidate end-frame, how close is that pose to frame 0?
 * A good loop point is a local minimum — the clip can restart there unnoticed.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const doc = await io.read('src/assets/models/anim-idle.glb');
const anim = doc.getRoot().listAnimations()[0];

// Gather rotation samplers: node -> {times, values(quat)}
const rot = [];
for (const ch of anim.listChannels()) {
  if (ch.getTargetPath() !== 'rotation') continue;
  const s = ch.getSampler();
  rot.push({ times: s.getInput().getArray(), values: s.getOutput().getArray() });
}
const dur = Math.max(...rot.map(r => r.times[r.times.length - 1]));
console.log(`tracks=${rot.length} duration=${dur.toFixed(2)}s`);

const quatAt = (r, t) => {
  let i = 0;
  while (i < r.times.length - 1 && r.times[i + 1] < t) i++;
  return [r.values[i*4], r.values[i*4+1], r.values[i*4+2], r.values[i*4+3]];
};
const angle = (a, b) => {
  const d = Math.abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]);
  return 2 * Math.acos(Math.min(1, d));
};

const base = rot.map(r => quatAt(r, 0));
const rows = [];
for (let t = 0.4; t <= dur; t += 0.1) {
  let sum = 0;
  rot.forEach((r, i) => { sum += angle(base[i], quatAt(r, t)); });
  rows.push({ t: +t.toFixed(2), err: +sum.toFixed(2) });
}
rows.sort((a, b) => a.err - b.err);
console.log('\nBest loop end-times (lowest pose difference from frame 0):');
for (const r of rows.slice(0, 12)) console.log(`  t=${r.t}s  err=${r.err}`);
console.log('\nErr at the current 1.67s trim point:',
  rows.find(r => Math.abs(r.t - 1.7) < 0.06)?.err);
