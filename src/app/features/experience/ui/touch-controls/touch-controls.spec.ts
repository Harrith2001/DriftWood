import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TouchControls } from './touch-controls';

/**
 * The joystick is the only way to move on a phone, so its axis maths is worth
 * pinning down: a sign error here makes the whole city unreachable on touch,
 * and it cannot be caught on a desktop browser, which never reports a coarse
 * pointer and so never renders this component at all.
 */
describe('TouchControls', () => {
  let fixture: ComponentFixture<TouchControls>;
  let component: TouchControls;
  let stick: HTMLElement;
  /** Centre of the stick well, in client coordinates. */
  let centre: { x: number; y: number };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TouchControls] }).compileComponents();
    fixture = TestBed.createComponent(TouchControls);
    fixture.detectChanges();

    stick = fixture.nativeElement.querySelector('.stick');
    const rect = stick.getBoundingClientRect();
    centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  /** Dispatches a pointer event at an offset from the well's centre. */
  function drag(type: string, dx: number, dy: number): void {
    stick.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        clientX: centre.x + dx,
        clientY: centre.y + dy,
        bubbles: true,
      }),
    );
    fixture.detectChanges();
  }

  /** Collects every axes emission during a gesture. */
  function record(): { last: () => { forward: number; turn: number } | null } {
    let latest: { forward: number; turn: number } | null = null;
    component.axes.subscribe((v) => (latest = v));
    return { last: () => latest };
  }

  beforeEach(() => {
    component = fixture.componentInstance;
  });

  it('reports no movement when pressed dead centre', () => {
    const axes = record();
    drag('pointerdown', 0, 0);
    expect(axes.last()!.forward).toBeCloseTo(0, 2);
    expect(axes.last()!.turn).toBeCloseTo(0, 2);
  });

  it('pushing up walks forward', () => {
    const axes = record();
    drag('pointerdown', 0, 0);
    // Screen y grows downward, so "up" is negative — forward must come out positive.
    drag('pointermove', 0, -30);
    expect(axes.last()!.forward).toBeGreaterThan(0.5);
  });

  it('pulling down walks backward', () => {
    const axes = record();
    drag('pointerdown', 0, 0);
    drag('pointermove', 0, 30);
    expect(axes.last()!.forward).toBeLessThan(-0.5);
  });

  it('pushing right turns right', () => {
    const axes = record();
    drag('pointerdown', 0, 0);
    // Turn is positive anticlockwise, so pushing right must be negative.
    drag('pointermove', 30, 0);
    expect(axes.last()!.turn).toBeLessThan(-0.5);
  });

  it('pushing left turns left', () => {
    const axes = record();
    drag('pointerdown', 0, 0);
    drag('pointermove', -30, 0);
    expect(axes.last()!.turn).toBeGreaterThan(0.5);
  });

  it('clamps to the unit range however far the finger travels', () => {
    const axes = record();
    drag('pointerdown', 0, 0);
    // Far outside the well, and diagonally, so both axes are exercised at once.
    drag('pointermove', -600, -600);
    expect(Math.abs(axes.last()!.forward)).toBeLessThanOrEqual(1.0001);
    expect(Math.abs(axes.last()!.turn)).toBeLessThanOrEqual(1.0001);
  });

  it('re-centres and stops on release', () => {
    const axes = record();
    drag('pointerdown', 0, 0);
    drag('pointermove', 0, -40);
    expect(axes.last()!.forward).toBeGreaterThan(0);

    drag('pointerup', 0, -40);
    expect(axes.last()!.forward).toBe(0);
    expect(axes.last()!.turn).toBe(0);
  });

  it('ignores movement from a pointer it is not tracking', () => {
    const axes = record();
    drag('pointerdown', 0, 0);
    drag('pointermove', 0, -40);
    const beforeStray = axes.last()!.forward;

    // A second finger elsewhere on screen must not steer the character.
    stick.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        clientX: centre.x + 200,
        clientY: centre.y + 200,
        bubbles: true,
      }),
    );
    fixture.detectChanges();

    expect(axes.last()!.forward).toBe(beforeStray);
  });

  /**
   * The jump-while-moving bug.
   *
   * Bound to `click`, the button fired on release and worked while standing
   * still — but a click on touch is routinely dropped when another pointer is
   * already captured, which is exactly one thumb on the stick and the other on
   * jump. These assert the press path, the keyboard path, and that having both
   * does not fire twice.
   */
  describe('action buttons', () => {
    function button(label: string): HTMLButtonElement {
      return fixture.nativeElement.querySelector(`button[aria-label="${label}"]`);
    }

    /** A real press, as a finger or mouse produces. */
    function press(el: HTMLElement): void {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true }));
    }

    /** The click a pointer produces on release — detail is positive. */
    function pointerClick(el: HTMLElement): void {
      el.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    }

    /** The click Enter or Space produces — detail is zero. */
    function keyboardClick(el: HTMLElement): void {
      el.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
    }

    it('jumps on press, before the finger lifts', () => {
      let jumps = 0;
      component.jump.subscribe(() => jumps++);
      press(button('Jump'));
      expect(jumps).toBe(1);
    });

    it('jumps while the stick is already holding a pointer', () => {
      let jumps = 0;
      component.jump.subscribe(() => jumps++);

      // One thumb on the stick, pushed forward and still down.
      drag('pointerdown', 0, 0);
      drag('pointermove', 0, -40);

      press(button('Jump'));
      expect(jumps).withContext('jump during an active stick gesture').toBe(1);
    });

    it('does not fire twice for one press', () => {
      let jumps = 0;
      component.jump.subscribe(() => jumps++);
      const el = button('Jump');
      press(el);
      pointerClick(el); // the click that follows the press
      expect(jumps).toBe(1);
    });

    it('still works from the keyboard', () => {
      let jumps = 0;
      component.jump.subscribe(() => jumps++);
      keyboardClick(button('Jump'));
      expect(jumps).toBe(1);
    });

    it('opens a location on press', () => {
      let interacts = 0;
      component.interact.subscribe(() => interacts++);
      press(button('Open location'));
      expect(interacts).toBe(1);
    });

    /**
     * A second finger landing on the pad used to take ownership of it, so
     * lifting that one re-centred the stick while the first was still pushed —
     * the character stopping dead with a thumb still on the pad.
     */
    it('ignores a second finger landing on the stick', () => {
      const axes = record();
      drag('pointerdown', 0, 0);
      drag('pointermove', 0, -46);
      const walking = axes.last()!.forward;

      // A second finger arrives and leaves.
      stick.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true }));
      stick.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }));

      expect(axes.last()!.forward)
        .withContext('still walking after a stray second touch')
        .toBeCloseTo(walking, 3);
    });

    it('keeps the two buttons distinct', () => {
      let interacts = 0;
      let jumps = 0;
      component.interact.subscribe(() => interacts++);
      component.jump.subscribe(() => jumps++);
      press(button('Jump'));
      expect(jumps).toBe(1);
      expect(interacts).toBe(0);
    });
  });

  it('emits an interact request from the action button', () => {
    let fired = 0;
    component.interact.subscribe(() => fired++);
    // Addressed by label rather than by position: there are two action buttons
    // now, and the first one in the DOM is jump.
    fixture.nativeElement.querySelector('button[aria-label="Open location"]').click();
    expect(fired).toBe(1);
  });

  it('emits a jump request from the jump button', () => {
    let fired = 0;
    component.jump.subscribe(() => fired++);
    fixture.nativeElement.querySelector('button[aria-label="Jump"]').click();
    expect(fired).toBe(1);
  });

  it('keeps the two action buttons distinct', () => {
    // Without a touch jump there is no way to jump on a phone at all, and it is
    // easy to wire both buttons to the same output and never notice.
    let interacts = 0;
    let jumps = 0;
    component.interact.subscribe(() => interacts++);
    component.jump.subscribe(() => jumps++);
    fixture.nativeElement.querySelector('button[aria-label="Jump"]').click();
    expect(jumps).toBe(1);
    expect(interacts).toBe(0);
  });
});
