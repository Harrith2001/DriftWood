import * as THREE from 'three';
import { Beacons } from './beacons';
import { HOTSPOTS } from '../../core/world/world.config';
import type { PanelId } from '../../core/models/experience.model';

/**
 * Regression cover for the "trees are flashing" report.
 *
 * The light shafts are additive, taller than the character and had no distance
 * falloff, so standing near a hotspot put a full-height glowing slab across
 * whatever was behind it — and a pulse that doubled their opacity turned that
 * slab into a strobe. What looked like flickering palms was the beacon in front
 * of them.
 */
describe('Beacons', () => {
  const FRAME = 1 / 60;
  const NONE: ReadonlySet<PanelId> = new Set();
  const spot = HOTSPOTS[0];

  /** Runs enough frames for the eased state to settle, then reports the shaft. */
  function settle(beacons: Beacons, cameraDistance: number): THREE.MeshBasicMaterial {
    const camera = new THREE.Vector3(spot.x + cameraDistance, 4, spot.z);
    for (let i = 0; i < 120; i++) beacons.update(FRAME, null, NONE, camera);
    const column = beacons.group.children.find(
      (c) => (c as THREE.Mesh).geometry instanceof THREE.CylinderGeometry,
    ) as THREE.Mesh;
    return column.material as THREE.MeshBasicMaterial;
  }

  it('hides the light shaft when the camera is close', () => {
    const beacons = new Beacons();
    const mat = settle(beacons, 4);
    expect(mat.opacity).toBeLessThan(0.005);
    beacons.dispose();
  });

  it('shows the light shaft from across the island', () => {
    const beacons = new Beacons();
    const mat = settle(beacons, 25);
    expect(mat.opacity).toBeGreaterThan(0.03);
    beacons.dispose();
  });

  it('keeps the pulse gentle enough not to strobe', () => {
    const beacons = new Beacons();
    const camera = new THREE.Vector3(spot.x + 25, 4, spot.z);
    for (let i = 0; i < 120; i++) beacons.update(FRAME, null, NONE, camera);

    const column = beacons.group.children.find(
      (c) => (c as THREE.Mesh).geometry instanceof THREE.CylinderGeometry,
    ) as THREE.Mesh;
    const mat = column.material as THREE.MeshBasicMaterial;

    // Sample a full breath and compare the extremes. The old pulse ran from
    // 0.1 to 0.2 — a 2x swing, which on an additive material reads as blinking.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 400; i++) {
      beacons.update(FRAME, null, NONE, camera);
      min = Math.min(min, mat.opacity);
      max = Math.max(max, mat.opacity);
    }

    expect(max / min).toBeLessThan(2);
    beacons.dispose();
  });

  it('never lets the additive shaft get bright enough to wash out the scene', () => {
    const beacons = new Beacons();
    const camera = new THREE.Vector3(spot.x + 40, 4, spot.z);
    let peak = 0;
    const column = () =>
      beacons.group.children.find(
        (c) => (c as THREE.Mesh).geometry instanceof THREE.CylinderGeometry,
      ) as THREE.Mesh;

    // Nearby state is the brightest the beacon ever gets.
    for (let i = 0; i < 400; i++) {
      beacons.update(FRAME, spot.id, NONE, camera);
      peak = Math.max(peak, (column().material as THREE.MeshBasicMaterial).opacity);
    }

    expect(peak).toBeLessThan(0.2);
    beacons.dispose();
  });

  it('dims a hotspot that has already been read', () => {
    const camera = new THREE.Vector3(spot.x + 25, 4, spot.z);
    const ringOf = (b: Beacons) => {
      const ring = b.group.children.find(
        (c) => (c as THREE.Mesh).geometry instanceof THREE.RingGeometry,
      ) as THREE.Mesh;
      return (ring.material as THREE.MeshBasicMaterial).opacity;
    };

    const fresh = new Beacons();
    for (let i = 0; i < 120; i++) fresh.update(FRAME, null, NONE, camera);

    const read = new Beacons();
    const discovered: ReadonlySet<PanelId> = new Set([spot.id]);
    for (let i = 0; i < 120; i++) read.update(FRAME, null, discovered, camera);

    expect(ringOf(read)).toBeLessThan(ringOf(fresh));
    fresh.dispose();
    read.dispose();
  });
});
