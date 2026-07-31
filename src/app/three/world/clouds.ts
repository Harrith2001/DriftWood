import * as THREE from 'three';
import { LANDING, SKY_Y } from '../../core/world/world.config';

/**
 * Soft cumulus field built from camera-facing sprites.
 *
 * A procedurally painted puff texture reads as volumetric at a fraction of the
 * cost of real volumetrics, and sprites always face the camera, so the field
 * holds up while the camera swings through it during the dive.
 */
export class CloudField {
  readonly group = new THREE.Group();
  private readonly texture: THREE.Texture;
  private readonly material: THREE.SpriteMaterial;

  constructor(count: number) {
    this.group.name = 'clouds';
    this.texture = createPuffTexture();

    // One shared material keeps every cloud in a single draw call; per-sprite
    // opacity variation is baked into the scale/position spread instead.
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
      // Warm, so the field belongs to the sunset instead of sitting on top of it.
      color: new THREE.Color(0xffe4cf),
    });

    for (let i = 0; i < count; i++) this.group.add(this.createCloud());
  }

  private createCloud(): THREE.Sprite {
    const sprite = new THREE.Sprite(this.material.clone());
    const scale = 9 + Math.random() * 17;
    sprite.scale.set(scale * 1.5, scale, 1);

    // Fill the column the diver falls through, but keep a clear cylinder around
    // the fall path. Sprites are up to 26 units wide, so a radius smaller than
    // that still leaves one filling the frame behind the portrait and washing
    // the sunset out to a flat grey — hence the generous exclusion up high.
    // Lower down the gap narrows, so he brushes past clouds on the way in.
    const y = 8 + Math.random() * 36;
    const clearRadius = y > SKY_Y - 12 ? 30 : 7;
    let x = 0;
    let z = 0;
    do {
      x = (Math.random() - 0.5) * 80;
      z = (Math.random() - 0.5) * 80;
    } while (Math.hypot(x - LANDING.x, z - LANDING.z) < clearRadius);

    sprite.position.set(x, y, z);
    // Kept fairly translucent so the sunset reads through the field rather than
    // being flattened into a white haze.
    (sprite.material as THREE.SpriteMaterial).opacity = 0.32 + Math.random() * 0.3;
    sprite.userData['baseOpacity'] = (sprite.material as THREE.SpriteMaterial).opacity;
    sprite.userData['drift'] = 0.12 + Math.random() * 0.25;
    return sprite;
  }

  /** Slow lateral drift, wrapping at the edges of the field. */
  update(delta: number): void {
    for (const sprite of this.group.children) {
      sprite.position.x += (sprite.userData['drift'] as number) * delta;
      if (sprite.position.x > 42) sprite.position.x = -42;
    }
  }

  /** Fades the whole field out as the diver drops below the cloud deck. */
  setVisibility(fraction01: number): void {
    const k = THREE.MathUtils.clamp(fraction01, 0, 1);
    for (const sprite of this.group.children) {
      const mat = (sprite as THREE.Sprite).material as THREE.SpriteMaterial;
      mat.opacity = (sprite.userData['baseOpacity'] as number) * k;
      sprite.visible = mat.opacity > 0.01;
    }
  }

  dispose(): void {
    for (const sprite of this.group.children) {
      ((sprite as THREE.Sprite).material as THREE.SpriteMaterial).dispose();
    }
    this.material.dispose();
    this.texture.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}

/** Paints a flat-bottomed, billowing cumulus puff into a canvas texture. */
function createPuffTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const blob = (x: number, y: number, r: number, alpha: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.5})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  blob(128, 150, 74, 0.95);
  blob(86, 146, 56, 0.85);
  blob(172, 148, 60, 0.85);
  blob(116, 112, 52, 0.8);
  blob(154, 120, 48, 0.8);
  blob(128, 168, 64, 0.7);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
