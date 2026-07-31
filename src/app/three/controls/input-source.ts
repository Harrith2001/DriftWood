import type { MoveIntent } from './walk-controller';

/**
 * Collects movement intent from the keyboard and from an optional virtual
 * joystick, and reports one-shot "interact" presses.
 *
 * The scene polls this once per frame rather than reacting to events, which
 * keeps movement frame-rate independent and stops a dropped keyup from leaving
 * the character walking forever.
 */
export class InputSource {
  private readonly keys = new Set<string>();
  /** Set by the touch joystick; overrides the keyboard when non-zero. */
  private touchForward = 0;
  private touchTurn = 0;
  /** Latched interact request, cleared when read. */
  private interactQueued = false;

  private enabled = true;
  private readonly target: Window;

  private static readonly MOVE_KEYS = new Set([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'ShiftLeft',
    'ShiftRight',
  ]);

  constructor(target: Window = window) {
    this.target = target;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    // A tab switch mid-stride would otherwise leave the key latched down.
    this.target.addEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;

    if (event.code === 'KeyE' || event.code === 'Enter' || event.code === 'Space') {
      this.interactQueued = true;
      event.preventDefault();
      return;
    }
    if (InputSource.MOVE_KEYS.has(event.code)) {
      this.keys.add(event.code);
      // Arrow keys and space would otherwise scroll the page underneath.
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.touchForward = 0;
    this.touchTurn = 0;
  };

  /** Disables input while a dialog owns the keyboard. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.touchForward = 0;
      this.touchTurn = 0;
    }
  }

  /** Applied by the on-screen joystick; components are already in -1..1. */
  setTouchAxes(forward: number, turn: number): void {
    this.touchForward = clamp(forward);
    this.touchTurn = clamp(turn);
  }

  readIntent(): MoveIntent {
    if (!this.enabled) return { forward: 0, turn: 0, run: false };

    const held = (...codes: string[]) => codes.some((c) => this.keys.has(c));

    let forward = 0;
    if (held('ArrowUp', 'KeyW')) forward += 1;
    if (held('ArrowDown', 'KeyS')) forward -= 1;

    let turn = 0;
    if (held('ArrowLeft', 'KeyA')) turn += 1;
    if (held('ArrowRight', 'KeyD')) turn -= 1;

    // Touch wins when engaged, so a stray held key cannot fight the joystick.
    const usingTouch = this.touchForward !== 0 || this.touchTurn !== 0;
    if (this.touchForward !== 0) forward = this.touchForward;
    if (this.touchTurn !== 0) turn = this.touchTurn;

    return {
      forward: clamp(forward),
      turn: clamp(turn),
      // Shift on a keyboard; full stick deflection on touch, where there is no
      // modifier available. The deflection rule must not apply to the keyboard:
      // a held key is always exactly 1, so every step would have been a sprint.
      run: held('ShiftLeft', 'ShiftRight') || (usingTouch && Math.abs(forward) > 0.85),
    };
  }

  /** Returns true at most once per press. */
  consumeInteract(): boolean {
    if (!this.interactQueued) return false;
    this.interactQueued = false;
    return true;
  }

  /** Queues an interact from a UI button press. */
  queueInteract(): void {
    this.interactQueued = true;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.keys.clear();
  }
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
