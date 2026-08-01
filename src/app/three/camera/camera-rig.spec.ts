import * as THREE from 'three';
import { CameraRig } from './camera-rig';
import { CAM_FOLLOW_DISTANCE, GROUND_Y } from '../../core/world/world.config';

/**
 * Regression cover for the flicker seen when walking past palms.
 *
 * Palm fronds are thin and full of gaps, so the occlusion ray flips between hit
 * and miss several times a second as the character passes a trunk. The rig used
 * to snap inward on every one of those frames and drift back out between them,
 * which read on screen as the camera flashing.
 */
describe('CameraRig occlusion stability', () => {
  const FRAME = 1 / 60;
  /** Facing +Z, which puts the ideal camera seat behind the character at -Z. */
  const YAW = 0;

  function makeRig(): CameraRig {
    return new CameraRig(
      16 / 9,
      58,
      new THREE.Vector3(0, GROUND_Y + 3, -CAM_FOLLOW_DISTANCE),
      new THREE.Vector3(0, GROUND_Y + 1, 0),
    );
  }

  /** A wall between the character at the origin and its seat at -Z. */
  function blocker(): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 0.2), new THREE.MeshBasicMaterial());
    mesh.position.set(0, GROUND_Y + 2, -3);
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  /**
   * Advances one frame and reports how far the camera sits from the character.
   *
   * `update` is driven with a very high responsiveness so the camera lands on
   * the rig's desired seat immediately, isolating the occlusion logic from the
   * positional easing. `snap()` is deliberately avoided — it resets the
   * occlusion distance, which would erase the very state under test.
   */
  function step(rig: CameraRig, colliders: THREE.Object3D[]): number {
    rig.setColliders(colliders);
    rig.followCharacter(0, 0, YAW, FRAME, 58);
    rig.update(FRAME, 1000);
    return Math.hypot(rig.camera.position.x, rig.camera.position.z);
  }

  function settle(rig: CameraRig, colliders: THREE.Object3D[], frames = 180): number {
    let d = 0;
    for (let i = 0; i < frames; i++) d = step(rig, colliders);
    return d;
  }

  it('pulls in when something blocks the line of sight', () => {
    const rig = makeRig();
    expect(settle(rig, [blocker()])).toBeLessThan(CAM_FOLLOW_DISTANCE - 0.5);
  });

  it('holds the pulled-in distance through a one-frame gap in the occluder', () => {
    const rig = makeRig();
    const wall = blocker();
    const occluded = settle(rig, [wall]);

    // The ray misses for a single frame, exactly as it does between fronds.
    const afterGap = step(rig, []);

    // It must barely move: a visible jump here is the flicker.
    expect(Math.abs(afterGap - occluded)).toBeLessThan(0.05);
  });

  it('never jumps far in a single frame while an occluder flickers', () => {
    const rig = makeRig();
    const wall = blocker();

    let previous = settle(rig, [wall], 60);
    let maxJump = 0;

    // Alternate hit/miss every other frame for two seconds.
    for (let i = 0; i < 120; i++) {
      const current = step(rig, i % 2 === 0 ? [wall] : []);
      maxJump = Math.max(maxJump, Math.abs(current - previous));
      previous = current;
    }

    // A tenth of a unit per frame is imperceptible; the old snap moved whole units.
    expect(maxJump).toBeLessThan(0.1);
  });

  it('eases back out once the way is clear for good', () => {
    const rig = makeRig();
    const occluded = settle(rig, [blocker()]);
    const cleared = settle(rig, [], 300);

    expect(cleared).toBeGreaterThan(occluded);
    expect(cleared).toBeCloseTo(CAM_FOLLOW_DISTANCE, 0);
  });

  it('keeps a depth range precise enough not to z-fight foliage', () => {
    const rig = makeRig();
    // Overlapping leaf cards at near-identical depths need headroom in the
    // depth buffer; a ratio in the thousands is where they start to flicker.
    expect(rig.camera.far / rig.camera.near).toBeLessThan(2500);
    // Still far enough to contain the 500-unit sky dome.
    expect(rig.camera.far).toBeGreaterThan(560);
  });
});
