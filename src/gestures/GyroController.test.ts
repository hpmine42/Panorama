import { describe, expect, it } from 'vitest';
import { deviceOrientationToForwardAngles } from './GyroController';

describe('GyroController 3D orientation math', () => {
  it('avoids gimbal lock when holding phone upright at the horizon in portrait (beta = 90°)', () => {
    const facingNorth = deviceOrientationToForwardAngles(0, 90, 0);
    expect(facingNorth.elevation).toBeCloseTo(0, 5);
    expect(facingNorth.horizontalConfidence).toBeCloseTo(1, 5);
    expect(facingNorth.azimuth).toBeCloseTo(0, 5);

    // Turning 45° clockwise (alpha decreases by 45° in W3C ENU) increases compass azimuth by +45°.
    const turnedRight = deviceOrientationToForwardAngles(315, 90, 0);
    expect(turnedRight.elevation).toBeCloseTo(0, 5);
    expect(turnedRight.azimuth).toBeCloseTo(Math.PI / 4, 5);
  });

  it('tracks horizon smoothly when holding phone upright in landscape (beta = 0°, gamma = -90°)', () => {
    const landscapeHorizon = deviceOrientationToForwardAngles(0, 0, -90);
    expect(landscapeHorizon.elevation).toBeCloseTo(0, 5);
    expect(landscapeHorizon.horizontalConfidence).toBeCloseTo(1, 5);
  });

  it('reports positive elevation when tilting phone upward toward the sky', () => {
    const tiltedUp = deviceOrientationToForwardAngles(0, 120, 0);
    expect(tiltedUp.elevation).toBeCloseTo(Math.PI / 6, 4);

    const tiltedDown = deviceOrientationToForwardAngles(0, 60, 0);
    expect(tiltedDown.elevation).toBeCloseTo(-Math.PI / 6, 4);
  });
});
