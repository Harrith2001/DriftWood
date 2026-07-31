/**
 * Final-pass grade: subtle chromatic aberration toward the edges, saturation and
 * contrast lift, and a vignette. Deliberately restrained — the goal is film
 * warmth, not an Instagram filter.
 */
export const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.14 },
    uContrast: { value: 1.05 },
    uVignette: { value: 0.42 },
    uAberration: { value: 0.0014 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;

    void main() {
      vec2 offset = vUv - 0.5;
      float dist = length(offset);

      // Split the channels radially; the effect scales with distance from centre
      // so the middle of frame stays clean.
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + offset * uAberration * dist).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - offset * uAberration * dist).b;

      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col *= 1.0 - uVignette * dist * dist * 1.6;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
