import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  output,
  viewChild,
} from '@angular/core';

/**
 * On-screen joystick, jump and interact buttons for touch devices.
 *
 * Without this the entire city is unreachable on a phone — the character has no
 * keyboard to drive it. The stick reports normalised axes continuously and
 * re-centres on release.
 *
 * Two things here are deliberate and easy to undo by accident.
 *
 * The action buttons fire on `pointerdown`, not `click`. A click only arrives on
 * release, and on touch it is routinely dropped when another pointer is already
 * captured elsewhere — which is precisely the case that matters here: one thumb
 * holding the stick, the other tapping jump. Bound to click, jump worked while
 * standing still and did nothing while moving. Firing on press is also simply
 * more responsive, which is what an action button in a game should be.
 *
 * The pointer listeners are attached outside Angular's zone and the knob is
 * moved by writing to its style directly. Bound in the template, every one of
 * the sixty pointermove events a second would schedule change detection across
 * the whole application while the character is moving — on the device least able
 * to afford it.
 */
@Component({
  selector: 'app-touch-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './touch-controls.html',
  styleUrl: './touch-controls.css',
})
export class TouchControls implements AfterViewInit, OnDestroy {
  /** Emits normalised axes: forward -1..1, turn -1..1. */
  readonly axes = output<{ forward: number; turn: number }>();
  readonly interact = output<void>();
  readonly jump = output<void>();

  private readonly stickRef = viewChild.required<ElementRef<HTMLElement>>('stick');
  private readonly knobRef = viewChild.required<ElementRef<HTMLElement>>('knob');
  private readonly zone = inject(NgZone);

  /** Half-width of the stick well, in px — the knob's travel limit. */
  private static readonly RADIUS = 46;

  private activePointer: number | null = null;
  private originX = 0;
  private originY = 0;

  ngAfterViewInit(): void {
    const stick = this.stickRef().nativeElement;
    this.zone.runOutsideAngular(() => {
      stick.addEventListener('pointerdown', this.onDown);
      stick.addEventListener('pointermove', this.onMove);
      stick.addEventListener('pointerup', this.onUp);
      // Cancel covers the browser taking the gesture away — a system gesture, a
      // call arriving. Deliberately no `pointerleave`: the capture below keeps a
      // finger that slides outside the well tracking, and treating leave as a
      // release drops the stick mid-stride whenever capture is unavailable.
      stick.addEventListener('pointercancel', this.onUp);
    });
  }

  ngOnDestroy(): void {
    const stick = this.stickRef().nativeElement;
    stick.removeEventListener('pointerdown', this.onDown);
    stick.removeEventListener('pointermove', this.onMove);
    stick.removeEventListener('pointerup', this.onUp);
    stick.removeEventListener('pointercancel', this.onUp);
  }

  // ── Action buttons ─────────────────────────────────────────────────────────

  /**
   * Press, not release. See the class note — this is the jump-while-moving fix.
   */
  protected onJumpPress(): void {
    this.jump.emit();
  }

  protected onInteractPress(): void {
    this.interact.emit();
  }

  /**
   * Keyboard activation only.
   *
   * A button reached by Tab and activated with Enter or Space emits a click with
   * `detail === 0`; one produced by a real press carries a positive detail. That
   * distinction is what lets the buttons fire on press without firing twice for
   * everyone using a pointer.
   */
  protected onKeyboardActivate(event: MouseEvent, action: 'jump' | 'interact'): void {
    if (event.detail !== 0) return;
    if (action === 'jump') this.jump.emit();
    else this.interact.emit();
  }

  // ── Stick ──────────────────────────────────────────────────────────────────

  private readonly onDown = (event: PointerEvent): void => {
    // One finger owns the stick. A second landing on it used to take over, and
    // then lifting that one re-centred the stick while the first was still
    // pushed — the character stopping dead with a thumb still on the pad.
    if (this.activePointer !== null) return;
    this.activePointer = event.pointerId;

    const rect = this.stickRef().nativeElement.getBoundingClientRect();
    // Anchor to the well's centre so the first touch does not jerk the character.
    this.originX = rect.left + rect.width / 2;
    this.originY = rect.top + rect.height / 2;

    // Capture keeps the stick tracking a finger that slides outside the well.
    // It throws if the pointer is already gone, which must not take the whole
    // gesture down with it.
    try {
      this.stickRef().nativeElement.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already released — tracking still works without capture */
    }
    this.update(event);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId) return;
    this.update(event);
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId) return;
    this.activePointer = null;
    this.moveKnob(0, 0);
    this.axes.emit({ forward: 0, turn: 0 });
  };

  private update(event: PointerEvent): void {
    const dx = event.clientX - this.originX;
    const dy = event.clientY - this.originY;

    // Clamp the knob inside the well.
    const distance = Math.hypot(dx, dy);
    const scale = distance > TouchControls.RADIUS ? TouchControls.RADIUS / distance : 1;
    const clampedX = dx * scale;
    const clampedY = dy * scale;

    this.moveKnob(clampedX, clampedY);

    // Screen down (+y) means walking away from the camera, i.e. forward is -y.
    // Turn is inverted so pushing right turns the character right.
    this.axes.emit({
      forward: -clampedY / TouchControls.RADIUS,
      turn: -clampedX / TouchControls.RADIUS,
    });
  }

  /** Written straight to the element: this runs sixty times a second. */
  private moveKnob(x: number, y: number): void {
    this.knobRef().nativeElement.style.transform = `translate(${x}px, ${y}px)`;
  }
}
