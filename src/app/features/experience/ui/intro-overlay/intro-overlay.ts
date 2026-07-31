import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IDENTITY } from '../../../../core/content/portfolio.content';

/**
 * The title card, laid over the close-up portrait.
 *
 * Any input begins the arrival, so the prompt is phrased as an invitation
 * rather than an instruction. A skip link is offered for visitors who would
 * rather not sit through eight seconds of choreography.
 */
@Component({
  selector: 'app-intro-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './intro-overlay.html',
  styleUrl: './intro-overlay.css',
})
export class IntroOverlay {
  readonly leaving = input(false);
  readonly begin = output<void>();
  readonly skip = output<void>();

  protected readonly identity = IDENTITY;
}
