export interface GestureCallbacks {
  onPan(deltaX: number, deltaY: number): void;
  onPanEnd(velocityX: number, velocityY: number): void;
  onPinch(scale: number, centerX: number, centerY: number, deltaX: number, deltaY: number): void;
  onPinchEnd(): void;
  onDoubleTap(x: number, y: number): void;
  onWheel(deltaY: number, x: number, y: number): void;
}

type Point = {
  x: number;
  y: number;
  downX: number;
  downY: number;
  moved: boolean;
};

type HistoryPoint = { x: number; y: number; time: number };

const TAP_MAX_DURATION = 320;
const TAP_MAX_DISTANCE = 28;

/** Pointer-event-only gesture layer. It never scrolls the page or creates a browser history gesture. */
export class GestureController {
  private readonly element: HTMLElement;
  private readonly callbacks: GestureCallbacks;
  private readonly pointers = new Map<number, Point>();
  private history: HistoryPoint[] = [];
  private lastX = 0;
  private lastY = 0;
  private lastDistance = 0;
  private lastMidpoint = { x: 0, y: 0 };
  private gestureMode: 'none' | 'pan' | 'pinch' = 'none';
  private downTime = 0;
  private lastTap: { x: number; y: number; time: number } | null = null;
  private destroyed = false;

  constructor(element: HTMLElement, callbacks: GestureCallbacks) {
    this.element = element;
    this.callbacks = callbacks;
    this.element.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    this.element.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    this.element.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    this.element.addEventListener('pointercancel', this.handlePointerCancel, { passive: false });
    this.element.addEventListener('wheel', this.handleWheel, { passive: false });
    this.element.addEventListener('contextmenu', this.preventDefault, { passive: false });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener('wheel', this.handleWheel);
    this.element.removeEventListener('contextmenu', this.preventDefault);
    this.pointers.clear();
  }

  private readonly preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.destroyed || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    this.element.setPointerCapture?.(event.pointerId);

    const point: Point = {
      x: event.clientX,
      y: event.clientY,
      downX: event.clientX,
      downY: event.clientY,
      moved: false,
    };
    this.pointers.set(event.pointerId, point);

    if (this.pointers.size === 1) {
      this.gestureMode = 'pan';
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.downTime = performance.now();
      this.history = [{ x: event.clientX, y: event.clientY, time: this.downTime }];
      return;
    }

    if (this.pointers.size === 2) {
      const [first, second] = [...this.pointers.values()];
      this.lastMidpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      this.lastDistance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      this.gestureMode = 'pinch';
      this.lastTap = null;
      for (const activePoint of this.pointers.values()) activePoint.moved = true;
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const point = this.pointers.get(event.pointerId);
    if (!point) return;
    event.preventDefault();
    point.x = event.clientX;
    point.y = event.clientY;
    point.moved = point.moved
      || Math.hypot(point.x - point.downX, point.y - point.downY) > 8;

    if (this.pointers.size >= 2) {
      const [first, second] = [...this.pointers.values()];
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      const scale = distance / Math.max(this.lastDistance, 1);
      const deltaX = midpoint.x - this.lastMidpoint.x;
      const deltaY = midpoint.y - this.lastMidpoint.y;
      this.lastDistance = distance;
      this.lastMidpoint = midpoint;
      this.callbacks.onPinch(scale, midpoint.x, midpoint.y, deltaX, deltaY);
      return;
    }

    if (this.gestureMode !== 'pan') return;
    const deltaX = point.x - this.lastX;
    const deltaY = point.y - this.lastY;
    this.lastX = point.x;
    this.lastY = point.y;
    if (deltaX === 0 && deltaY === 0) return;
    this.callbacks.onPan(deltaX, deltaY);
    const now = performance.now();
    this.history.push({ x: point.x, y: point.y, time: now });
    this.history = this.history.filter((sample) => now - sample.time <= 120);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.finishPointer(event, false);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.finishPointer(event, true);
  };

  private finishPointer(event: PointerEvent, cancelled: boolean): void {
    const point = this.pointers.get(event.pointerId);
    if (!point) return;
    event.preventDefault();
    const wasOnlyPointer = this.pointers.size === 1;
    const wasTap = !cancelled
      && wasOnlyPointer
      && !point.moved
      && performance.now() - this.downTime <= TAP_MAX_DURATION;

    this.pointers.delete(event.pointerId);
    try {
      this.element.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can already have been released by the browser.
    }

    if (wasOnlyPointer && this.gestureMode === 'pan') {
      if (!cancelled) {
        const velocity = this.calculateVelocity(point);
        this.callbacks.onPanEnd(velocity.x, velocity.y);
      }
      this.gestureMode = 'none';
    } else if (this.pointers.size === 1) {
      const [remaining] = [...this.pointers.values()];
      this.gestureMode = 'pan';
      this.lastX = remaining.x;
      this.lastY = remaining.y;
      this.history = [{ x: remaining.x, y: remaining.y, time: performance.now() }];
    } else if (this.pointers.size === 0) {
      this.gestureMode = 'none';
      this.callbacks.onPinchEnd();
    }

    if (wasTap) {
      const now = performance.now();
      const previous = this.lastTap;
      if (
        previous
        && now - previous.time <= TAP_MAX_DURATION
        && Math.hypot(previous.x - point.x, previous.y - point.y) <= TAP_MAX_DISTANCE
      ) {
        this.lastTap = null;
        this.callbacks.onDoubleTap(point.x, point.y);
      } else {
        this.lastTap = { x: point.x, y: point.y, time: now };
      }
    } else if (this.pointers.size === 0) {
      this.lastTap = null;
    }
  }

  private calculateVelocity(point: Point): { x: number; y: number } {
    const now = performance.now();
    const samples = [...this.history, { x: point.x, y: point.y, time: now }];
    const first = samples.find((sample) => now - sample.time >= 35) ?? samples[0];
    const deltaTime = Math.max(0.035, (now - first.time) / 1000);
    const velocityX = (point.x - first.x) / deltaTime;
    const velocityY = (point.y - first.y) / deltaTime;
    return {
      x: Math.max(-2600, Math.min(2600, velocityX)),
      y: Math.max(-2600, Math.min(2600, velocityY)),
    };
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.element.getBoundingClientRect();
    this.callbacks.onWheel(event.deltaY, event.clientX - rect.left, event.clientY - rect.top);
  };
}
