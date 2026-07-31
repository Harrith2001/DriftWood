/** Diagnostic: compares material/texture wiring between the raw and optimised island. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const [label, path] of [
  ['RAW', 'assets-src/models/lets_go_to_the_beach_-_beach_themed_diorama/scene.gltf'],
  ['OPT', 'src/assets/models/island.glb'],
]) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  const mats = root.listMaterials();
  const withBase = mats.filter(m => m.getBaseColorTexture());
  console.log(`\n${label}`);
  console.log('  extensionsUsed:', root.listExtensionsUsed().map(e => e.extensionName).join(', ') || 'none');
  console.log('  materials:', mats.length, '| withBaseColorTexture:', withBase.length);
  console.log('  textures:', root.listTextures().length);
  for (const m of mats.slice(0, 6)) {
    console.log(`   - ${(m.getName()||'?').padEnd(26)} base=${!!m.getBaseColorTexture()} alphaMode=${m.getAlphaMode()} baseFactor=[${m.getBaseColorFactor().map(n=>n.toFixed(2)).join(',')}]`);
  }
}
