import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { ExperienceStateService } from '../../core/services/experience-state.service';
import { DeviceService } from '../../core/services/device.service';
import { HOTSPOTS } from '../../core/world/world.config';
import type { PanelId } from '../../core/models/experience.model';
import { OceanWorld } from '../../three/ocean-world';
import { LoaderOverlay } from './ui/loader-overlay/loader-overlay';
import { IntroOverlay } from './ui/intro-overlay/intro-overlay';
import { Hud } from './ui/hud/hud';
import { ContentPanel } from './ui/content-panel/content-panel';
import { TouchControls } from './ui/touch-controls/touch-controls';
import { ReadablePortfolio } from './ui/readable-portfolio/readable-portfolio';

/**
 * The experience shell.
 *
 * Owns the canvas and the `OceanWorld` instance, adapts the world's callbacks
 * onto signals, and decides which overlay is on screen. All Three.js work runs
 * outside the Angular zone so the 60 fps render loop never schedules change
 * detection; UI updates come from explicit signal writes instead.
 */
@Component({
  selector: 'app-experience',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoaderOverlay, IntroOverlay, Hud, ContentPanel, TouchControls, ReadablePortfolio],
  templateUrl: './experience.html',
  styleUrl: './experience.css',
})
export class Experience implements AfterViewInit, OnDestroy {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private readonly zone = inject(NgZone);
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly state = inject(ExperienceStateService);
  private readonly device = inject(DeviceService);

  private world: OceanWorld | null = null;
  /** Timers for the pickup toast and the reward panel. Cleared on teardown. */
  private capToastTimer: ReturnType<typeof setTimeout> | undefined;
  private rewardTimer: ReturnType<typeof setTimeout> | undefined;

  /** Drives the loader fade-out; kept separate from `phase` so it can lag it. */
  protected readonly loaderDismissed = signal(false);
  protected readonly introLeaving = signal(false);
  protected readonly isTouch = signal(false);
  /**
   * No WebGL, so no scene. Set before anything is built rather than discovered
   * when the renderer throws — that failure happens inside an async boot and
   * would otherwise leave the loader spinning forever with nothing to say.
   */
  protected readonly noWebgl = signal(false);

