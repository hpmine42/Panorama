import { useEffect, useRef, useState } from 'react';
import type { ImageAsset, ViewState, ViewportSize } from '../types';
import { DEFAULT_VIEW } from '../types';
import { GestureController } from '../gestures/GestureController';
import { BackgroundRenderer, type BackgroundRendererHandle } from '../rendering/BackgroundRenderer';
import { PanoramaRenderer } from '../rendering/PanoramaRenderer';
import { Icon } from './Icon';
import { ViewerControls } from './ViewerControls';

interface PanoramaViewerProps {
  asset: ImageAsset;
  onClose(): void;
  onOpenAnother(): void;
}

type Inertia = { x: number; y: number };
type ZoomAnimation = {
  start: ViewState;
  targetZoom: number;
  anchorX: number;
  anchorY: number;
  startedAt: number;
};

const MIN_NORMAL_ZOOM = 0.55;
const MAX_ZOOM = 5;
const MIN_PANORAMA_ZOOM = 0.65;
const MAX_PITCH = 1.34;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function cloneView(view: ViewState): ViewState {
  return { ...view };
}

export function PanoramaViewer({ asset, onClose, onOpenAnother }: PanoramaViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<BackgroundRendererHandle>(null);
  const rendererRef = useRef<PanoramaRenderer | null>(null);
  const gestureRef = useRef<GestureController | null>(null);
  const assetRef = useRef(asset);
  const viewRef = useRef<ViewState>(cloneView(DEFAULT_VIEW));
  const sizeRef = useRef<ViewportSize>({ width: 1, height: 1, dpr: 1 });
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const inertiaRef = useRef<Inertia>({ x: 0, y: 0 });
  const zoomAnimationRef = useRef<ZoomAnimation | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);

  assetRef.current = asset;

  const getNormalDisplaySize = (zoom: number): { width: number; height: number } => {
    const currentAsset = assetRef.current;
    const viewport = sizeRef.current;
    const imageAspect = currentAsset.width / Math.max(currentAsset.height, 1);
    const viewportAspect = viewport.width / Math.max(viewport.height, 1);
    const baseWidth = imageAspect >= viewportAspect ? 1 : imageAspect / viewportAspect;
    const baseHeight = imageAspect >= viewportAspect ? viewportAspect / imageAspect : 1;
    return { width: baseWidth * zoom, height: baseHeight * zoom };
  };

  const clampNormalOffsets = (view: ViewState): void => {
    const display = getNormalDisplaySize(view.zoom);
    const maxOffsetX = Math.max(0, (display.width - 1) / 2);
    const maxOffsetY = Math.max(0, (display.height - 1) / 2);
    view.offsetX = clamp(view.offsetX, -maxOffsetX, maxOffsetX);
    view.offsetY = clamp(view.offsetY, -maxOffsetY, maxOffsetY);
  };

  const panoramaFov = (zoom: number): number => (
    clamp((Math.PI * 0.82) / Math.max(zoom, 0.05), 0.24, 2.45)
  );

  const applyPan = (deltaX: number, deltaY: number): void => {
    const currentAsset = assetRef.current;
    const view = viewRef.current;
    const { width, height } = sizeRef.current;
    if (width <= 1 || height <= 1) return;

    if (currentAsset.mode === 'panorama') {
      const fov = panoramaFov(view.zoom);
      // Negative X follows a leftward finger movement: the sampled panorama
      // moves left, while the camera rotates naturally through the scene.
      view.yaw -= (deltaX / width) * fov * 1.08;
      view.pitch += (deltaY / height) * fov * 0.78;
      view.pitch = clamp(view.pitch, -MAX_PITCH, MAX_PITCH);
      if (view.yaw > Math.PI || view.yaw < -Math.PI) {
        view.yaw = ((view.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      }
    } else {
      view.offsetX += deltaX / width;
      view.offsetY += deltaY / height;
      clampNormalOffsets(view);
    }
  };

  const applyZoomAround = (nextZoom: number, anchorX: number, anchorY: number): void => {
    const currentAsset = assetRef.current;
    const view = viewRef.current;
    const { width, height } = sizeRef.current;
    const minimum = currentAsset.mode === 'panorama' ? MIN_PANORAMA_ZOOM : MIN_NORMAL_ZOOM;
    const targetZoom = clamp(nextZoom, minimum, MAX_ZOOM);
    const oldZoom = view.zoom;

    if (currentAsset.mode === 'panorama') {
      const aspect = width / Math.max(height, 1);
      const oldFov = panoramaFov(oldZoom);
      const nextFov = panoramaFov(targetZoom);
      const screenX = (anchorX / Math.max(width, 1) - 0.5) * 2;
      const screenUp = (0.5 - anchorY / Math.max(height, 1)) * 2;
      const oldHorizontalAngle = Math.atan(screenX * aspect * Math.tan(oldFov / 2));
      const nextHorizontalAngle = Math.atan(screenX * aspect * Math.tan(nextFov / 2));
      const oldVerticalAngle = Math.atan(screenUp * Math.tan(oldFov / 2));
      const nextVerticalAngle = Math.atan(screenUp * Math.tan(nextFov / 2));
      // Preserve the ray beneath the pinch centre while the field of view
      // changes. This is the same anchor correction used by a camera lens.
      view.yaw += oldHorizontalAngle - nextHorizontalAngle;
      view.pitch += oldVerticalAngle - nextVerticalAngle;
      view.pitch = clamp(view.pitch, -MAX_PITCH, MAX_PITCH);
      view.zoom = targetZoom;
      return;
    }

    const oldDisplay = getNormalDisplaySize(oldZoom);
    const nextDisplay = getNormalDisplaySize(targetZoom);
    const pointX = anchorX / Math.max(width, 1) - 0.5;
    const pointY = anchorY / Math.max(height, 1) - 0.5;
    const ratioX = nextDisplay.width / Math.max(oldDisplay.width, 0.0001);
    const ratioY = nextDisplay.height / Math.max(oldDisplay.height, 0.0001);
    view.offsetX = pointX - (pointX - view.offsetX) * ratioX;
    view.offsetY = pointY - (pointY - view.offsetY) * ratioY;
    view.zoom = targetZoom;
    clampNormalOffsets(view);
  };

  const scheduleFrame = (): void => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame(renderFrame);
  };

  function renderFrame(timestamp: number): void {
    animationFrameRef.current = null;
    const lastTimestamp = lastFrameTimeRef.current ?? timestamp;
    const deltaSeconds = Math.min(0.05, Math.max(0, (timestamp - lastTimestamp) / 1000));
    lastFrameTimeRef.current = timestamp;
    let keepAnimating = false;

    const inertia = inertiaRef.current;
    if (Math.abs(inertia.x) > 1 || Math.abs(inertia.y) > 1) {
      applyPan(inertia.x * deltaSeconds, inertia.y * deltaSeconds);
      const friction = Math.exp(-5.8 * deltaSeconds);
      inertia.x *= friction;
      inertia.y *= friction;
      keepAnimating = true;
    } else {
      inertia.x = 0;
      inertia.y = 0;
    }

    const zoomAnimation = zoomAnimationRef.current;
    if (zoomAnimation) {
      const progress = clamp((timestamp - zoomAnimation.startedAt) / 280, 0, 1);
      const eased = easeOutCubic(progress);
      viewRef.current = cloneView(zoomAnimation.start);
      applyZoomAround(
        zoomAnimation.start.zoom + (zoomAnimation.targetZoom - zoomAnimation.start.zoom) * eased,
        zoomAnimation.anchorX,
        zoomAnimation.anchorY,
      );
      if (progress >= 1) {
        zoomAnimationRef.current = null;
      } else {
        keepAnimating = true;
      }
    }

    const currentAsset = assetRef.current;
    rendererRef.current?.render(viewRef.current);
    backgroundRef.current?.update(
      viewRef.current,
      currentAsset,
      sizeRef.current.width,
      sizeRef.current.height,
    );

    if (keepAnimating) {
      animationFrameRef.current = requestAnimationFrame(renderFrame);
    } else {
      lastFrameTimeRef.current = null;
    }
  }

  const startZoomAnimation = (targetZoom: number, anchorX?: number, anchorY?: number): void => {
    inertiaRef.current = { x: 0, y: 0 };
    zoomAnimationRef.current = {
      start: cloneView(viewRef.current),
      targetZoom,
      anchorX: anchorX ?? sizeRef.current.width / 2,
      anchorY: anchorY ?? sizeRef.current.height / 2,
      startedAt: performance.now(),
    };
    scheduleFrame();
  };

  const resetView = (): void => {
    inertiaRef.current = { x: 0, y: 0 };
    zoomAnimationRef.current = null;
    viewRef.current = cloneView(DEFAULT_VIEW);
    scheduleFrame();
  };

  const zoomIn = (): void => {
    startZoomAnimation(Math.min(MAX_ZOOM, viewRef.current.zoom * 1.35));
  };

  const zoomOut = (): void => {
    const minimum = assetRef.current.mode === 'panorama' ? MIN_PANORAMA_ZOOM : MIN_NORMAL_ZOOM;
    startZoomAnimation(Math.max(minimum, viewRef.current.zoom / 1.35));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return undefined;

    let renderer: PanoramaRenderer;
    try {
      renderer = new PanoramaRenderer(canvas);
      rendererRef.current = renderer;
    } catch (error) {
      setRendererError(error instanceof Error ? error.message : 'WebGL konnte nicht gestartet werden.');
      return undefined;
    }

    const updateSize = (): void => {
      const rect = stage.getBoundingClientRect();
      const nextSize: ViewportSize = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        dpr: Math.min(window.devicePixelRatio || 1, 2.5),
      };
      sizeRef.current = nextSize;
      renderer.resize(nextSize);
      clampNormalOffsets(viewRef.current);
      scheduleFrame();
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    updateSize();

    gestureRef.current = new GestureController(canvas, {
      onPan(deltaX, deltaY) {
        inertiaRef.current = { x: 0, y: 0 };
        zoomAnimationRef.current = null;
        applyPan(deltaX, deltaY);
        scheduleFrame();
      },
      onPanEnd(velocityX, velocityY) {
        if (Math.hypot(velocityX, velocityY) > 45) {
          inertiaRef.current = { x: velocityX, y: velocityY };
          scheduleFrame();
        }
      },
      onPinch(scale, centerX, centerY, deltaX, deltaY) {
        inertiaRef.current = { x: 0, y: 0 };
        zoomAnimationRef.current = null;
        applyPan(deltaX, deltaY);
        applyZoomAround(viewRef.current.zoom * clamp(scale, 0.75, 1.33), centerX, centerY);
        scheduleFrame();
      },
      onPinchEnd() {
        inertiaRef.current = { x: 0, y: 0 };
      },
      onDoubleTap(x, y) {
        const target = viewRef.current.zoom > 1.15 ? 1 : assetRef.current.mode === 'panorama' ? 2 : 2.25;
        startZoomAnimation(target, x, y);
      },
      onWheel(deltaY, x, y) {
        const factor = Math.exp(-deltaY * 0.0012);
        applyZoomAround(viewRef.current.zoom * factor, x, y);
        scheduleFrame();
      },
    });

    return () => {
      observer.disconnect();
      gestureRef.current?.destroy();
      gestureRef.current = null;
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
    };
    // This viewer instance is intentionally tied to the canvas lifecycle.
    // Asset changes are handled by the effect below without rebuilding WebGL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    assetRef.current = asset;
    viewRef.current = cloneView(DEFAULT_VIEW);
    inertiaRef.current = { x: 0, y: 0 };
    zoomAnimationRef.current = null;
    try {
      rendererRef.current?.setImage(asset);
      setRendererError(null);
    } catch (error) {
      setRendererError(error instanceof Error ? error.message : 'Bild konnte nicht auf die GPU geladen werden.');
    }
    scheduleFrame();
  }, [asset]);

  const toggleFullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (stageRef.current?.requestFullscreen) {
        await stageRef.current.requestFullscreen();
      }
    } catch {
      // Fullscreen is optional and can be denied by an embedding browser.
    }
  };

  return (
    <section
      ref={stageRef}
      className="viewer-stage"
      aria-label="Panorama Viewer"
      onDragStart={(event) => event.preventDefault()}
    >
      <BackgroundRenderer ref={backgroundRef} asset={asset} />
      <canvas ref={canvasRef} className="viewer-canvas" aria-label="Interaktives Foto" />
      <div className="viewer-vignette" aria-hidden="true" />
      <ViewerControls
        name={asset.name}
        mode={asset.mode}
        onClose={onClose}
        onOpenAnother={onOpenAnother}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
        onReset={resetView}
        onFullscreen={toggleFullscreen}
      />
      {rendererError && (
        <div className="viewer-error" role="alert">
          <Icon name="image" size={24} />
          <strong>Bilddarstellung nicht verfügbar</strong>
          <span>{rendererError}</span>
        </div>
      )}
    </section>
  );
}
