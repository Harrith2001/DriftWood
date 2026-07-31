import * as THREE from 'three';
import { LandingPose } from './landing-pose';

/**
 * The landing crouch is procedural, so its failure mode is silent: if the bone
 * names stop matching, `apply()` runs happily and simply does nothing, and the
 * character lands bolt upright with no error anywhere. These tests make that
 * failure loud.
 */
describe('LandingPose', () => {
  /** Builds a rig whose bones are named in the given style. */
  function makeRig(format: (name: string) => string): THREE.Object3D {
    const root = new THREE.Object3D();
    const names = [
      'Hips',
      'Spine',
      'Spine1',
      'LeftUpLeg',
      'RightUpLeg',
      'LeftLeg',
      'RightLeg',
      'LeftArm',
      'RightArm',
      'LeftForeArm',
      'RightForeArm',
    ];
    for (const name of names) {
      const bone = new THREE.Bone();
      bone.name = format(name);
      root.add(bone);
    }
    return root;
  }

  it('resolves every bone on a colon-prefixed rig', () => {
    const pose = new LandingPose(makeRig((n) => `mixamorig:${n}`));
    expect(pose.resolvedBones.length).toBe(11);
  });

  it('resolves every bone on an underscore-prefixed rig', () => {
    const pose = new LandingPose(makeRig((n) => `mixamorig_${n}`));
    expect(pose.resolvedBones.length).toBe(11);
  });

  it('resolves every bone on a bare-prefixed rig', () => {
    // This is the spelling GLTFLoader leaves behind after sanitising `:`.
    const pose = new LandingPose(makeRig((n) => `mixamorig${n}`));
    expect(pose.resolvedBones.length).toBe(11);
  });

  it('does not confuse UpLeg with Leg, or ForeArm with Arm', () => {
    const rig = makeRig((n) => `mixamorig${n}`);
    const pose = new LandingPose(rig);
    const resolved = new Set(pose.resolvedBones);
    // All four must resolve independently; a greedy suffix match would collapse
    // LeftLeg into LeftUpLeg and LeftArm into LeftForeArm.
    for (const key of ['leftUpLeg', 'leftLeg', 'leftArm', 'leftForeArm']) {
      expect(resolved.has(key)).toBe(true);
    }
  });

  it('actually rotates bones when applied', () => {
    const rig = makeRig((n) => `mixamorig${n}`);
    const pose = new LandingPose(rig);
    const knee = rig.children.find((c) => c.name === 'mixamorigLeftLeg')!;
    const before = knee.quaternion.clone();

    pose.apply(1);

    expect(knee.quaternion.angleTo(before)).toBeGreaterThan(0.5);
  });

  it('leaves the pose untouched at zero', () => {
    const rig = makeRig((n) => `mixamorig${n}`);
    const pose = new LandingPose(rig);
    const knee = rig.children.find((c) => c.name === 'mixamorigLeftLeg')!;
    const before = knee.quaternion.clone();

    pose.apply(0);

    expect(knee.quaternion.angleTo(before)).toBe(0);
  });

  it('scales with the crouch amount', () => {
    const rigHalf = makeRig((n) => `mixamorig${n}`);
    const rigFull = makeRig((n) => `mixamorig${n}`);
    const kneeHalf = rigHalf.children.find((c) => c.name === 'mixamorigLeftLeg')!;
    const kneeFull = rigFull.children.find((c) => c.name === 'mixamorigLeftLeg')!;
    const rest = kneeHalf.quaternion.clone();

    new LandingPose(rigHalf).apply(0.5);
    new LandingPose(rigFull).apply(1);

    expect(kneeFull.quaternion.angleTo(rest)).toBeGreaterThan(kneeHalf.quaternion.angleTo(rest));
  });
});