  protected readonly showIntro = computed(
    () => this.state.phase() === 'intro' || this.state.phase() === 'arrival',
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngAfterViewInit(): void {
    if (!this.isBrowser) return; // SSR renders the markup only; no WebGL.

    // Ask before building. Without this the failure surfaces as a throw from
    // deep inside an async boot, which is an unhandled rejection nobody sees —
    // the loader simply never finishes and the visitor is left on a progress
    // bar that will not move.
    if (!this.device.supportsWebGL) {
      this.showReadablePage();
      return;
    }

    this.isTouch.set(this.device.isTouch);
    this.zone.runOutsideAngular(() => void this.boot());
  }

  private async boot(): Promise<void> {
    try {
      await this.buildWorld();
    } catch (error) {
      // A context that probes fine can still be refused when the real renderer
      // asks for it — a GPU reset, another tab exhausting the context budget.
      // Falling back to the document is a better answer than a dead loader.
      this.zone.run(() => this.showReadablePage());
      console.error('The 3D scene could not start; showing the readable page.', error);
    }
  }

  /**
   * Hands the viewport back to the document.
   *
   * The body is `overflow: hidden` because the scene owns the whole viewport and
   * a stray scroll would drag the fixed canvas around on mobile. With no scene
   * there is nothing to protect, and a portfolio that cannot be scrolled shows
   * one screen of itself.
   */
  private showReadablePage(): void {
    this.noWebgl.set(true);
    this.world?.dispose();
    this.world = null;
    this.doc.body.style.overflow = 'auto';
  }

  private async buildWorld(): Promise<void> {
    const world = new OceanWorld(
      this.canvasRef().nativeElement,
      this.device.quality,
      {
        // Every callback re-enters the zone: these mutate signals the UI reads.
        onLoadProgress: (p) => this.zone.run(() => this.state.setLoadProgress(p)),
        onLoadError: (message) => this.zone.run(() => this.state.setLoadError(message)),
        onReady: () => this.zone.run(() => this.onReady()),
        onLanded: () => this.zone.run(() => this.onLanded()),
        onNearbyHotspotChange: (id) => this.zone.run(() => this.state.setNearbyHotspot(id)),
        onInteract: () => this.zone.run(() => this.state.openNearby()),
        onCapCollected: (id, label) => this.zone.run(() => this.onCapCollected(id, label)),
      },
      this.device.prefersReducedMotion,
      this.state.caps(),
    );

    this.world = world;
    await world.init();
  }

  private onReady(): void {
    this.state.setPhase('intro');
    this.loaderDismissed.set(true);
    // The page itself never scrolls — the scene is the whole viewport, and a
    // stray scroll would otherwise drag the fixed canvas around on mobile.
    this.doc.body.style.overflow = 'hidden';
  }

  private onLanded(): void {
    this.state.setPhase('explore');
    this.introLeaving.set(true);
  }

  ngOnDestroy(): void {
    clearTimeout(this.capToastTimer);
    clearTimeout(this.rewardTimer);
    this.world?.dispose();
    this.world = null;
    // Always hand scrolling back, even if the component is torn down mid-fall.
    if (this.isBrowser) this.doc.body.style.overflow = '';
  }

  // ── Global input ───────────────────────────────────────────────────────────

  /**
   * Any of these begins the arrival while the title card is up.
   *
   * Nothing is cancelled here. Angular registers `window:touchstart` as a
   * passive listener, so `preventDefault()` never had any effect beyond logging
   * "Unable to preventDefault inside passive event listener" on every touch —
   * and it was not needed: the body is `overflow: hidden`, so there is no page
   * scroll to suppress. Cancelling would also have taken the synthesised click
   * with it, which is what the "skip the arrival" button underneath depends on.
   */
  @HostListener('window:wheel')
  @HostListener('window:touchstart')
  protected onFirstGesture(): void {
    if (this.state.phase() !== 'intro') return;
    this.beginArrival();
  }

  @HostListener('window:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    // Escape closes an open panel, wherever focus happens to be.
    if (event.key === 'Escape' && this.state.openPanel()) {
      this.closePanel();
      return;
    }
    if (this.state.phase() !== 'intro') return;
    if (['ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key)) {
      event.preventDefault();
      this.beginArrival();
    }
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.world?.resize();
  }

  // ── UI actions ─────────────────────────────────────────────────────────────

  protected beginArrival(): void {
    if (this.state.phase() !== 'intro') return;
    this.state.setPhase('arrival');
    this.introLeaving.set(true);
    this.world?.startArrival();
  }

  /** Jumps straight to exploration, skipping the arrival choreography. */
  protected skipArrival(): void {
    this.introLeaving.set(true);
    this.world?.skipArrival();
  }

  protected openPanel(id: PanelId): void {
    this.state.openPanelById(id);
    this.syncWorldInteraction();
  }

  protected closePanel(): void {
    this.state.closePanel();
    this.syncWorldInteraction();
  }

  /** Walks the character to a hotspot chosen from the HUD list. */
  protected jumpTo(id: PanelId): void {
    const spot = HOTSPOTS.find((h) => h.id === id);
    if (spot) this.world?.teleportToHotspot(spot.x, spot.z, spot.y);
    this.openPanel(id);
  }

  protected requestInteract(): void {
    this.world?.requestInteract();
  }

  protected requestJump(): void {
    this.world?.requestJump();
  }

  /**
   * Records a cap, shows the pickup toast, and opens the reward once the last
   * one is in.
   *
   * The reward waits a beat. Finishing the hunt and having a full-screen panel
   * appear in the same frame reads as an interruption rather than a payoff —
   * the short delay lets the collection flourish land first.
   */
  private onCapCollected(id: string, label: string): void {
    const { completed } = this.state.collectCap(id, label);

    clearTimeout(this.capToastTimer);
    this.capToastTimer = setTimeout(() => this.zone.run(() => this.state.clearLastCap()), 2600);

    if (!completed) return;
    clearTimeout(this.rewardTimer);
    // Through openPanel, not the state directly, so movement is suspended the
    // same way it is for every other panel.
    this.rewardTimer = setTimeout(() => this.zone.run(() => this.openPanel('colophon')), 1400);
  }

  protected onTouchAxes(axes: { forward: number; turn: number }): void {
    this.world?.setTouchAxes(axes.forward, axes.turn);
  }

  protected retryLoad(): void {
    // A hard reload is the honest way to retry: the GPU context, the partially
    // populated scene graph and the loader state all need to start clean.
    this.doc.defaultView?.location.reload();
  }

  /** Keeps the world's input/beacon state in step with the UI. */
  private syncWorldInteraction(): void {
    this.world?.setMovementEnabled(this.state.movementEnabled());
    this.world?.setDiscovered(this.state.discovered());
  }
}
