/** Diagnostic: how many meshes share each foliage material? */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('src/assets/models/island.glb');

const byMaterial = new Map();
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? '?';
    if (!byMaterial.has(name)) byMaterial.set(name, []);
    byMaterial.get(name).push(mesh.getName());
  }
}
for (const [mat, meshes] of [...byMaterial].sort((a, b) => b[1].length - a[1].length)) {
  if (!/palm|plant|leaf|leaves|bush/i.test(mat)) continue;
  console.log(`${mat}: ${meshes.length} mesh(es)`);
  console.log('   ' + meshes.slice(0, 4).join(', ') + (meshes.length > 4 ? ' …' : ''));
}
