import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CinematicShader } from './shaders/cinematic.shader';
import type { QualitySettings } from '../../core/models/experience.model';

/**
 * Renderer and post-processing chain.
 *
 * On the low tier the composer is skipped entirely and the renderer draws
 * straight to the canvas, which saves two full-screen passes on the devices
 * least able to afford them.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly quality: QualitySettings,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.tier !== 'low',
      powerPreference: 'high-performance',
      // Holding the back buffer between frames costs fill rate on some GPUs and
      // nothing in the running experience reads the canvas back.
      preserveDrawingBuffer: false,
    });

    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = quality.shadows;
    // PCFSoft is deprecated in current Three and silently downgrades to PCF —
    // ask for what actually gets used rather than eating a warning every load.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // ACES desaturates as it approaches white, so the exposure stays near 1 —
    // pushing it higher was bleaching the sunset into cream.
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    if (quality.postProcessing) this.buildComposer();
  }

  private buildComposer(): void {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));

    // Threshold sits high on purpose: only genuinely bright pixels (sun, sky
    // near the horizon) bloom. Character highlights must never trigger it.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.16,
      0.5,
      0.95,
    );
    composer.addPass(bloom);

    // Order matters. OutputPass performs tone mapping and the linear→sRGB
    // conversion, so everything before it is working in linear HDR. The grade
    // below pivots contrast around 0.5 and mixes toward luma — operations that
    // only mean anything on display-referred values. Running it before the
    // OutputPass (as an earlier revision did) lifted the blacks and drained the
    // saturation, turning the sunset into flat grey.
    composer.addPass(new OutputPass());
    const grade = new ShaderPass(CinematicShader);
    composer.addPass(grade);

    this.composer = composer;
    this.disposables.push(bloom, grade, composer);
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
  }

  dispose(): void {
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // Composer passes are inconsistent about implementing dispose(); a
        // failure here must not prevent the renderer itself being released.
      }
    }
    this.disposables.length = 0;
    this.composer = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
