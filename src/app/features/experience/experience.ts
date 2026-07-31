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
  imports: [LoaderOverlay, IntroOverlay, Hud, ContentPanel, TouchControls],
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

  /** Drives the loader fade-out; kept separate from `phase` so it can lag it. */
  protected readonly loaderDismissed = signal(false);
  protected readonly introLeaving = signal(false);
  protected readonly isTouch = signal(false);

  protected readonly showIntro = computed(
    () => this.state.phase() === 'intro' || this.state.phase() === 'arrival',
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngAfterViewInit(): void {
    if (!this.isBrowser) return; // SSR renders the markup only; no WebGL.

    this.isTouch.set(this.device.isTouch);
    this.zone.runOutsideAngular(() => void this.boot());
  }

  private async boot(): Promise<void> {
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
      },
      this.device.prefersReducedMotion,
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
    this.world?.dispose();
    this.world = null;
    // Always hand scrolling back, even if the component is torn down mid-fall.
    if (this.isBrowser) this.doc.body.style.overflow = '';
  }

  // ── Global input ───────────────────────────────────────────────────────────

  /** Any of these begins the arrival while the title card is up. */
  @HostListener('window:wheel', ['$event'])
  @HostListener('window:touchstart', ['$event'])
  protected onFirstGesture(event: Event): void {
    if (this.state.phase() !== 'intro') return;
    event.preventDefault();
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
    if (spot) this.world?.teleportToHotspot(spot.x, spot.z);
    this.openPanel(id);
  }

  protected requestInteract(): void {
    this.world?.requestInteract();
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
