import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReadablePortfolio } from './readable-portfolio';
import { IDENTITY, PANELS } from '../../../../core/content/portfolio.content';

/**
 * Guards the one bug that cost more than any rendering fault in this project:
 * the server-rendered page containing a name, a role, and the word "Preparing".
 *
 * Every panel used to enter the DOM only when a visitor walked a character to a
 * beacon and pressed a key, so search engines, link previews and anyone with
 * JavaScript off saw an empty page — for a portfolio, invisible in exactly the
 * places someone goes looking. These assertions are what notices if the content
 * ever retreats behind an interaction again.
 */
describe('ReadablePortfolio', () => {
  let fixture: ComponentFixture<ReadablePortfolio>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ReadablePortfolio] }).compileComponents();
    fixture = TestBed.createComponent(ReadablePortfolio);
    fixture.detectChanges();
  });

  function text(): string {
    return fixture.nativeElement.textContent as string;
  }

  it('renders the identity', () => {
    expect(text()).toContain(IDENTITY.name);
    expect(text()).toContain(IDENTITY.role);
    expect(text()).toContain(IDENTITY.tagline);
  });

  it('renders every location panel, not only the open one', () => {
    for (const id of ['about', 'projects', 'skills', 'contact'] as const) {
      expect(text())
        .withContext(`the "${id}" panel title`)
        .toContain(PANELS[id].title);
    }
  });

  it('renders the body copy of every panel', () => {
    for (const id of ['about', 'projects', 'skills', 'contact'] as const) {
      for (const paragraph of PANELS[id].body) {
        // Copy is authored as indented template literals; compare on a
        // distinctive fragment rather than fighting the whitespace.
        const fragment = paragraph.trim().split(/\s+/).slice(0, 6).join(' ');
        expect(text().replace(/\s+/g, ' '))
          .withContext(`body copy of "${id}"`)
          .toContain(fragment);
      }
    }
  });

  it('renders the items inside each panel', () => {
    for (const id of ['about', 'projects', 'skills'] as const) {
      for (const item of PANELS[id].items ?? []) {
        expect(text()).withContext(`item "${item.title}"`).toContain(item.title);
      }
    }
  });

  it('renders contact links as real anchors', () => {
    const hrefs = [...fixture.nativeElement.querySelectorAll('a')].map((a: HTMLAnchorElement) =>
      a.getAttribute('href'),
    );
    for (const link of PANELS.contact.links ?? []) {
      expect(hrefs).withContext(`link to ${link.label}`).toContain(link.href);
    }
  });

  it('gives external links a safe rel', () => {
    const external = [...fixture.nativeElement.querySelectorAll('a')].filter(
      (a: HTMLAnchorElement) => /^https?:/i.test(a.getAttribute('href') ?? ''),
    );
    expect(external.length).toBeGreaterThan(0);
    for (const a of external as HTMLAnchorElement[]) {
      expect(a.getAttribute('rel')).withContext(a.getAttribute('href') ?? '').toContain('noopener');
    }
  });

  it('uses a heading structure rather than styled divs', () => {
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('h2').length).toBe(4);
  });

  /**
   * Hidden, but not from assistive technology. `display: none` and
   * `visibility: hidden` both remove an element from the accessibility tree,
   * which would defeat half the reason this exists.
   */
  it('hides itself off-screen rather than removing it from the page', () => {
    const wrapper = fixture.nativeElement.querySelector('.offscreen') as HTMLElement;
    expect(wrapper).withContext('the hidden wrapper').toBeTruthy();

    const style = getComputedStyle(wrapper);
    expect(style.display).not.toBe('none');
    expect(style.visibility).not.toBe('hidden');
  });

  it('becomes the page when told it is standalone', () => {
    fixture.componentRef.setInput('standalone', true);
    fixture.componentRef.setInput('reason', 'No WebGL here.');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.offscreen')).toBeNull();
    expect(fixture.nativeElement.querySelector('.page')).toBeTruthy();
    expect(text()).toContain('No WebGL here.');
    // The content is the same content, not a reduced version of it.
    expect(text()).toContain(PANELS.contact.title);
  });
});
