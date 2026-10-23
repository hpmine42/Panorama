import { clamp, wrapAngle } from '../rendering/panoramaMath';

const DEG_TO_RAD = Math.PI / 180;
const MAX_SINGLE_STEP_RAD = 0.55;
const JITTER_DEADZONE_RAD = 0.0005;

export interface ForwardOrientation {
  /** Clockwise compass heading from North in [-π, π]. */
  azimuth: number;
  /** Vertical angle above horizon in [-π/2, π/2]. */
  elevation: number;
  /** Magnitude of horizontal projection in [0, 1]; approaches 0 near zenith/nadir. */
  horizontalConfidence: number;
}

type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied' | string>;
};

export function isGyroSupported(): boolean {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    return false;
  }
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export async function requestGyroPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    return false;
  }
  const ctor = DeviceOrientationEvent as DeviceOrientationWithPermission;
  if (typeof ctor.requestPermission === 'function') {
    try {
      const status = await ctor.requestPermission();
      return status === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Projects the camera's forward (-Z) ray into Earth East-North-Up coordinates
 * using the W3C Z(alpha) * X(beta) * Y(gamma) intrinsic rotation. Because -Z is
 * normal to the screen regardless of in-plane roll, this avoids Euler gimbal
 * lock when holding a phone upright at beta = 90° in portrait or landscape.
 */
export function deviceOrientationToForwardAngles(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): ForwardOrientation {
  const alpha = alphaDeg * DEG_TO_RAD;
  const beta = betaDeg * DEG_TO_RAD;
  const gamma = gammaDeg * DEG_TO_RAD;

  const sinAlpha = Math.sin(alpha);
  const cosAlpha = Math.cos(alpha);
  const sinBeta = Math.sin(beta);
  const cosBeta = Math.cos(beta);
  const sinGamma = Math.sin(gamma);
  const cosGamma = Math.cos(gamma);

  const x1 = -sinGamma;
  const y1 = cosGamma * sinBeta;
  const up = clamp(-cosGamma * cosBeta, -1, 1);

  const east = x1 * cosAlpha - y1 * sinAlpha;
  const north = x1 * sinAlpha + y1 * cosAlpha;
  const horizontalConfidence = clamp(Math.hypot(east, north), 0, 1);

  return {
    azimuth: horizontalConfidence > 1e-4 ? Math.atan2(east, north) : 0,
    elevation: Math.asin(up),
    horizontalConfidence,
  };
}

export class GyroController {
  private readonly onRotate: (deltaYaw: number, deltaPitch: number) => void;
  private previous: ForwardOrientation | null = null;
  private smoothedYaw = 0;
  private smoothedPitch = 0;
  private active = false;

  constructor(onRotate: (deltaYaw: number, deltaPitch: number) => void) {
    this.onRotate = onRotate;
  }

  start(): void {
    if (this.active || typeof window === 'undefined') return;
    this.active = true;
    this.previous = null;
    this.smoothedYaw = 0;
    this.smoothedPitch = 0;
    window.addEventListener('deviceorientation', this.handleOrientation, true);
  }

  stop(): void {
    if (!this.active || typeof window === 'undefined') return;
    this.active = false;
    this.previous = null;
    window.removeEventListener('deviceorientation', this.handleOrientation, true);
  }

  resetBaseline(): void {
    this.previous = null;
  }

  private readonly handleOrientation = (event: DeviceOrientationEvent): void => {
    if (!this.active || event.alpha === null || event.beta === null || event.gamma === null) {
      return;
    }

    const current = deviceOrientationToForwardAngles(event.alpha, event.beta, event.gamma);
    if (!this.previous) {
      this.previous = current;
      return;
    }

    const confidence = clamp(
      Math.min(this.previous.horizontalConfidence, current.horizontalConfidence) / 0.25,
      0,
      1,
    );
    const deltaAzimuth = wrapAngle(current.azimuth - this.previous.azimuth) * confidence;
    const deltaElevation = current.elevation - this.previous.elevation;
    this.previous = current;

    if (
      Math.abs(deltaAzimuth) > MAX_SINGLE_STEP_RAD
      || Math.abs(deltaElevation) > MAX_SINGLE_STEP_RAD
    ) {
      return;
    }

    // Turning right (+azimuth) looks right into the panorama (-yaw);
    // tilting up (+elevation) looks up (+pitch).
    this.smoothedYaw = this.smoothedYaw * 0.35 + (-deltaAzimuth) * 0.65;
    this.smoothedPitch = this.smoothedPitch * 0.35 + deltaElevation * 0.65;

    if (
      Math.abs(this.smoothedYaw) < JITTER_DEADZONE_RAD
      && Math.abs(this.smoothedPitch) < JITTER_DEADZONE_RAD
    ) {
      return;
    }

    this.onRotate(this.smoothedYaw, this.smoothedPitch);
  };
}
