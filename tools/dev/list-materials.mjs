/** Diagnostic: lists island material + mesh names so water/sea surfaces can be identified. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('src/assets/models/island.glb');
const root = doc.getRoot();
console.log('MATERIALS:');
for (const m of root.listMaterials()) console.log('  ' + m.getName());
console.log('\nMESHES:');
for (const m of root.listMeshes()) console.log('  ' + m.getName());
