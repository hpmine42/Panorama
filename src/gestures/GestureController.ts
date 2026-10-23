export interface GestureCallbacks {
  onPan(deltaX: number, deltaY: number): void;
  onPanEnd(velocityX: number, velocityY: number): void;
  onPinch(scale: number, centerX: number, centerY: number, deltaX: number, deltaY: number): void;
  onPinchEnd(): void;
  onDoubleTap(x: number, y: number): void;
  onSingleTap?(x: number, y: number): void;
  onWheel(deltaY: number, x: number, y: number): void;
}

type Point = {
  x: number;
  y: number;
  downX: number;
  downY: number;
  moved: boolean;
  pointerType: string;
  isPrimary: boolean;
  lastTime: number;
};

type HistoryPoint = { x: number; y: number; time: number };

const TAP_MAX_DURATION = 280;
const DOUBLE_TAP_WINDOW = 280;
const TAP_MAX_DISTANCE = 26;
const MOVE_SLOP = 8;
const POST_PINCH_PAN_UNLOCK_DISTANCE = 14;
const VELOCITY_MAX_AGE_MS = 95;
const STALE_POINTER_MS = 4000;

/**
 * Mobile-hardened pointer gesture controller.
 * - Uses element-local coordinates consistently across pan, pinch, tap, and wheel.
 * - Cleans up ghost pointers on lostpointercapture, window blur, and OS edge gestures.
 * - Prevents accidental fling inertia when lifting fingers after a two-finger pinch.
 * - Suppresses iOS Safari viewport gesture zoom.
 */
export class GestureController {
  private readonly element: HTMLElement;
  private readonly callbacks: GestureCallbacks;
  private readonly pointers = new Map<number, Point>();
  private history: HistoryPoint[] = [];
  private lastX = 0;
  private lastY = 0;
  private lastDistance = 0;
  private lastMidpoint = { x: 0, y: 0 };
  private postPinchOrigin = { x: 0, y: 0 };
  private gestureMode: 'none' | 'pan' | 'pinch' | 'post-pinch' = 'none';
  private hadMultiTouch = false;
  private downTime = 0;
  private lastTap: { x: number; y: number; time: number } | null = null;
  private singleTapTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(element: HTMLElement, callbacks: GestureCallbacks) {
    this.element = element;
    this.callbacks = callbacks;
    this.element.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    this.element.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    this.element.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    this.element.addEventListener('pointercancel', this.handlePointerCancel, { passive: false });
    this.element.addEventListener('lostpointercapture', this.handleLostPointerCapture);
    this.element.addEventListener('wheel', this.handleWheel, { passive: false });
    this.element.addEventListener('contextmenu', this.preventDefault, { passive: false });
    this.element.addEventListener('gesturestart', this.preventDefault, { passive: false });
    this.element.addEventListener('gesturechange', this.preventDefault, { passive: false });
    this.element.addEventListener('gestureend', this.preventDefault, { passive: false });
    window.addEventListener('blur', this.cancelAllPointers);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearSingleTapTimer();
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener('lostpointercapture', this.handleLostPointerCapture);
    this.element.removeEventListener('wheel', this.handleWheel);
    this.element.removeEventListener('contextmenu', this.preventDefault);
    this.element.removeEventListener('gesturestart', this.preventDefault);
    this.element.removeEventListener('gesturechange', this.preventDefault);
    this.element.removeEventListener('gestureend', this.preventDefault);
    window.removeEventListener('blur', this.cancelAllPointers);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.pointers.clear();
  }

