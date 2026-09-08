import { Injectable, inject } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import type { QualitySettings, QualityTier } from '../models/experience.model';

/**
 * Capability probing. Decides how expensive the scene is allowed to be before
 * anything is built, so a phone is not asked to render the desktop settings.
 */
@Injectable({ providedIn: 'root' })
export class DeviceService {
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Coarse pointer and no hover — treat as a touch device. */
  get isTouch(): boolean {
    if (!this.isBrowser) return false;
    return this.doc.defaultView?.matchMedia('(hover: none) and (pointer: coarse)').matches ?? false;
  }

  /**
   * Whether this browser can give us a WebGL context at all.
   *
   * Worth asking before building anything. A locked-down work laptop, a driver
   * on the browser's blocklist or a machine with hardware acceleration switched
   * off will refuse the context, and `new WebGLRenderer()` throws — which, from
   * inside an async boot, is an unhandled rejection that leaves the loader
   * spinning on "Preparing the streets" with no error and no way forward.
   *
   * The probe canvas is thrown away immediately; the real one is created later
   * with its own options.
   */
  get supportsWebGL(): boolean {
    if (!this.isBrowser) return false;
    try {
      const canvas = this.doc.createElement('canvas');
      const gl =
        canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl');
      // Release the probe context rather than waiting for the GC: browsers cap
      // how many live contexts a page may hold, and the scene needs one.
      (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
      return gl !== null;
    } catch {
      return false;
    }
  }

  /** Honoured by suppressing the autoplayed arrival and all idle drift. */
  get prefersReducedMotion(): boolean {
    if (!this.isBrowser) return false;
    return this.doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  /**
   * Rough tier from core count, memory and viewport. Deliberately pessimistic:
   * a mislabelled high-end phone costs a visitor their frame rate, whereas a
   * mislabelled desktop only costs some cloud sprites.
   */
  get tier(): QualityTier {
    if (!this.isBrowser) return 'medium';
    const win = this.doc.defaultView;
    const cores = navigator.hardwareConcurrency ?? 4;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const dpr = win?.devicePixelRatio ?? 1;

    if (this.isTouch || cores <= 4 || memory <= 2) return 'low';
    if (cores >= 8 && dpr <= 2) return 'high';
    return 'medium';
  }

  get quality(): QualitySettings {
    const tier = this.tier;
    const dpr = this.doc.defaultView?.devicePixelRatio ?? 1;

    switch (tier) {
      case 'low':
        return {
          tier,
          pixelRatio: Math.min(dpr, 1.5),
          shadows: false,
          shadowMapSize: 512,
          cloudCount: 22,
          postProcessing: false,
        };
      case 'medium':
        return {
          tier,
          pixelRatio: Math.min(dpr, 1.75),
          shadows: true,
          shadowMapSize: 1024,
          cloudCount: 36,
          postProcessing: true,
        };
      case 'high':
        return {
          tier,
          pixelRatio: Math.min(dpr, 2),
          shadows: true,
          shadowMapSize: 2048,
          cloudCount: 50,
          postProcessing: true,
        };
    }
  }
}
