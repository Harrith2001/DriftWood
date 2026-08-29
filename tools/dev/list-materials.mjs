/** Diagnostic: lists environment material + mesh names so walkable surfaces can be identified. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('src/assets/models/city.glb');
const root = doc.getRoot();
console.log('MATERIALS:');
for (const m of root.listMaterials()) console.log('  ' + m.getName());
console.log('\nMESHES:');
for (const m of root.listMeshes()) console.log('  ' + m.getName());
