import { Injectable, computed, signal } from '@angular/core';
import type { PanelId, Phase } from '../models/experience.model';
import { HOTSPOTS } from '../world/world.config';
import { COLLECTIBLES } from '../world/collectibles.config';

/**
 * The single source of truth shared between the Three.js layer and the Angular
 * UI. The scene writes into it; templates read from it.
 *
 * Kept deliberately small — anything the DOM does not need to react to (camera
 * vectors, mixer weights, per-frame values) stays inside the scene classes.
 */
@Injectable({ providedIn: 'root' })
export class ExperienceStateService {
  // ── Load ───────────────────────────────────────────────────────────────────
  private readonly _phase = signal<Phase>('loading');
  private readonly _loadProgress = signal(0);
  private readonly _loadError = signal<string | null>(null);

  readonly phase = this._phase.asReadonly();
  readonly loadProgress = this._loadProgress.asReadonly();
  readonly loadError = this._loadError.asReadonly();

  // ── Exploration ────────────────────────────────────────────────────────────
  /** Hotspot the character is currently standing in range of, if any. */
  private readonly _nearbyHotspot = signal<PanelId | null>(null);
  /** Panel currently open as a full overlay. */
  private readonly _openPanel = signal<PanelId | null>(null);
  /** Hotspots the visitor has opened at least once. */
  private readonly _discovered = signal<ReadonlySet<PanelId>>(new Set());

  readonly nearbyHotspot = this._nearbyHotspot.asReadonly();
  readonly openPanel = this._openPanel.asReadonly();
  readonly discovered = this._discovered.asReadonly();

  /**
   * Counts locations only. The colophon is a panel but not a place — it has no
   * beacon, cannot be walked to, and counting it would push the tally past the
   * four the HUD advertises.
   */
  readonly discoveredCount = computed(
    () => HOTSPOTS.filter((spot) => this._discovered().has(spot.id)).length,
  );
  readonly totalHotspots = HOTSPOTS.length;
  readonly allDiscovered = computed(() => this.discoveredCount() === this.totalHotspots);

  // ── Scavenger hunt ─────────────────────────────────────────────────────────
  private readonly _caps = signal<ReadonlySet<string>>(new Set());

  readonly caps = this._caps.asReadonly();
  readonly capsFound = computed(() => this._caps().size);
  readonly totalCaps = COLLECTIBLES.length;
  readonly allCapsFound = computed(() => this.capsFound() === this.totalCaps);
  /** Label of the cap just taken, for the pickup toast. Cleared on a timer. */
  private readonly _lastCap = signal<string | null>(null);
  readonly lastCap = this._lastCap.asReadonly();

  /** True once the visitor is in control — gates the HUD and input handling. */
  readonly isExploring = computed(() => this._phase() === 'explore');
  /** Movement is suspended while a panel is open so keys drive the dialog. */
  readonly movementEnabled = computed(() => this.isExploring() && this._openPanel() === null);

  // ── Mutations ──────────────────────────────────────────────────────────────

  setPhase(phase: Phase): void {
    this._phase.set(phase);
  }

  setLoadProgress(fraction01: number): void {
    // Never let the bar travel backwards; concurrent loaders report unevenly.
    this._loadProgress.update((prev) => Math.max(prev, Math.min(1, Math.max(0, fraction01))));
  }

  setLoadError(message: string): void {
    this._loadError.set(message);
  }

  setNearbyHotspot(id: PanelId | null): void {
    if (this._nearbyHotspot() !== id) this._nearbyHotspot.set(id);
  }

  openPanelById(id: PanelId): void {
    this._openPanel.set(id);
    this._discovered.update((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  closePanel(): void {
    this._openPanel.set(null);
  }

  /**
   * Records a cap and reports whether that completed the hunt.
   *
   * The caller decides what completion means; this only knows the count.
   */
  collectCap(id: string, label: string): { completed: boolean } {
    const before = this._caps();
    if (before.has(id)) return { completed: false };

    const next = new Set(before);
    next.add(id);
    this._caps.set(next);
    this._lastCap.set(label);

    return { completed: next.size === this.totalCaps };
  }

  clearLastCap(): void {
    this._lastCap.set(null);
  }

  /** Opens the hotspot in range, if there is one. Returns whether it acted. */
  openNearby(): boolean {
    const id = this._nearbyHotspot();
    if (!id || this._openPanel() !== null) return false;
    this.openPanelById(id);
    return true;
  }
}
