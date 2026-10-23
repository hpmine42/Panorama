import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, type PanoramaCoverage, type ViewState } from '../types';
import {
  applyPanoramaPan,
  applyPanoramaZoomAround,
  clampPanoramaView,
  computeCameraParams,
  MIN_PANORAMA_ZOOM,
  screenToWorldAngles,
  wrapAngle,
} from './panoramaMath';

const FULL_SPHERE: PanoramaCoverage = {
  horizontalSpan: Math.PI * 2,
  verticalSpan: Math.PI,
  pitchCenter: 0,
  wrapsHorizontally: true,
  fromMetadata: false,
};

const SWEEP_4_TO_1: PanoramaCoverage = {
  horizontalSpan: 4.32,
  verticalSpan: 1.08,
  pitchCenter: 0,
  wrapsHorizontally: false,
  fromMetadata: false,
};

describe('panoramaMath', () => {
  it('keeps physical focal length identical between portrait and landscape mobile screens', () => {
    const portrait = computeCameraParams(390, 844, 1);
    const landscape = computeCameraParams(844, 390, 1);

    expect(portrait.focalPx).toBeCloseTo(landscape.focalPx, 4);
    // Portrait vertical FOV must stay natural (< 92°), never the old 140° rectilinear stretch.
    expect(portrait.vFov).toBeLessThan(1.62);
    expect(portrait.vFov).toBeGreaterThan(1.2);
  });

  it('smoothly expands FOV across the entire zoom-out range without clamping at zoom = 1', () => {
    const atZoomIn = computeCameraParams(390, 844, 1.5);
    const atNatural = computeCameraParams(390, 844, 1.0);
    const atMidOut = computeCameraParams(390, 844, 0.72);
    const atMinOut = computeCameraParams(390, 844, MIN_PANORAMA_ZOOM);

    expect(atNatural.vFov).toBeGreaterThan(atZoomIn.vFov);
    expect(atMidOut.vFov).toBeGreaterThan(atNatural.vFov);
    expect(atMinOut.vFov).toBeGreaterThan(atMidOut.vFov);

    // Check continuity across zoom = 1.
    const justBelowOne = computeCameraParams(390, 844, 0.999);
    const justAboveOne = computeCameraParams(390, 844, 1.001);
    expect(Math.abs(justBelowOne.vFov - justAboveOne.vFov)).toBeLessThan(0.005);
  });

  it('tracks fingertip movement 1:1 in direct-manipulation direction (right moves scene right, down moves scene down)', () => {
    const width = 390;
    const height = 844;
    const initial: ViewState = { ...DEFAULT_VIEW, zoom: 1.2 };
    const centerBefore = screenToWorldAngles(width / 2, height / 2, width, height, initial);
    expect(centerBefore.longitude).toBeCloseTo(0, 6);
    expect(centerBefore.latitude).toBeCloseTo(0, 6);

    // Drag finger +60px right and +40px down: the landmark that was at screen center (lon=0, lat=0)
    // must now appear at approximately (width/2 + 60, height/2 + 40).
    const panned: ViewState = { ...initial };
    applyPanoramaPan(panned, 60, 40, width, height, FULL_SPHERE);

    const underFingerAfter = screenToWorldAngles(
      width / 2 + 60,
      height / 2 + 40,
      width,
      height,
      panned,
    );
    expect(underFingerAfter.longitude).toBeCloseTo(0, 2);
    expect(underFingerAfter.latitude).toBeCloseTo(0, 2);
  });

  it('locks the 3D world point under an off-center pinch anchor while zooming in and out', () => {
    const width = 390;
    const height = 844;
    const anchorX = 295;
    const anchorY = 230;
    const view: ViewState = { ...DEFAULT_VIEW, yaw: 0.4, pitch: -0.22, zoom: 1.0 };

    const before = screenToWorldAngles(anchorX, anchorY, width, height, view);

    applyPanoramaZoomAround(view, 2.8, anchorX, anchorY, width, height, FULL_SPHERE);
    const afterZoomIn = screenToWorldAngles(anchorX, anchorY, width, height, view);
    expect(afterZoomIn.longitude).toBeCloseTo(before.longitude, 4);
    expect(afterZoomIn.latitude).toBeCloseTo(before.latitude, 4);

    applyPanoramaZoomAround(view, 0.58, anchorX, anchorY, width, height, FULL_SPHERE);
    const afterZoomOut = screenToWorldAngles(anchorX, anchorY, width, height, view);
    expect(afterZoomOut.longitude).toBeCloseTo(before.longitude, 4);
    expect(afterZoomOut.latitude).toBeCloseTo(before.latitude, 4);
  });

  it('wraps negative and positive yaw angles cleanly into [-π, π)', () => {
    expect(wrapAngle(-4.0)).toBeGreaterThanOrEqual(-Math.PI);
    expect(wrapAngle(-4.0)).toBeLessThan(Math.PI);
    expect(wrapAngle(-4.0)).toBeCloseTo(2 * Math.PI - 4.0, 6);
    expect(wrapAngle(4.0)).toBeCloseTo(4.0 - 2 * Math.PI, 6);
  });

  it('clamps partial mobile sweep panoramas cleanly without vertical wobble in portrait and unlocks when zoomed in', () => {
    const viewAtDefault: ViewState = { ...DEFAULT_VIEW, yaw: 5, pitch: 0.6, zoom: 1 };
    clampPanoramaView(viewAtDefault, SWEEP_4_TO_1, 390, 844);

    // At zoom=1 on portrait (vFov ~1.45 > vSpan 1.08), vertical pitch stays steady at horizon.
    expect(viewAtDefault.pitch).toBeCloseTo(0, 5);
    // Horizontal yaw clamps within the 4.32 rad sweep minus visible half-horizontal FOV.
    expect(viewAtDefault.yaw).toBeGreaterThan(1.4);
    expect(viewAtDefault.yaw).toBeLessThan(SWEEP_4_TO_1.horizontalSpan * 0.5);

    // Zooming in beyond vertical height unlocks vertical panning.
    const zoomedIn: ViewState = { ...DEFAULT_VIEW, yaw: 0, pitch: 0.2, zoom: 2.2 };
    clampPanoramaView(zoomedIn, SWEEP_4_TO_1, 390, 844);
    expect(zoomedIn.pitch).toBeGreaterThan(0.1);

    // Zooming back out from a corner settles cleanly inside valid bounds.
    applyPanoramaZoomAround(zoomedIn, 1.0, 320, 180, 390, 844, SWEEP_4_TO_1);
    expect(zoomedIn.pitch).toBeCloseTo(0, 5);
    expect(Math.abs(zoomedIn.yaw)).toBeLessThan(SWEEP_4_TO_1.horizontalSpan * 0.5);
  });
});
