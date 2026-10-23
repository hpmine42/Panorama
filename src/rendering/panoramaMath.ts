import type { PanoramaCoverage, ViewState } from '../types';

export const MIN_NORMAL_ZOOM = 0.55;
export const MIN_PANORAMA_ZOOM = 0.45;
export const MAX_ZOOM = 6;
export const MAX_PITCH = 1.48;

const TWO_PI = Math.PI * 2;
/** Natural ~92° diagonal field of view at zoom = 1 (equivalent to ~22mm mobile wide lens). */
const BASE_DIAG_HALF_ANGLE = 0.80;
const ZOOM_OUT_ANGLE_SLOPE = 1.21;

export interface CameraParams {
  aspect: number;
  vFov: number;
  vHalfTan: number;
  curvature: number;
  focalPx: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function wrapAngle(radians: number): number {
  return ((((radians + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

function normalize3(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * Orientation-invariant camera parameters. Because diagonal FOV is preserved
 * across 90° screen rotations, features keep the exact same physical scale on
 * mobile portrait and landscape screens without vertical rectilinear stretching.
 */
export function computeCameraParams(
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): CameraParams {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const aspect = width / height;
  const diag = Math.hypot(aspect, 1);
  const clampedZoom = clamp(zoom, MIN_PANORAMA_ZOOM, MAX_ZOOM);

  const baseDiagHalfTan = Math.tan(BASE_DIAG_HALF_ANGLE);
  const diagHalfAngle = clampedZoom >= 1
    ? Math.atan(baseDiagHalfTan / clampedZoom)
    : clamp(BASE_DIAG_HALF_ANGLE + (1 - clampedZoom) * ZOOM_OUT_ANGLE_SLOPE, 0.05, 1.48);
  const diagHalfTan = clampedZoom >= 1
    ? baseDiagHalfTan / clampedZoom
    : Math.tan(diagHalfAngle);

  const vHalfAngle = diagHalfAngle / diag;
  const vFov = vHalfAngle * 2;
  const vHalfTan = diagHalfTan / diag;
  const curvature = clamp((1.06 - clampedZoom) / 0.5, 0, 1);

  const centerAngularScale = vHalfTan * (1 - curvature) + vHalfAngle * curvature;
  const focalPx = (height * 0.5) / Math.max(centerAngularScale, 1e-4);

  return {
    aspect,
    vFov,
    vHalfTan,
    curvature,
    focalPx,
  };
}

/** Exact CPU counterpart of the fragment shader's local camera ray construction. */
export function computeLocalCameraRay(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): Vec3 {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const { aspect, vFov, vHalfTan, curvature } = computeCameraParams(width, height, zoom);

  const normalizedX = (screenX / width) * 2 - 1;
  const normalizedY = 1 - (screenY / height) * 2;
  const sx = normalizedX * aspect;
  const sy = normalizedY;

  const rect = normalize3(sx * vHalfTan, sy * vHalfTan, -1);

  const radius = Math.hypot(sx, sy);
  const lensAngle = radius * (vFov * 0.5);
  const fish = radius > 1e-5
    ? {
      x: (sx / radius) * Math.sin(lensAngle),
      y: (sy / radius) * Math.sin(lensAngle),
      z: -Math.cos(lensAngle),
    }
    : { x: 0, y: 0, z: -1 };

  return normalize3(
    rect.x + (fish.x - rect.x) * curvature,
    rect.y + (fish.y - rect.y) * curvature,
    rect.z + (fish.z - rect.z) * curvature,
  );
}

export function rotateX(ray: Vec3, angle: number): Vec3 {
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  return {
    x: ray.x,
    y: ray.y * cosine - ray.z * sine,
    z: ray.y * sine + ray.z * cosine,
  };
}

export function rotateY(ray: Vec3, angle: number): Vec3 {
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  return {
    x: ray.x * cosine + ray.z * sine,
    y: ray.y,
    z: -ray.x * sine + ray.z * cosine,
  };
}

export function screenToWorldAngles(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  view: ViewState,
): { longitude: number; latitude: number } {
  const local = computeLocalCameraRay(screenX, screenY, viewportWidth, viewportHeight, view.zoom);
  const world = rotateY(rotateX(local, view.pitch), view.yaw);
  return {
    longitude: Math.atan2(world.x, -world.z),
    latitude: Math.asin(clamp(world.y, -1, 1)),
  };
}

export function clampPanoramaView(
  view: ViewState,
  coverage: PanoramaCoverage,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  view.zoom = clamp(view.zoom, MIN_PANORAMA_ZOOM, MAX_ZOOM);

  const rightEdgeRay = computeLocalCameraRay(width, height * 0.5, width, height, view.zoom);
  const topEdgeRay = computeLocalCameraRay(width * 0.5, 0, width, height, view.zoom);
  const halfVisibleH = Math.abs(Math.atan2(rightEdgeRay.x, -rightEdgeRay.z));
  const halfVisibleV = Math.abs(Math.atan2(topEdgeRay.y, -topEdgeRay.z));

  if (coverage.verticalSpan >= Math.PI - 0.02) {
    view.pitch = clamp(view.pitch, -MAX_PITCH, MAX_PITCH);
  } else {
    const maxPitchDelta = Math.max(0, coverage.verticalSpan * 0.5 - halfVisibleV);
    const minPitch = clamp(coverage.pitchCenter - maxPitchDelta, -MAX_PITCH, MAX_PITCH);
    const maxPitch = clamp(coverage.pitchCenter + maxPitchDelta, -MAX_PITCH, MAX_PITCH);
    view.pitch = clamp(view.pitch, minPitch, maxPitch);
  }

  if (coverage.wrapsHorizontally) {
    view.yaw = wrapAngle(view.yaw);
  } else {
    const maxYaw = Math.max(0, coverage.horizontalSpan * 0.5 - halfVisibleH);
    view.yaw = clamp(view.yaw, -maxYaw, maxYaw);
  }
}

/**
 * Direct-manipulation 1-finger pan: dragging right (+deltaX) moves visible scene
 * content right (+yaw), and dragging down (+deltaY) moves visible content down (+pitch)
 * at exact 1:1 fingertip pixel speed regardless of portrait or landscape orientation.
 */
export function applyPanoramaPan(
  view: ViewState,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
  coverage: PanoramaCoverage,
): void {
  if (viewportWidth <= 1 || viewportHeight <= 1) return;
  const { focalPx } = computeCameraParams(viewportWidth, viewportHeight, view.zoom);
  const cosPitch = Math.max(0.3, Math.cos(view.pitch));

  view.yaw += deltaX / (focalPx * cosPitch);
  view.pitch += deltaY / focalPx;
  clampPanoramaView(view, coverage, viewportWidth, viewportHeight);
}

/**
 * Keeps the exact 3D spherical point under (anchorX, anchorY) stationary while
 * changing zoom, accounting for perspective, pitch coupling, and fisheye curvature.
 */
export function applyPanoramaZoomAround(
  view: ViewState,
  nextZoom: number,
  anchorX: number,
  anchorY: number,
  viewportWidth: number,
  viewportHeight: number,
  coverage: PanoramaCoverage,
): void {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const targetZoom = clamp(nextZoom, MIN_PANORAMA_ZOOM, MAX_ZOOM);

  const { longitude: targetLon, latitude: targetLat } = screenToWorldAngles(
    anchorX,
    anchorY,
    width,
    height,
    view,
  );

  const nextLocal = computeLocalCameraRay(anchorX, anchorY, width, height, targetZoom);
  const ryz = Math.hypot(nextLocal.y, nextLocal.z);
  const phi = Math.atan2(nextLocal.y, -nextLocal.z);
  const sinSum = clamp(Math.sin(targetLat) / Math.max(ryz, 1e-5), -1, 1);
  const solvedPitch = clamp(Math.asin(sinSum) - phi, -MAX_PITCH, MAX_PITCH);

  const pitchedRay = rotateX(nextLocal, solvedPitch);
  const pitchedLon = Math.atan2(pitchedRay.x, -pitchedRay.z);

  view.zoom = targetZoom;
  view.pitch = solvedPitch;
  view.yaw = wrapAngle(pitchedLon - targetLon);
  clampPanoramaView(view, coverage, width, height);
}

export function getNormalDisplaySize(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): { width: number; height: number } {
  const imageAspect = imageWidth / Math.max(imageHeight, 1);
  const viewportAspect = viewportWidth / Math.max(viewportHeight, 1);
  const baseWidth = imageAspect >= viewportAspect ? 1 : imageAspect / viewportAspect;
  const baseHeight = imageAspect >= viewportAspect ? viewportAspect / imageAspect : 1;
  return { width: baseWidth * zoom, height: baseHeight * zoom };
}

export function clampNormalOffsets(
  view: ViewState,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  view.zoom = clamp(view.zoom, MIN_NORMAL_ZOOM, MAX_ZOOM);
  const display = getNormalDisplaySize(imageWidth, imageHeight, viewportWidth, viewportHeight, view.zoom);
  const maxOffsetX = Math.max(0, (display.width - 1) / 2);
  const maxOffsetY = Math.max(0, (display.height - 1) / 2);
  view.offsetX = clamp(view.offsetX, -maxOffsetX, maxOffsetX);
  view.offsetY = clamp(view.offsetY, -maxOffsetY, maxOffsetY);
}

export function applyNormalZoomAround(
  view: ViewState,
  nextZoom: number,
  anchorX: number,
  anchorY: number,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const targetZoom = clamp(nextZoom, MIN_NORMAL_ZOOM, MAX_ZOOM);
  const oldDisplay = getNormalDisplaySize(imageWidth, imageHeight, width, height, view.zoom);
  const nextDisplay = getNormalDisplaySize(imageWidth, imageHeight, width, height, targetZoom);
  const pointX = anchorX / width - 0.5;
  const pointY = anchorY / height - 0.5;
  const ratioX = nextDisplay.width / Math.max(oldDisplay.width, 1e-4);
  const ratioY = nextDisplay.height / Math.max(oldDisplay.height, 1e-4);

  view.offsetX = pointX - (pointX - view.offsetX) * ratioX;
  view.offsetY = pointY - (pointY - view.offsetY) * ratioY;
  view.zoom = targetZoom;
  clampNormalOffsets(view, imageWidth, imageHeight, width, height);
}
