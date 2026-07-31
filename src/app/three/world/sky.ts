import * as THREE from 'three';

/**
 * Sunset sky dome and distance fog.
 *
 * Driven by view direction rather than raw world position. An earlier revision
 * offset the position by a scalar before normalising, which meant a level view
 * sampled the gradient at h≈0.18 — a 40% blend of horizon orange and zenith
 * blue, i.e. a muddy grey by construction, which tone mapping then lifted to
 * near-white. Sampling direction directly makes the horizon band land where the
 * horizon actually is.
 *
 * Four zones, bottom to top: water, a hot band right at the horizon, the
 * horizon colour proper, then the zenith.
 */
export function createSky(): { mesh: THREE.Mesh; fog: THREE.FogExp2 } {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    // The dome is unlit and must not be dimmed by the scene fog.
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x123a6b) },
      uHorizon: { value: new THREE.Color(0xff7a2f) },
      uGlow: { value: new THREE.Color(0xffd08a) },
      uWater: { value: new THREE.Color(0x16344a) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      uniform vec3 uWater;
      varying vec3 vWorldPosition;

      void main() {
        // Height of this pixel's direction, -1 (straight down) to 1 (straight up).
        float h = normalize(vWorldPosition).y;

        // Orange holds well above the horizon before giving way to blue.
        float up = smoothstep(-0.02, 0.62, h);
        vec3 col = mix(uHorizon, uZenith, pow(up, 0.85));

        // Hot band hugging the horizon line, falling off fast.
        float glow = pow(1.0 - clamp(abs(h) / 0.3, 0.0, 1.0), 2.0);
        col = mix(col, uGlow, glow * 0.5);

        // Below the horizon, roll into deep water.
        col = mix(uWater, col, smoothstep(-0.22, -0.01, h));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), material);
  mesh.name = 'sky';
  // Always behind everything; skipping culling avoids a pop when the camera
  // pitches steeply during the dive.
  mesh.frustumCulled = false;

  return { mesh, fog: new THREE.FogExp2(0xe0a878, 0.0075) };
}
