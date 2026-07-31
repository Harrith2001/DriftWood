import * as THREE from 'three';

/**
 * Ground impact effect: an expanding shockwave ring plus a burst of dust motes
 * kicked outward from the point of contact.
 *
 * Both are driven by a single 0→1 progress value rather than their own clocks,
 * so the effect stays locked to the landing timeline no matter what the frame
 * rate does. Everything is allocated once up front — a particle system that
 * allocates on trigger stutters at exactly the moment it needs not to.
 */
export class ImpactBurst {
  readonly group = new THREE.Group();

  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly motes: THREE.Points;
  private readonly moteMaterial: THREE.PointsMaterial;
  private readonly moteGeometry: THREE.BufferGeometry;
  private readonly ringGeometry: THREE.RingGeometry;
  private readonly texture: THREE.Texture;

  /** Per-mote launch direction and speed, sampled once at construction. */
  private readonly directions: Float32Array;
  private readonly speeds: Float32Array;
  private readonly basePositions: Float32Array;

  private static readonly MOTE_COUNT = 90;

  constructor() {
    this.group.name = 'impact-burst';
    this.group.visible = false;

    // ── Shockwave ring, lying flat on the ground ──
    // Thin annulus: a wide one scales up into a filled disc that swamps the
    // whole pier rather than reading as a pressure wave travelling outward.
    this.ringGeometry = new THREE.RingGeometry(0.86, 1.0, 64);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe6c4,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring);

    // ── Dust motes ──
    this.texture = createMoteTexture();
    const count = ImpactBurst.MOTE_COUNT;
    this.directions = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    this.basePositions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      // Mostly outward and low, with a little lift — dust does not fountain.
      const angle = Math.random() * Math.PI * 2;
      const lift = 0.25 + Math.random() * 0.75;
      this.directions[i * 3] = Math.cos(angle);
      this.directions[i * 3 + 1] = lift;
      this.directions[i * 3 + 2] = Math.sin(angle);
      this.speeds[i] = 1.6 + Math.random() * 2.8;
    }

    this.moteGeometry = new THREE.BufferGeometry();
    this.moteGeometry.setAttribute('position', new THREE.BufferAttribute(this.basePositions, 3));

    this.moteMaterial = new THREE.PointsMaterial({
      map: this.texture,
      color: 0xf3ddc0,
      size: 0.34,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.motes = new THREE.Points(this.moteGeometry, this.moteMaterial);
    // The cloud grows past its initial bounds; skip culling rather than
    // recompute a bounding sphere every frame.
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  /** Places the effect at the point of contact. */
  setOrigin(x: number, y: number, z: number): void {
    this.group.position.set(x, y, z);
  }

  /**
   * @param progress 0 at the instant of impact, 1 once the dust has settled.
   */
  update(progress: number): void {
    if (progress <= 0 || progress >= 1) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // Ring: snaps outward fast, then fades. easeOutQuart on the radius reads as
    // a pressure wave rather than a growing circle.
    const ringT = Math.min(1, progress / 0.55);
    const ringScale = 0.6 + 3.4 * (1 - Math.pow(1 - ringT, 4));
    this.ring.scale.setScalar(ringScale);
    this.ringMaterial.opacity = 0.55 * Math.pow(1 - ringT, 1.8);

    // Motes: outward with gravity dragging the vertical component back down.
    const positions = this.moteGeometry.getAttribute('position') as THREE.BufferAttribute;
    const t = progress * 0.85;
    for (let i = 0; i < ImpactBurst.MOTE_COUNT; i++) {
      const speed = this.speeds[i];
      // Drag: motes lose lateral speed quickly, as dust in air does.
      const spread = (1 - Math.exp(-3.2 * t)) * speed;
      positions.setXYZ(
        i,
        this.directions[i * 3] * spread,
        Math.max(0.02, this.directions[i * 3 + 1] * spread * 0.55 - 4.2 * t * t),
        this.directions[i * 3 + 2] * spread,
      );
    }
    positions.needsUpdate = true;

    this.moteMaterial.opacity = 0.85 * Math.pow(1 - progress, 1.5);
    this.moteMaterial.size = 0.34 + progress * 0.5;
  }

  dispose(): void {
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.moteGeometry.dispose();
    this.moteMaterial.dispose();
    this.texture.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}

/** Soft radial dot used as the dust sprite. */
function createMoteTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
