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
    { ring: THREE.Mesh; column: THREE.Mesh; base: number; x: number; z: number }
  >();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private elapsed = 0;

  /**
   * Below FADE_NEAR the shaft is gone entirely; above FADE_FAR it is at full
   * strength. Tuned against the island, which is only about nineteen units
   * across: push these out much further and the shafts never really appear, so
   * they stop doing the one job they exist for.
   */
  private static readonly FADE_NEAR = 5;
  private static readonly FADE_FAR = 11;

  constructor() {
    this.group.name = 'beacons';

    const ringGeo = new THREE.RingGeometry(0.85, 1.35, 40);
    // Slimmer and shorter than it once was, with enough segments that the
    // silhouette reads as a shaft of light rather than a faceted tube.
    const columnGeo = new THREE.CylinderGeometry(0.09, 0.18, 5, 24, 1, true);
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
      column.position.set(spot.x, GROUND_Y + 2.5, spot.z);

      this.materials.push(ringMat, columnMat);
      this.group.add(ring, column);
      this.entries.set(spot.id, { ring, column, base: 1, x: spot.x, z: spot.z });
    }
  }

  /**
   * @param delta        frame time
   * @param nearby       hotspot currently in range, if any
   * @param discovered   hotspots already read, which fade back
   * @param cameraPos    used to fade the light shafts out at close range
   */
  update(
    delta: number,
    nearby: PanelId | null,
    discovered: ReadonlySet<PanelId>,
    cameraPos?: THREE.Vector3,
  ): void {
    this.elapsed += delta;
    // Gentle breathing. The amplitude is deliberately small: the shafts are
    // additive, so a pulse that doubles their opacity reads as a strobe rather
    // than a glow, and anything it passes in front of appears to flash.
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 1.1);

    for (const [id, entry] of this.entries) {
      const isNear = id === nearby;
      const isRead = discovered.has(id);
      const target = isNear ? 1.4 : isRead ? 0.35 : 1;

      // Ease toward the target so state changes never snap.
      entry.base = THREE.MathUtils.lerp(entry.base, target, Math.min(1, delta * 5));

      const ringMat = entry.ring.material as THREE.MeshBasicMaterial;
      const colMat = entry.column.material as THREE.MeshBasicMaterial;

      // The shaft exists to say "something is over there". Up close that job is
      // done by the ground ring and the on-screen prompt, while the shaft itself
      // becomes a full-height slab washing over the palms behind it — so it
      // fades right out as you approach.
      let proximity = 1;
      if (cameraPos) {
        const distance = Math.hypot(cameraPos.x - entry.x, cameraPos.z - entry.z);
        proximity = THREE.MathUtils.smoothstep(distance, Beacons.FADE_NEAR, Beacons.FADE_FAR);
      }

      ringMat.opacity = (0.26 + 0.16 * pulse) * entry.base;
      colMat.opacity = (0.05 + 0.045 * pulse) * entry.base * proximity;
      entry.column.visible = colMat.opacity > 0.004;

      // The ring is the close-range cue, so it keeps its gentle breathing scale.
      entry.ring.scale.setScalar(1 + 0.05 * pulse * entry.base);
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
