import * as THREE from 'three';
import type { QualitySettings } from '../../core/models/experience.model';

/**
 * Blue-hour street rig: a low warm key where the sun has just set, a cool fill
 * from the opposite side standing in for the open sky, and a hemisphere that
 * puts cold light from above and sodium bounce from the roadway below.
 *
 * Kept brighter than a literal dusk would be. The model's textures are baked
 * with daylight in them and have no normal or roughness maps at all, so lighting
 * it as darkly as the sky implies flattens every facade into the same grey.
 */
export interface Lighting {
  readonly group: THREE.Group;
  /**
   * Moves the shadow frustum to wherever the character is.
   *
   * A directional light's shadow camera is orthographic and finite. Sized to
   * cover the whole neighbourhood — 150 metres across and 52 of climb — its
   * texels would be so coarse that every shadow turned to mush, so it is kept
   * tight and carried along instead. Left fixed at the origin, shadows simply
   * stopped a few strides from the plaza.
   */
  follow(x: number, y: number, z: number): void;
}

export function createLighting(quality: QualitySettings): Lighting {
  const group = new THREE.Group();
  group.name = 'lighting';

  group.add(new THREE.AmbientLight(0xd6cddc, 1.7));

  const sun = new THREE.DirectionalLight(0xffc48c, 3.1);
  // To the west and high enough to reach the roadway. Raking it along the street
  // at a true dusk angle looked right on the facades and left the road itself
  // unlit, which is the half of the frame the visitor is actually standing in.
  //
  // Offset from the light's target rather than an absolute position, so the
  // whole rig can be carried along with the character below.
  const SUN_OFFSET = new THREE.Vector3(-30, 24, 14);
  sun.position.copy(SUN_OFFSET);
  group.add(sun.target);

  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    // Only wide enough to cover what is on screen. The neighbourhood is 150
    // metres across; a frustum that spanned it would spread the same shadow map
    // over thirty times the area and turn every edge to mush, so it stays tight
    // and travels instead.
    const extent = 30;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 110;
    // Pulls the shadow slightly off the caster to avoid acne on the roadway.
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
  }
  group.add(sun);

  // Cool counter-fill so the shadow side keeps some shape instead of going flat.
  // Kept well below the key: three cool sources against one warm one turned the
  // whole street into a blue wash and buried the textures.
  const fill = new THREE.DirectionalLight(0x8fa6de, 0.5);
  fill.position.set(18, 12, -14);
  group.add(fill);

  // Sky above, warm sodium bounce off the tarmac below.
  group.add(new THREE.HemisphereLight(0x7b88b8, 0x6d5340, 1.0));

  return {
    group,
    follow(x, y, z) {
      sun.target.position.set(x, y, z);
      sun.position.set(x + SUN_OFFSET.x, y + SUN_OFFSET.y, z + SUN_OFFSET.z);
      // The target is a plain Object3D the light reads through its world matrix,
      // and nothing else in the scene graph will refresh it — it has no geometry
      // to render. Without this the shadow frustum keeps aiming at the origin.
      sun.target.updateMatrixWorld(true);
    },
  };
}
