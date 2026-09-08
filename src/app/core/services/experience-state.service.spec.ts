import { TestBed } from '@angular/core/testing';
import { ExperienceStateService } from './experience-state.service';
import { COLLECTIBLES } from '../world/collectibles.config';
import { HOTSPOTS } from '../world/world.config';

const CAPS_KEY = 'driftwood.caps.v1';

describe('ExperienceStateService', () => {
  function service(): ExperienceStateService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(ExperienceStateService);
  }

  beforeEach(() => localStorage.removeItem(CAPS_KEY));
  afterEach(() => localStorage.removeItem(CAPS_KEY));

  describe('the hunt', () => {
    it('starts empty', () => {
      expect(service().capsFound()).toBe(0);
    });

    it('records a cap once, however many times it is reported', () => {
      const state = service();
      state.collectCap(COLLECTIBLES[0].id, COLLECTIBLES[0].label);
      state.collectCap(COLLECTIBLES[0].id, COLLECTIBLES[0].label);
      expect(state.capsFound()).toBe(1);
    });

    it('reports completion only on the last one', () => {
      const state = service();
      const results = COLLECTIBLES.map((c) => state.collectCap(c.id, c.label).completed);
      expect(results.slice(0, -1).some(Boolean))
        .withContext('completion claimed early')
        .toBe(false);
      expect(results.at(-1)).withContext('completion on the final cap').toBe(true);
    });

    it('survives a reload', () => {
      const first = service();
      first.collectCap(COLLECTIBLES[0].id, COLLECTIBLES[0].label);
      first.collectCap(COLLECTIBLES[1].id, COLLECTIBLES[1].label);

      // A fresh instance is what a page reload produces.
      expect(service().capsFound()).toBe(2);
    });

    it('can be reset', () => {
      const state = service();
      state.collectCap(COLLECTIBLES[0].id, COLLECTIBLES[0].label);
      state.resetHunt();
      expect(state.capsFound()).toBe(0);
      expect(service().capsFound()).withContext('and stays reset across a reload').toBe(0);
    });

    /**
     * Stored ids are filtered against the current set. Without it, renaming or
     * moving a cap leaves a stale id counting toward the total, and the visitor
     * is stranded one find short of a reward they can never collect.
     */
    it('ignores stored ids that no longer exist', () => {
      localStorage.setItem(CAPS_KEY, JSON.stringify([COLLECTIBLES[0].id, 'cap-from-a-past-life']));
      expect(service().capsFound()).toBe(1);
    });

    it('survives corrupted storage', () => {
      localStorage.setItem(CAPS_KEY, 'not json at all');
      expect(() => service()).not.toThrow();
      expect(service().capsFound()).toBe(0);
    });

    it('survives storage holding the wrong shape', () => {
      localStorage.setItem(CAPS_KEY, JSON.stringify({ nope: true }));
      expect(service().capsFound()).toBe(0);
    });
  });

  describe('the location tally', () => {
    /**
     * The colophon is a panel but not a place. Counting it would push the tally
     * past the four the HUD advertises.
     */
    it('counts locations only, never the colophon', () => {
      const state = service();
      for (const spot of HOTSPOTS) state.openPanelById(spot.id);
      state.openPanelById('colophon');

      expect(state.discoveredCount()).toBe(HOTSPOTS.length);
      expect(state.allDiscovered()).toBe(true);
    });
  });
});
