/** Diagnostic: prints skeleton node names and animation targets per runtime GLB. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of ['character','anim-idle','anim-walk','anim-fall']) {
  const doc = await io.read(`src/assets/models/${f}.glb`);
  const nodes = doc.getRoot().listNodes().map(n=>n.getName());
  const anim = doc.getRoot().listAnimations()[0];
  const targets = anim ? [...new Set(anim.listChannels().map(c=>c.getTargetNode()?.getName()))] : [];
  console.log(`\n${f}:`);
  console.log('  nodes(6):', nodes.slice(0,6).join(', '));
  console.log('  underscore-prefixed:', nodes.some(n=>n?.startsWith('mixamorig_')), '| totalNodes:', nodes.length);
  if (anim) console.log('  duration:', anim.listSamplers()[0] ? '(see inspect)' : '', 'animTargets(4):', targets.slice(0,4).join(', '));
}
