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
