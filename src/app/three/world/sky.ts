import * as THREE from 'three';

/**
 * Dusk sky dome and the coastal haze that hangs over Lima at that hour.
 *
 * Driven by view direction rather than raw world position. An earlier revision
 * offset the position by a scalar before normalising, which meant a level view
 * sampled the gradient at h≈0.18 — a 40% blend of horizon and zenith, i.e. a
 * muddy grey by construction, which tone mapping then lifted to near-white.
 * Sampling direction directly makes the horizon band land where the horizon
 * actually is.
 *
 * Dusk, not night. The model's textures are baked with daylight in them, so a
 * true night sky leaves every facade reading as flat grey mud; blue hour keeps
 * them legible while still being dark enough for the sodium street lamps — the
 * model's own `emitYELL` and `emiWHITE` materials — to carry the bloom pass.
 *
 * Four zones, bottom to top: the haze the streets sit in, a warm band at the
 * horizon where the sun has just gone, the horizon colour proper, then the
 * zenith.
 */
export function createSky(): { mesh: THREE.Mesh; fog: THREE.FogExp2 } {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    // The dome is unlit and must not be dimmed by the scene fog.
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x141c33) },
      uHorizon: { value: new THREE.Color(0x8a5a58) },
      uGlow: { value: new THREE.Color(0xd98f5e) },
      uHaze: { value: new THREE.Color(0x3a3542) },
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
      uniform vec3 uHaze;
      varying vec3 vWorldPosition;

      void main() {
        // Height of this pixel's direction, -1 (straight down) to 1 (straight up).
        float h = normalize(vWorldPosition).y;

        // The warm band gives way to night quickly — the sun is already down.
        float up = smoothstep(-0.04, 0.48, h);
        vec3 col = mix(uHorizon, uZenith, pow(up, 0.7));

        // Last of the light, hugging the horizon line.
        float glow = pow(1.0 - clamp(abs(h) / 0.22, 0.0, 1.0), 2.0);
        col = mix(col, uGlow, glow * 0.45);

        // Below the horizon, roll into the haze the far streets disappear into.
        col = mix(uHaze, col, smoothstep(-0.18, -0.01, h));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), material);
  mesh.name = 'sky';
  // Always behind everything; skipping culling avoids a pop when the camera
  // pitches steeply during the dive.
  mesh.frustumCulled = false;

  // Lima's garúa. Tuned so the street the visitor is standing in stays clear
  // while the far end of the model — 200 metres off, and never dressed to be
  // looked at closely — dissolves before its edge can be seen.
  return { mesh, fog: new THREE.FogExp2(0x3a3542, 0.011) };
}