  private clearSingleTapTimer(): void {
    if (this.singleTapTimer !== null) {
      clearTimeout(this.singleTapTimer);
      this.singleTapTimer = null;
    }
  }

  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private readonly preventDefault = (event: Event): void => {
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.cancelAllPointers();
    }
  };

  private readonly cancelAllPointers = (): void => {
    if (this.pointers.size === 0) return;
    const wasPinching = this.hadMultiTouch;
    this.pointers.clear();
    this.history = [];
    this.gestureMode = 'none';
    this.hadMultiTouch = false;
    this.lastTap = null;
    this.clearSingleTapTimer();
    if (wasPinching) {
      this.callbacks.onPinchEnd();
    }
  };

  private pruneOrphanedPointers(event: PointerEvent, now: number): void {
    for (const [id, existing] of this.pointers.entries()) {
      if (id === event.pointerId) continue;
      const isDuplicatePrimaryTouch = event.pointerType === 'touch'
        && event.isPrimary
        && existing.pointerType === 'touch'
        && existing.isPrimary;
      const isStale = now - existing.lastTime > STALE_POINTER_MS;
      if (isDuplicatePrimaryTouch || isStale) {
        this.pointers.delete(id);
      }
    }
    if (this.pointers.size === 0) {
      this.hadMultiTouch = false;
      this.gestureMode = 'none';
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.destroyed || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.cancelable) event.preventDefault();

    const now = performance.now();
    this.pruneOrphanedPointers(event, now);

    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore synthetic events or browsers that reject pointer capture.
    }

    const local = this.toLocal(event.clientX, event.clientY);
    const point: Point = {
      x: local.x,
      y: local.y,
      downX: local.x,
      downY: local.y,
      moved: false,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      lastTime: now,
    };
    this.pointers.set(event.pointerId, point);

    if (this.pointers.size === 1) {
      this.hadMultiTouch = false;
      this.gestureMode = 'pan';
      this.lastX = local.x;
      this.lastY = local.y;
      this.downTime = now;
      this.history = [{ x: local.x, y: local.y, time: now }];

      if (
        this.lastTap
        && now - this.lastTap.time <= DOUBLE_TAP_WINDOW
        && Math.hypot(this.lastTap.x - local.x, this.lastTap.y - local.y) <= TAP_MAX_DISTANCE
      ) {
        this.clearSingleTapTimer();
      }
      return;
    }

    if (this.pointers.size >= 2) {
      const [first, second] = [...this.pointers.values()];
      this.lastMidpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      this.lastDistance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      this.gestureMode = 'pinch';
      this.hadMultiTouch = true;
      this.lastTap = null;
      this.clearSingleTapTimer();
      this.history = [];
      for (const activePoint of this.pointers.values()) activePoint.moved = true;
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const point = this.pointers.get(event.pointerId);
    if (!point) return;
    if (event.cancelable) event.preventDefault();

    const now = performance.now();
    const local = this.toLocal(event.clientX, event.clientY);
    point.x = local.x;
    point.y = local.y;
    point.lastTime = now;
    if (!point.moved && Math.hypot(point.x - point.downX, point.y - point.downY) > MOVE_SLOP) {
      point.moved = true;
      this.clearSingleTapTimer();
    }

    if (this.pointers.size >= 2) {
      this.gestureMode = 'pinch';
      this.hadMultiTouch = true;
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

    if (this.gestureMode === 'post-pinch') {
      const postPinchMove = Math.hypot(
        point.x - this.postPinchOrigin.x,
        point.y - this.postPinchOrigin.y,
      );
      if (postPinchMove < POST_PINCH_PAN_UNLOCK_DISTANCE) {
        return;
      }
      this.gestureMode = 'pan';
      this.lastX = point.x;
      this.lastY = point.y;
      this.history = [{ x: point.x, y: point.y, time: now }];
      return;
    }

    if (this.gestureMode !== 'pan') return;
    const deltaX = point.x - this.lastX;
    const deltaY = point.y - this.lastY;
    this.lastX = point.x;
    this.lastY = point.y;
    if (deltaX === 0 && deltaY === 0) return;
    this.callbacks.onPan(deltaX, deltaY);
    this.history.push({ x: point.x, y: point.y, time: now });
    this.history = this.history.filter((sample) => now - sample.time <= 120);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.finishPointer(event, false);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.finishPointer(event, true);
  };

  private readonly handleLostPointerCapture = (event: PointerEvent): void => {
    if (this.pointers.has(event.pointerId)) {
      this.finishPointer(event, true);
    }
  };

  private finishPointer(event: PointerEvent, cancelled: boolean): void {
    const point = this.pointers.get(event.pointerId);
    if (!point) return;
    if (event.cancelable) event.preventDefault();

    const now = performance.now();
    const local = this.toLocal(event.clientX, event.clientY);
    point.x = local.x;
    point.y = local.y;

    const wasOnlyPointer = this.pointers.size === 1;
    const wasTap = !cancelled
      && wasOnlyPointer
      && !this.hadMultiTouch
      && !point.moved
      && now - this.downTime <= TAP_MAX_DURATION;

    this.pointers.delete(event.pointerId);
    try {
      if (this.element.hasPointerCapture?.(event.pointerId)) {
        this.element.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }

    if (this.pointers.size === 0) {
      if (this.gestureMode === 'pan' && !this.hadMultiTouch && !cancelled && point.moved) {
        const velocity = this.calculateVelocity(point, now);
        this.callbacks.onPanEnd(velocity.x, velocity.y);
      } else if (this.hadMultiTouch) {
        // If the user unlocked into intentional 1-finger pan after pinching,
        // allow gentle inertia; otherwise end the pinch cleanly with zero fling.
        if (this.gestureMode === 'pan' && !cancelled) {
          const velocity = this.calculateVelocity(point, now);
          this.callbacks.onPanEnd(velocity.x, velocity.y);
        }
        this.callbacks.onPinchEnd();
      }
      this.gestureMode = 'none';
      this.hadMultiTouch = false;
      this.history = [];
    } else if (this.pointers.size === 1) {
      const [remaining] = [...this.pointers.values()];
      this.gestureMode = 'post-pinch';
      this.postPinchOrigin = { x: remaining.x, y: remaining.y };
      this.lastX = remaining.x;
      this.lastY = remaining.y;
      this.history = [];
    } else {
      const [first, second] = [...this.pointers.values()];
      this.lastMidpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      this.lastDistance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
    }

    if (wasTap) {
      const previous = this.lastTap;
      if (
        previous
        && now - previous.time <= DOUBLE_TAP_WINDOW
        && Math.hypot(previous.x - point.x, previous.y - point.y) <= TAP_MAX_DISTANCE
      ) {
        this.clearSingleTapTimer();
        this.lastTap = null;
        this.callbacks.onDoubleTap(point.x, point.y);
      } else {
        const tapX = point.x;
        const tapY = point.y;
        this.lastTap = { x: tapX, y: tapY, time: now };
        this.clearSingleTapTimer();
        if (this.callbacks.onSingleTap) {
          this.singleTapTimer = setTimeout(() => {
            this.singleTapTimer = null;
            this.lastTap = null;
            this.callbacks.onSingleTap?.(tapX, tapY);
          }, DOUBLE_TAP_WINDOW);
        }
      }
    } else if (this.pointers.size === 0 && !wasTap) {
      this.lastTap = null;
      this.clearSingleTapTimer();
    }
  }

  private calculateVelocity(point: Point, now: number): { x: number; y: number } {
    const recent = this.history.filter((sample) => now - sample.time <= VELOCITY_MAX_AGE_MS);
    if (recent.length === 0) {
      return { x: 0, y: 0 };
    }
    const samples = [...recent, { x: point.x, y: point.y, time: now }];
    const first = samples.find((sample) => now - sample.time >= 28) ?? samples[0];
    const deltaSeconds = (now - first.time) / 1000;
    if (deltaSeconds < 0.012) {
      return { x: 0, y: 0 };
    }
    const velocityX = (point.x - first.x) / Math.max(deltaSeconds, 0.028);
    const velocityY = (point.y - first.y) / Math.max(deltaSeconds, 0.028);
    return {
      x: Math.max(-2800, Math.min(2800, velocityX)),
      y: Math.max(-2800, Math.min(2800, velocityY)),
    };
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    if (event.cancelable) event.preventDefault();
    const local = this.toLocal(event.clientX, event.clientY);
    this.callbacks.onWheel(event.deltaY, local.x, local.y);
  };
}
