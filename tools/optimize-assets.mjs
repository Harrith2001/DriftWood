/**
 * Asset optimisation pipeline.
 *
 *   npm run assets:build
 *
 * The raw Mixamo/Sketchfab downloads in `assets-src/` are far too heavy to ship:
 * every animation export bundles a full duplicate of the character mesh plus its
 * 4K PNG texture set (~55 MB each) for what amounts to ~21 KB of keyframes.
 *
 * This script produces the runtime set in `src/assets/models/`:
 *
 *   character.glb   mesh + skeleton, textures resized & WebP-compressed
 *   anim-idle.glb   skeleton + animation only (meshes/materials/textures stripped)
 *   anim-walk.glb   ""
 *   anim-fall.glb   ""
 *   island.glb      environment diorama, compressed
 *
 * Re-run it whenever a raw asset changes. Output is deterministic.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, quantize, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Raw downloads live outside `src/` so Angular never copies them into a build. */
const RAW = 'assets-src/models';
/** Runtime set, served at `/assets/models/`. */
const OUT = 'src/assets/models';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

const mb = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';

async function sizeOf(path) {
  try { return (await stat(path)).size; } catch { return 0; }
}

/**
 * Animation-only export: keep the armature and its animation channels, throw
 * away every skinned mesh, material and texture. The AnimationClip tracks
 * target bone nodes, so the motion survives intact — the runtime retargets it
 * onto the single shared character mesh.
 */
async function buildAnimation(src, dest, label) {
  const doc = await io.read(resolve(RAW, src));
  const root = doc.getRoot();

  // Detach meshes from nodes, then drop the mesh + skin definitions themselves.
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const mat of root.listMaterials()) mat.dispose();
  for (const tex of root.listTextures()) tex.dispose();

  // resample() collapses redundant keyframes; keepLeaves preserves bone nodes,
  // which are childless and would otherwise be pruned away.
  await doc.transform(
    resample({ tolerance: 1e-4 }),
    dedup(),
    prune({ keepLeaves: true, keepAttributes: false }),
  );

  const clip = root.listAnimations()[0];
  await mkdir(dirname(resolve(OUT, dest)), { recursive: true });
  await io.write(resolve(OUT, dest), doc);

  const before = await sizeOf(resolve(RAW, src));
  const after = await sizeOf(resolve(OUT, dest));
  console.log(
    `  ${label.padEnd(10)} ${mb(before).padStart(9)} → ${mb(after).padStart(9)}` +
    `   (${clip?.listChannels().length ?? 0} channels kept)`,
  );
}

/**
 * Resizes and re-encodes every texture in place.
 *
 * Deliberately *not* WebP. `textureCompress({ targetFormat: 'webp' })` adds the
 * `EXT_texture_webp` extension, and any runtime that cannot decode WebP through
 * `createImageBitmap` drops every texture on the floor — GLTFLoader logs
 * "Couldn't load texture blob:" and the whole diorama renders flat white. JPEG
 * and PNG are decodable everywhere, so the format is chosen per texture:
 *
 *   alpha actually used  → PNG  (lossless, keeps the mask)
 *   fully opaque         → JPEG (far smaller at the same visual quality)
 *
 * Alpha is measured rather than assumed: plenty of source textures carry a
 * pointless fully-opaque alpha channel, and paying PNG prices for it is waste.
 */
async function recompressTextures(doc, size) {
  let png = 0;
  let jpeg = 0;

  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;

    const input = Buffer.from(image);
    let usesAlpha = false;
    try {
      const meta = await sharp(input).metadata();
      if (meta.hasAlpha) {
        const stats = await sharp(input).stats();
        const alpha = stats.channels[3];
        usesAlpha = Boolean(alpha) && alpha.min < 255;
      }
    } catch {
      // Unreadable image: leave it exactly as it was rather than corrupt it.
      continue;
    }

    const resized = sharp(input).resize(size, size, { fit: 'inside', withoutEnlargement: true });

    if (usesAlpha) {
      texture.setImage(await resized.png({ compressionLevel: 9 }).toBuffer());
      texture.setMimeType('image/png');
      png++;
    } else {
      texture.setImage(await resized.flatten().jpeg({ quality: 84, mozjpeg: true }).toBuffer());
      texture.setMimeType('image/jpeg');
      jpeg++;
    }
  }

  return { png, jpeg };
}

/**
 * Mesh export: geometry welded and quantized, textures resized and re-encoded.
 * Specular/glossiness maps are discarded — the scene renders the character with
 * a matte PBR setup, so they only added weight and sheen.
 */
async function buildMesh(src, dest, label, { textureSize, dropMaps = [] } = {}) {
  const doc = await io.read(resolve(RAW, src));
  const root = doc.getRoot();

  if (dropMaps.length) {
    for (const tex of root.listTextures()) {
      const name = tex.getName() ?? '';
      if (dropMaps.some((m) => name.toLowerCase().includes(m))) tex.dispose();
    }
  }

  // Animations live in the dedicated anim-*.glb files.
  for (const anim of root.listAnimations()) anim.dispose();

  await doc.transform(
    weld(),
    dedup(),
    prune({ keepLeaves: true }),
    quantize({ pattern: /^(POSITION|TEXCOORD|NORMAL|JOINTS|WEIGHTS)(_\d+)?$/ }),
  );

  const encoded = await recompressTextures(doc, textureSize);

  await mkdir(dirname(resolve(OUT, dest)), { recursive: true });
  await io.write(resolve(OUT, dest), doc);

  const before = await sizeOf(resolve(RAW, src));
  const after = await sizeOf(resolve(OUT, dest));
  console.log(
    `  ${label.padEnd(10)} ${mb(before).padStart(9)} → ${mb(after).padStart(9)}` +
    `   (${encoded.jpeg} jpeg, ${encoded.png} png)`,
  );
}

console.log('\nOptimising runtime assets\n');

console.log('Animations (mesh + textures stripped)');
await buildAnimation('Idle.glb', 'anim-idle.glb', 'idle');
await buildAnimation('Happy_Walk.glb', 'anim-walk.glb', 'walk');
await buildAnimation('Falling_Idle.glb', 'anim-fall.glb', 'fall');

console.log('\nMeshes (quantized geometry, JPEG/PNG textures)');
// The character is the hero of the intro portrait and is read at close range,
// so it keeps the higher texture budget.
await buildMesh('Offensive Idle.glb', 'character.glb', 'character', {
  textureSize: 1536,
  dropMaps: ['specular', 'glossiness'],
});
// The island is only ever seen from several metres back across 40 materials;
// 2K per texture was spending 16 MB to resolve detail nobody can see.
await buildMesh(
  'lets_go_to_the_beach_-_beach_themed_diorama/scene.gltf',
  'island.glb',
  'island',
  { textureSize: 1024 },
);

console.log('\nDone — runtime set written to src/assets/models/\n');
