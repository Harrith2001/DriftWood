import * as THREE from 'three';
import {
  COLLECTIBLES,
  PICKUP_CHEST,
  PICKUP_RADIUS,
  type Collectible,
} from '../../core/world/collectibles.config';

/**
 * The bottle caps of the scavenger hunt: spinning, glowing, and picked up by
 * walking into them.
 *
 * Built from procedural geometry rather than an asset. They need to read at
 * distance in a dusk street against brown dirt and grey concrete, which is a
 * job for silhouette and light rather than texture — and the model budget is
 * better spent on the city.
 *
 * Two meshes each: a fluted disc that catches the key light as it turns, and a
 * larger additive halo that does the actual work of being visible from the far
 * end of a street. Geometry and materials are shared across all eight; only the
 * transforms differ.
 */
export class Collectibles {
  readonly group = new THREE.Group();

  private readonly entries: {
    readonly spec: Collectible;
    readonly pivot: THREE.Group;
    readonly disc: THREE.Mesh;
    readonly halo: THREE.Sprite;
    /** 1 while present, falling to 0 through the collection flourish. */
    presence: number;
    collected: boolean;
  }[] = [];

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly haloTexture: THREE.Texture;
  private elapsed = 0;

  constructor(collected: ReadonlySet<string> = new Set()) {
    this.group.name = 'collectibles';

    // A fluted cylinder: twelve sides, so the light breaks across the edge as it
    // spins instead of sliding over a smooth curve.
    const discGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.045, 12);
    this.geometries.push(discGeo);

    const discMat = new THREE.MeshStandardMaterial({
      color: 0xffd15c,
      metalness: 0.75,
      roughness: 0.28,
      emissive: new THREE.Color(0xff8a1f),
      emissiveIntensity: 0.55,
    });
    this.materials.push(discMat);

    this.haloTexture = createHaloTexture();
    const haloMat = new THREE.SpriteMaterial({
      map: this.haloTexture,
      color: 0xffc46b,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
    });
    this.materials.push(haloMat);

    for (const spec of COLLECTIBLES) {
      const pivot = new THREE.Group();
      pivot.position.set(spec.x, spec.y, spec.z);

      const disc = new THREE.Mesh(discGeo, discMat);
      // Stood on edge like a coin, and tipped slightly so it never presents a
      // zero-width silhouette head-on.
      disc.rotation.z = Math.PI / 2;
      disc.rotation.x = 0.28;

      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(1.35);

      pivot.add(halo, disc);
      this.group.add(pivot);

      const already = collected.has(spec.id);
      pivot.visible = !already;
      this.entries.push({ spec, pivot, disc, halo, presence: already ? 0 : 1, collected: already });
    }
  }

  /** Ids already taken. */
  get collectedIds(): string[] {
    return this.entries.filter((e) => e.collected).map((e) => e.spec.id);
  }

  /**
   * Advances the idle motion and reports anything picked up this frame.
   *
   * Returns the specs collected, so the caller can decide what a pickup means —
   * this class knows about spinning and disappearing, not about scores.
   */
  update(delta: number, feetX: number, feetY: number, feetZ: number): Collectible[] {
    this.elapsed += delta;
    const taken: Collectible[] = [];
    const chestY = feetY + PICKUP_CHEST;

    for (const entry of this.entries) {
      if (entry.presence <= 0) {
        if (entry.pivot.visible) entry.pivot.visible = false;
        continue;
      }

      if (!entry.collected) {
        entry.disc.rotation.y += delta * 2.4;
        // Each bobs on its own phase, so eight of them in view do not pulse in
        // unison like a row of indicator lights.
        const phase = entry.spec.x * 0.7 + entry.spec.z * 0.31;
        entry.pivot.position.y = entry.spec.y + Math.sin(this.elapsed * 1.7 + phase) * 0.09;

        if (this.withinReach(entry.spec, feetX, chestY, feetZ)) {
          entry.collected = true;
          taken.push(entry.spec);
        }
      } else {
        // Collection flourish: spin up and swell as it fades, so the eye follows
        // it out rather than finding a hole where it was.
        entry.presence = Math.max(0, entry.presence - delta * 2.6);
        entry.disc.rotation.y += delta * 14;
        entry.pivot.position.y += delta * 1.4;
        const swell = 1 + (1 - entry.presence) * 1.8;
        entry.pivot.scale.setScalar(swell);
      }

      const fade = entry.collected ? entry.presence : 1;
      (entry.halo.material as THREE.SpriteMaterial).opacity = 0.5 * fade;
      entry.halo.scale.setScalar(1.35 * (1 + (1 - fade) * 0.6));
    }

    return taken;
  }

  /**
   * Cylinder test rather than a sphere: generous horizontally so brushing past
   * one at street level takes it, tight vertically so the two hung out of reach
   * stay there until the visitor jumps for them.
   */
  private withinReach(spec: Collectible, x: number, chestY: number, z: number): boolean {
    if (Math.abs(spec.y - chestY) > PICKUP_RADIUS) return false;
    return Math.hypot(spec.x - x, spec.z - z) <= PICKUP_RADIUS;
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.haloTexture.dispose();
    this.entries.length = 0;
    this.group.clear();
    this.group.removeFromParent();
  }
}

/**
 * A soft radial glow, drawn once into a canvas.
 *
 * The halo is what makes a 17 cm disc findable down a hundred metres of dusk
 * street; the disc alone is a few pixels at that range and disappears against
 * the dirt.
 */
function createHaloTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,210,140,0.55)');
    gradient.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
