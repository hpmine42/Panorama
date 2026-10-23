// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GestureController, type GestureCallbacks } from './GestureController';

function dispatchPointer(
  target: HTMLElement,
  type: string,
  init: {
    pointerId: number;
    clientX: number;
    clientY: number;
    pointerType?: string;
    isPrimary?: boolean;
    button?: number;
  },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerType: { value: init.pointerType ?? 'touch' },
    isPrimary: { value: init.isPrimary ?? init.pointerId === 1 },
    button: { value: init.button ?? 0 },
  });
  target.dispatchEvent(event);
}

describe('GestureController mobile edge cases', () => {
  let element: HTMLDivElement;
  let callbacks: GestureCallbacks;
  let controller: GestureController;
  let now = 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 40,
      left: 20,
      top: 40,
      right: 410,
      bottom: 884,
      width: 390,
      height: 844,
      toJSON: () => ({}),
    });
    document.body.appendChild(element);

    callbacks = {
      onPan: vi.fn(),
      onPanEnd: vi.fn(),
      onPinch: vi.fn(),
      onPinchEnd: vi.fn(),
      onDoubleTap: vi.fn(),
      onSingleTap: vi.fn(),
      onWheel: vi.fn(),
    };
    controller = new GestureController(element, callbacks);
  });

  afterEach(() => {
    controller.destroy();
    element.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not trigger accidental fling inertia when lifting two fingers after pinching', () => {
    dispatchPointer(element, 'pointerdown', { pointerId: 1, clientX: 120, clientY: 300, isPrimary: true });
    dispatchPointer(element, 'pointerdown', { pointerId: 2, clientX: 220, clientY: 300, isPrimary: false });

    now += 16;
    dispatchPointer(element, 'pointermove', { pointerId: 1, clientX: 100, clientY: 300, isPrimary: true });
    dispatchPointer(element, 'pointermove', { pointerId: 2, clientX: 260, clientY: 300, isPrimary: false });
    expect(callbacks.onPinch).toHaveBeenCalled();
    // Element offset (20, 40) must be subtracted from midpoint (180, 300) -> (160, 260).
    expect(callbacks.onPinch).toHaveBeenLastCalledWith(expect.any(Number), 160, 260, expect.any(Number), expect.any(Number));

    // Lift finger 1 first, then finger 2 rolls slightly by 6px while lifting 25ms later.
    now += 20;
    dispatchPointer(element, 'pointerup', { pointerId: 1, clientX: 100, clientY: 300, isPrimary: true });
    now += 15;
    dispatchPointer(element, 'pointermove', { pointerId: 2, clientX: 266, clientY: 304, isPrimary: false });
    now += 10;
    dispatchPointer(element, 'pointerup', { pointerId: 2, clientX: 266, clientY: 304, isPrimary: false });

    expect(callbacks.onPinchEnd).toHaveBeenCalledTimes(1);
    expect(callbacks.onPanEnd).not.toHaveBeenCalled();
  });

  it('recovers from orphaned ghost touch pointers on subsequent single-finger gestures', () => {
    // Simulate a touch that never received pointerup (e.g. stolen by OS edge gesture).
    dispatchPointer(element, 'pointerdown', { pointerId: 11, clientX: 100, clientY: 200, isPrimary: true });

    // Next primary single-finger touch must prune pointer 11 and pan cleanly instead of pinching!
    now += 400;
    dispatchPointer(element, 'pointerdown', { pointerId: 12, clientX: 150, clientY: 250, isPrimary: true });
    now += 16;
    dispatchPointer(element, 'pointermove', { pointerId: 12, clientX: 190, clientY: 250, isPrimary: true });

    expect(callbacks.onPinch).not.toHaveBeenCalled();
    expect(callbacks.onPan).toHaveBeenCalledWith(40, 0);
  });

  it('produces zero inertia when user holds finger stationary before lifting', () => {
    dispatchPointer(element, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 400 });
    now += 16;
    dispatchPointer(element, 'pointermove', { pointerId: 1, clientX: 140, clientY: 400 });
    now += 16;
    dispatchPointer(element, 'pointermove', { pointerId: 1, clientX: 90, clientY: 400 });

    // Hold finger completely still for 180ms before lifting.
    now += 180;
    dispatchPointer(element, 'pointerup', { pointerId: 1, clientX: 90, clientY: 400 });
    expect(callbacks.onPanEnd).toHaveBeenCalledWith(0, 0);
  });

  it('distinguishes single tap (HUD toggle) from double tap (zoom) using element-local coordinates', () => {
    // Single tap at client (120, 240) -> local (100, 200)
    dispatchPointer(element, 'pointerdown', { pointerId: 1, clientX: 120, clientY: 240 });
    now += 40;
    dispatchPointer(element, 'pointerup', { pointerId: 1, clientX: 120, clientY: 240 });

    expect(callbacks.onSingleTap).not.toHaveBeenCalled();
    now += 300;
    vi.advanceTimersByTime(300);
    expect(callbacks.onSingleTap).toHaveBeenCalledTimes(1);
    expect(callbacks.onSingleTap).toHaveBeenCalledWith(100, 200);
    expect(callbacks.onDoubleTap).not.toHaveBeenCalled();

    // Double tap at client (220, 340) -> local (200, 300)
    dispatchPointer(element, 'pointerdown', { pointerId: 2, clientX: 220, clientY: 340 });
    now += 35;
    dispatchPointer(element, 'pointerup', { pointerId: 2, clientX: 220, clientY: 340 });
    now += 90;
    vi.advanceTimersByTime(90);
    dispatchPointer(element, 'pointerdown', { pointerId: 3, clientX: 222, clientY: 342 });
    now += 35;
    dispatchPointer(element, 'pointerup', { pointerId: 3, clientX: 222, clientY: 342 });
    now += 350;
    vi.advanceTimersByTime(350);

    expect(callbacks.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(callbacks.onDoubleTap).toHaveBeenCalledWith(202, 302);
    // Single tap must NOT fire again during the double tap!
    expect(callbacks.onSingleTap).toHaveBeenCalledTimes(1);
  });
});
