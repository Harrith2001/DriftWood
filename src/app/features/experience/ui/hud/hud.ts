import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { HOTSPOTS } from '../../../../core/world/world.config';
import { PANELS } from '../../../../core/content/portfolio.content';
import type { PanelId } from '../../../../core/models/experience.model';

/**
 * Exploration HUD: an objective list, a proximity prompt, and control hints.
 *
 * The objective entries double as buttons. Walking to a beacon is the intended
 * route, but a visitor who cannot or would rather not drive a 3D character can
 * still reach every piece of content with the keyboard — the experience is the
 * presentation layer, never a gate on the information.
 */
@Component({
  selector: 'app-hud',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hud.html',
  styleUrl: './hud.css',
})
export class Hud {
  readonly nearby = input<PanelId | null>(null);
  readonly discovered = input<ReadonlySet<PanelId>>(new Set<PanelId>());
  readonly hidden = input(false);
  readonly touch = input(false);

  readonly interact = output<void>();
  readonly jumpTo = output<PanelId>();

  protected readonly hotspots = HOTSPOTS;

  protected readonly discoveredCount = computed(() => this.discovered().size);
  protected readonly allDiscovered = computed(() => this.discovered().size === HOTSPOTS.length);
  protected readonly nearbyTitle = computed(() => {
    const id = this.nearby();
    return id ? PANELS[id].title : null;
  });

  protected isDiscovered(id: PanelId): boolean {
    return this.discovered().has(id);
  }

  /** Hotspot accent as a CSS colour, for the objective dot. */
  protected dotColor(hex: number): string {
    return `#${hex.toString(16).padStart(6, '0')}`;
  }
}
