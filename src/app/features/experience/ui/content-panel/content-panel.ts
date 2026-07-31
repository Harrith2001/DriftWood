import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { HOTSPOTS } from '../../../../core/world/world.config';
import { PANELS } from '../../../../core/content/portfolio.content';
import type { PanelId } from '../../../../core/models/experience.model';

/**
 * The content overlay opened at a hotspot.
 *
 * A real modal dialog: labelled, focus-moved-on-open, Escape to dismiss, and
 * the underlying scene's input suspended by the parent while it is up. Content
 * comes from `portfolio.content.ts` so copy edits never touch a component.
 */
@Component({
  selector: 'app-content-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './content-panel.html',
  styleUrl: './content-panel.css',
})
export class ContentPanel {
  readonly panelId = input<PanelId | null>(null);
  readonly close = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  protected readonly panel = computed(() => {
    const id = this.panelId();
    return id ? PANELS[id] : null;
  });

  protected readonly accentColor = computed(() => {
    const id = this.panelId();
    const spot = HOTSPOTS.find((h) => h.id === id);
    return spot ? `#${spot.color.toString(16).padStart(6, '0')}` : '#5ecfff';
  });

  constructor() {
    // Move focus into the dialog on open so Escape and Tab behave, and so
    // screen readers announce the panel rather than leaving focus on the canvas.
    effect(() => {
      if (!this.panelId()) return;
      // Defer past the same tick that created the element.
      queueMicrotask(() => this.dialog()?.nativeElement.focus());
    });
  }

  protected isExternal(href: string): boolean {
    return /^https?:/i.test(href);
  }
}
