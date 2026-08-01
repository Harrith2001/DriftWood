import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TouchControls } from './touch-controls';

/**
 * The joystick is the only way to move on a phone, so its axis maths is worth
 * pinning down: a sign error here makes the whole island unreachable on touch,
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

  it('emits an interact request from the action button', () => {
    let fired = 0;
    component.interact.subscribe(() => fired++);
    fixture.nativeElement.querySelector('button.action').click();
    expect(fired).toBe(1);
  });
});
