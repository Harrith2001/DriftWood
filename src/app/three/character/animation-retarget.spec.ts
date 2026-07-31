import * as THREE from 'three';
import { buildSkeletonMap, retargetClip } from './animation-retarget';

/**
 * Regression cover for the T-pose bug.
 *
 * The walk export named its bones `mixamorig_Hips` while the character mesh used
 * `mixamorig:Hips` (sanitised by GLTFLoader to `mixamorigHips`). Tracks silently
 * failed to bind, the mixer reported a healthy weight while animating nothing,
 * and the skeleton fell back to its bind pose. These tests fail if that
 * name-matching ever regresses.
 */
describe('animation retargeting', () => {
  /** Stand-in for a loaded character: bones named the way GLTFLoader leaves them. */
  function makeSkeletonRoot(): THREE.Object3D {
    const root = new THREE.Object3D();
    for (const name of ['mixamorigHips', 'mixamorigSpine', 'mixamorigLeftArm']) {
      const bone = new THREE.Bone();
      bone.name = name;
      root.add(bone);
    }
    return root;
  }

  function track(name: string): THREE.KeyframeTrack {
    return new THREE.QuaternionKeyframeTrack(name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
  }

  it('maps underscore-separated bone names onto the character skeleton', () => {
    const skeleton = buildSkeletonMap(makeSkeletonRoot());
    const source = new THREE.AnimationClip('mixamo.com', 1, [
      track('mixamorig_Hips.quaternion'),
      track('mixamorig_Spine.quaternion'),
    ]);

    const { clip, bound, dropped } = retargetClip(source, '__walk__', skeleton);

    expect(bound).toBe(2);
    expect(dropped).toBe(0);
    expect(clip.tracks.map((t) => t.name)).toEqual([
      'mixamorigHips.quaternion',
      'mixamorigSpine.quaternion',
    ]);
  });

  it('passes through names that already match', () => {
    const skeleton = buildSkeletonMap(makeSkeletonRoot());
    const source = new THREE.AnimationClip('mixamo.com', 1, [track('mixamorigHips.quaternion')]);

    const { clip, bound } = retargetClip(source, '__idle__', skeleton);

    expect(bound).toBe(1);
    expect(clip.tracks[0].name).toBe('mixamorigHips.quaternion');
  });

  it('drops tracks for bones the character does not have', () => {
    const skeleton = buildSkeletonMap(makeSkeletonRoot());
    const source = new THREE.AnimationClip('mixamo.com', 1, [
      track('mixamorigHips.quaternion'),
      // Finger tips exist in the clip but not on this rig.
      track('mixamorig_RightHandPinky3.quaternion'),
    ]);

    const { bound, dropped } = retargetClip(source, '__fall__', skeleton);

    expect(bound).toBe(1);
    expect(dropped).toBe(1);
  });

  it('strips baked root motion from the hips so the mesh cannot drift off', () => {
    const skeleton = buildSkeletonMap(makeSkeletonRoot());
    // A walk cycle that travels 300 units forward across its loop, which is how
    // Mixamo exports locomotion unless "In Place" was ticked.
    const source = new THREE.AnimationClip('mixamo.com', 1, [
      new THREE.VectorKeyframeTrack(
        'mixamorigHips.position',
        [0, 0.5, 1],
        [0, 90, 0, 2, 95, 150, 4, 90, 300],
      ),
    ]);

    const { clip } = retargetClip(source, '__walk__', skeleton);
    const values = Array.from(clip.tracks[0].values);

    // Horizontal channels frozen at their first-frame values...
    expect([values[0], values[3], values[6]]).toEqual([0, 0, 0]);
    expect([values[2], values[5], values[8]]).toEqual([0, 0, 0]);
    // ...while the vertical bob survives, since that is gait, not travel.
    expect([values[1], values[4], values[7]]).toEqual([90, 95, 90]);
  });

  it('leaves non-root position tracks untouched', () => {
    const skeleton = buildSkeletonMap(makeSkeletonRoot());
    const source = new THREE.AnimationClip('mixamo.com', 1, [
      new THREE.VectorKeyframeTrack('mixamorigLeftArm.position', [0, 1], [0, 0, 0, 5, 5, 5]),
    ]);

    const { clip } = retargetClip(source, '__x__', skeleton);
    expect(Array.from(clip.tracks[0].values)).toEqual([0, 0, 0, 5, 5, 5]);
  });

  it('gives every clip a unique name so clipAction() cannot collapse them', () => {
    const skeleton = buildSkeletonMap(makeSkeletonRoot());
    // Every Mixamo export shares this clip name.
    const source = new THREE.AnimationClip('mixamo.com', 1, [track('mixamorigHips.quaternion')]);

    const idle = retargetClip(source, '__idle__', skeleton).clip;
    const walk = retargetClip(source, '__walk__', skeleton).clip;

    expect(idle.name).not.toBe(walk.name);
  });

});
