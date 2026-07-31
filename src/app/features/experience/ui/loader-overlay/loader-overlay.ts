import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Load screen. Shows real progress (aggregated across all five assets) and, if
 * something fails, says so plainly with a retry rather than spinning forever.
 */
@Component({
  selector: 'app-loader-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './loader-overlay.html',
  styleUrl: './loader-overlay.css',
})
export class LoaderOverlay {
  /** 0..1 */
  readonly progress = input.required<number>();
  readonly error = input<string | null>(null);
  /** Fades the overlay out without removing it, so the transition can play. */
  readonly dismissed = input(false);

  readonly retry = output<void>();

  percent(): number {
    return Math.round(this.progress() * 100);
  }
}
