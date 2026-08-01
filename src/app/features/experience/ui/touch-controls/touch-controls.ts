import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';

/**
 * On-screen joystick and interact button for touch devices.
 *
 * Without this the entire island is unreachable on a phone — the character has
 * no keyboard to drive it. The stick reports normalised axes continuously and
 * re-centres on release.
 */
@Component({
  selector: 'app-touch-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './touch-controls.html',
  styleUrl: './touch-controls.css',
})
export class TouchControls {
  /** Emits normalised axes: forward -1..1, turn -1..1. */
  readonly axes = output<{ forward: number; turn: number }>();
  readonly interact = output<void>();

  protected readonly knobX = signal(0);
  protected readonly knobY = signal(0);

  /** Half-width of the stick well, in px — the knob's travel limit. */
  private static readonly RADIUS = 46;

  private activePointer: number | null = null;
  private originX = 0;
  private originY = 0;

  protected onDown(event: PointerEvent): void {
    this.activePointer = event.pointerId;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Anchor to the well's centre so the first touch does not jerk the character.
    this.originX = rect.left + rect.width / 2;
    this.originY = rect.top + rect.height / 2;
    // Capture keeps the stick tracking a finger that slides outside the well.
    // It throws if the pointer is already gone, which must not take the whole
    // gesture down with it.
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* pointer already released — tracking still works without capture */
    }
    this.update(event);
  }

  protected onMove(event: PointerEvent): void {
    if (this.activePointer !== event.pointerId) return;
    this.update(event);
  }

  protected onUp(event: PointerEvent): void {
    if (this.activePointer !== event.pointerId) return;
    this.activePointer = null;
    this.knobX.set(0);
    this.knobY.set(0);
    this.axes.emit({ forward: 0, turn: 0 });
  }

  private update(event: PointerEvent): void {
    const dx = event.clientX - this.originX;
    const dy = event.clientY - this.originY;

    // Clamp the knob inside the well.
    const distance = Math.hypot(dx, dy);
    const scale = distance > TouchControls.RADIUS ? TouchControls.RADIUS / distance : 1;
    const clampedX = dx * scale;
    const clampedY = dy * scale;

    this.knobX.set(clampedX);
    this.knobY.set(clampedY);

    // Screen down (+y) means walking away from the camera, i.e. forward is -y.
    // Turn is inverted so pushing right turns the character right.
    this.axes.emit({
      forward: -clampedY / TouchControls.RADIUS,
      turn: -clampedX / TouchControls.RADIUS,
    });
  }
}
