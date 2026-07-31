import * as THREE from 'three';
import { GROUND_Y, HOTSPOTS } from '../../core/world/world.config';
import type { PanelId } from '../../core/models/experience.model';

/**
 * Hotspot beacons: a soft ground ring and a slim column of light at each
 * discoverable location.
 *
 * These exist for wayfinding. Dropping a visitor into an open world with no
 * indication of where to go is the fastest way to have them leave, so each
 * point of interest advertises itself from across the island, brightens as you
 * approach, and dims once you have read it.
 */
export class Beacons {
  readonly group = new THREE.Group();
  private readonly entries = new Map<
    PanelId,
    { ring: THREE.Mesh; column: THREE.Mesh; base: number }
  >();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private elapsed = 0;

  constructor() {
    this.group.name = 'beacons';

    const ringGeo = new THREE.RingGeometry(0.85, 1.35, 40);
    const columnGeo = new THREE.CylinderGeometry(0.16, 0.28, 7, 14, 1, true);
    this.geometries.push(ringGeo, columnGeo);

    for (const spot of HOTSPOTS) {
      const color = new THREE.Color(spot.color);

      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      // Just clear of the ground to avoid z-fighting with the sand.
      ring.position.set(spot.x, GROUND_Y + 0.03, spot.z);

      const columnMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const column = new THREE.Mesh(columnGeo, columnMat);
      column.position.set(spot.x, GROUND_Y + 3.5, spot.z);

      this.materials.push(ringMat, columnMat);
      this.group.add(ring, column);
      this.entries.set(spot.id, { ring, column, base: 1 });
    }
  }

  /**
   * @param delta        frame time
   * @param nearby       hotspot currently in range, if any
   * @param discovered   hotspots already read, which fade back
   */
  update(delta: number, nearby: PanelId | null, discovered: ReadonlySet<PanelId>): void {
    this.elapsed += delta;
    // Slow breathing pulse so the beacons read as alive without flickering.
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 1.5);

    for (const [id, entry] of this.entries) {
      const isNear = id === nearby;
      const isRead = discovered.has(id);
      const target = isNear ? 1.6 : isRead ? 0.35 : 1;

      // Ease toward the target so state changes never snap.
      entry.base = THREE.MathUtils.lerp(entry.base, target, Math.min(1, delta * 5));

      const ringMat = entry.ring.material as THREE.MeshBasicMaterial;
      const colMat = entry.column.material as THREE.MeshBasicMaterial;
      ringMat.opacity = 0.28 * entry.base + 0.22 * pulse * entry.base;
      colMat.opacity = 0.1 * entry.base + 0.1 * pulse * entry.base;

      const scale = 1 + 0.06 * pulse * entry.base;
      entry.ring.scale.setScalar(scale);
      entry.column.rotation.y += delta * 0.25;
    }
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.entries.clear();
    this.group.clear();
    this.group.removeFromParent();
  }
}
