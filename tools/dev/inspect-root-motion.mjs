/** Diagnostic: reports hip translation range per clip — i.e. baked root motion. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const f of ['anim-idle', 'anim-walk', 'anim-fall']) {
  const doc = await io.read(`src/assets/models/${f}.glb`);
  const anim = doc.getRoot().listAnimations()[0];
  console.log(`\n${f}:`);
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode()?.getName() ?? '?';
    if (ch.getTargetPath() !== 'translation') continue;
    if (!/hips/i.test(node)) continue;
    const a = ch.getSampler().getOutput().getArray();
    let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,minZ=1e9,maxZ=-1e9;
    for (let i=0;i<a.length;i+=3){
      minX=Math.min(minX,a[i]); maxX=Math.max(maxX,a[i]);
      minY=Math.min(minY,a[i+1]); maxY=Math.max(maxY,a[i+1]);
      minZ=Math.min(minZ,a[i+2]); maxZ=Math.max(maxZ,a[i+2]);
    }
    console.log(`  ${node}  keys=${a.length/3}`);
    console.log(`    X ${minX.toFixed(2)}..${maxX.toFixed(2)}  drift ${(maxX-minX).toFixed(2)}`);
    console.log(`    Y ${minY.toFixed(2)}..${maxY.toFixed(2)}  drift ${(maxY-minY).toFixed(2)}`);
    console.log(`    Z ${minZ.toFixed(2)}..${maxZ.toFixed(2)}  drift ${(maxZ-minZ).toFixed(2)}`);
  }
}
