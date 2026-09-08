import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { IDENTITY, PANELS } from '../../../../core/content/portfolio.content';
import type { PanelId } from '../../../../core/models/experience.model';

/**
 * The portfolio as a plain document.
 *
 * This is always in the DOM, and it exists because the 3D experience is a
 * presentation of the work, not the work itself. Before it, the server-rendered
 * page contained three pieces of text — a name, a role, and the word
 * "Preparing" — because every panel only entered the DOM when a visitor walked
 * a character to a beacon and pressed a key. A search engine, a link preview, a
 * language model, or anyone with JavaScript off saw an empty page. For a
 * portfolio that is the most expensive bug available: it is invisible in exactly
 * the places someone looks for you.
 *
 * So the same content is rendered once, semantically, from the same source the
 * panels read. Two audiences, two states:
 *
 *   The scene works — visually hidden, but present and readable. Screen readers
 *   get a linear document instead of being asked to drive a character through a
 *   city, which is not a reasonable thing to ask of anyone.
 *
 *   No WebGL — shown as the page. A locked-down laptop or a blocklisted driver
 *   still gets the whole portfolio, properly typeset, rather than a loading
 *   screen that never finishes.
 *
 * It is never a duplicate written by hand: it reads `PANELS`, so it cannot drift
 * from what the panels say.
 */
@Component({
  selector: 'app-readable-portfolio',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  templateUrl: './readable-portfolio.html',
  styleUrl: './readable-portfolio.css',
})
export class ReadablePortfolio {
  /** True when this is the page rather than the hidden layer behind the scene. */
  readonly standalone = input(false);
  /** Explains why the 3D scene is absent. Only set when WebGL is unavailable. */
  readonly reason = input<string | null>(null);

  protected readonly identity = IDENTITY;
  /** Ordered for reading, which is not the order the beacons sit in the world. */
  protected readonly order: PanelId[] = ['about', 'projects', 'skills', 'contact'];
  protected readonly panels = PANELS;

  protected isExternal(href: string): boolean {
    return /^https?:/i.test(href);
  }
}
