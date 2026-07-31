import * as THREE from 'three';
import type { QualitySettings } from '../../core/models/experience.model';

/**
 * Late-afternoon sunset rig: a warm low sun, a cool bounce from the opposite
 * side to keep shadow detail readable, and a sky/sand hemisphere fill.
 */
export function createLighting(quality: QualitySettings): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighting';

  group.add(new THREE.AmbientLight(0xfff4e6, 1.15));

  const sun = new THREE.DirectionalLight(0xffc27a, 3.4);
  sun.position.set(20, 26, 12);

  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    // The frustum only needs to cover the island, not the sky column the
    // character falls through — a tighter box means sharper shadows per texel.
    const extent = 16;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    // Pulls the shadow slightly off the caster to avoid acne on the sand.
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
  }
  group.add(sun);

  const bounce = new THREE.DirectionalLight(0x9dc4ff, 0.75);
  bounce.position.set(-12, 9, -8);
  group.add(bounce);

  group.add(new THREE.HemisphereLight(0x7fb5d6, 0xd9a877, 0.85));

  return group;
}
