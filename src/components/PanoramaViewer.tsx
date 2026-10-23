import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ImageAsset,
  PanoramaCoverage,
  ProjectionMode,
  ViewerMode,
  ViewState,
  ViewportSize,
} from '../types';
import { DEFAULT_VIEW } from '../types';
import { GestureController } from '../gestures/GestureController';
import { GyroController, isGyroSupported, requestGyroPermission } from '../gestures/GyroController';
import { BackgroundRenderer, type BackgroundRendererHandle } from '../rendering/BackgroundRenderer';
import {
  applyNormalZoomAround,
  applyPanoramaPan,
  applyPanoramaZoomAround,
  clamp,
  clampNormalOffsets,
  clampPanoramaView,
  MAX_ZOOM,
  MIN_NORMAL_ZOOM,
  MIN_PANORAMA_ZOOM,
} from '../rendering/panoramaMath';
import { PanoramaRenderer } from '../rendering/PanoramaRenderer';
import { getCoverageForProjectionMode } from '../utils/panoramaMetadata';
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

type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function cloneView(view: ViewState): ViewState {
  return { ...view };
}

function getAvailableModes(asset: ImageAsset): ProjectionMode[] {
  const aspect = asset.width / Math.max(asset.height, 1);
  if (asset.coverage.wrapsHorizontally) {
    return ['panorama', 'image'];
  }
  if (asset.mode === 'panorama') {
    return ['panorama', 'panorama360', 'image'];
  }
  if (aspect >= 1.45) {
    return ['image', 'panorama'];
  }
  return ['image'];
}

function toViewerMode(projectionMode: ProjectionMode): ViewerMode {
  return projectionMode === 'image' ? 'image' : 'panorama';
}

export function PanoramaViewer({ asset, onClose, onOpenAnother }: PanoramaViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<BackgroundRendererHandle>(null);
  const rendererRef = useRef<PanoramaRenderer | null>(null);
  const gestureRef = useRef<GestureController | null>(null);
  const gyroRef = useRef<GyroController | null>(null);
  const assetRef = useRef(asset);
  const projectionModeRef = useRef<ProjectionMode>(asset.mode === 'panorama' ? 'panorama' : 'image');
  const viewRef = useRef<ViewState>(cloneView(DEFAULT_VIEW));
  const sizeRef = useRef<ViewportSize>({ width: 1, height: 1, dpr: 1 });
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const inertiaRef = useRef<Inertia>({ x: 0, y: 0 });
  const zoomAnimationRef = useRef<ZoomAnimation | null>(null);

  const [projectionMode, setProjectionMode] = useState<ProjectionMode>(
    asset.mode === 'panorama' ? 'panorama' : 'image',
  );
  const [controlsHidden, setControlsHidden] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [gyroActive, setGyroActive] = useState(false);
  const [rendererError, setRendererError] = useState<string | null>(null);

  const gyroAvailable = useMemo(() => isGyroSupported(), []);
  const availableModes = useMemo(() => getAvailableModes(asset), [asset]);
  const activeCoverage = useMemo(
    () => getCoverageForProjectionMode(asset.width, asset.height, asset.coverage, projectionMode),
    [asset, projectionMode],
  );

  assetRef.current = asset;
  projectionModeRef.current = projectionMode;

  const getCurrentCoverage = (): PanoramaCoverage => {
    const current = assetRef.current;
    return getCoverageForProjectionMode(
      current.width,
      current.height,
      current.coverage,
      projectionModeRef.current,
    );
  };

  const clampActiveView = (view: ViewState): void => {
    const current = assetRef.current;
    const { width, height } = sizeRef.current;
    if (toViewerMode(projectionModeRef.current) === 'panorama') {
      clampPanoramaView(view, getCurrentCoverage(), width, height);
    } else {
      clampNormalOffsets(view, current.width, current.height, width, height);
    }
  };

  const applyPan = (deltaX: number, deltaY: number): void => {
    const current = assetRef.current;
    const view = viewRef.current;
    const { width, height } = sizeRef.current;
    if (width <= 1 || height <= 1) return;

    if (toViewerMode(projectionModeRef.current) === 'panorama') {
      applyPanoramaPan(view, deltaX, deltaY, width, height, getCurrentCoverage());
    } else {
      view.offsetX += deltaX / width;
      view.offsetY += deltaY / height;
      clampNormalOffsets(view, current.width, current.height, width, height);
    }
  };

  const applyZoomAround = (nextZoom: number, anchorX: number, anchorY: number): void => {
    const current = assetRef.current;
    const view = viewRef.current;
    const { width, height } = sizeRef.current;

    if (toViewerMode(projectionModeRef.current) === 'panorama') {
      applyPanoramaZoomAround(
        view,
        nextZoom,
        anchorX,
        anchorY,
        width,
        height,
        getCurrentCoverage(),
      );
    } else {
      applyNormalZoomAround(
        view,
        nextZoom,
        anchorX,
        anchorY,
        current.width,
        current.height,
        width,
        height,
      );
    }
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
      const progress = clamp((timestamp - zoomAnimation.startedAt) / 260, 0, 1);
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

    const mode = toViewerMode(projectionModeRef.current);
    const coverage = getCurrentCoverage();
    rendererRef.current?.render(viewRef.current, mode, coverage);
    backgroundRef.current?.update(
      viewRef.current,
      mode,
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
    clampActiveView(viewRef.current);
    gyroRef.current?.resetBaseline();
    scheduleFrame();
  };

  const zoomIn = (): void => {
    startZoomAnimation(Math.min(MAX_ZOOM, viewRef.current.zoom * 1.38));
  };

  const zoomOut = (): void => {
    const minimum = toViewerMode(projectionModeRef.current) === 'panorama'
      ? MIN_PANORAMA_ZOOM
      : MIN_NORMAL_ZOOM;
    startZoomAnimation(Math.max(minimum, viewRef.current.zoom / 1.38));
  };

  const cycleMode = (): void => {
    if (availableModes.length <= 1) return;
    const currentIndex = availableModes.indexOf(projectionModeRef.current);
    const nextMode = availableModes[(currentIndex + 1) % availableModes.length];
    projectionModeRef.current = nextMode;
    setProjectionMode(nextMode);
    if (nextMode === 'image' && gyroRef.current) {
      gyroRef.current.stop();
      setGyroActive(false);
    }
    inertiaRef.current = { x: 0, y: 0 };
    zoomAnimationRef.current = null;
    viewRef.current = cloneView(DEFAULT_VIEW);
    clampActiveView(viewRef.current);
    scheduleFrame();
  };

  const toggleGyro = async (): Promise<void> => {
    if (!gyroAvailable) return;
    if (gyroActive) {
      gyroRef.current?.stop();
      setGyroActive(false);
      return;
    }
    const granted = await requestGyroPermission();
    if (!granted) return;

    if (!gyroRef.current) {
      gyroRef.current = new GyroController((deltaYaw, deltaPitch) => {
        if (toViewerMode(projectionModeRef.current) !== 'panorama') return;
        const view = viewRef.current;
        const { width, height } = sizeRef.current;
        view.yaw += deltaYaw;
        view.pitch += deltaPitch;
        clampPanoramaView(view, getCurrentCoverage(), width, height);
        scheduleFrame();
      });
    }
    gyroRef.current.start();
    setGyroActive(true);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return undefined;

    let renderer: PanoramaRenderer;
    try {
      renderer = new PanoramaRenderer(canvas, () => {
        scheduleFrame();
      });
      rendererRef.current = renderer;
    } catch (error) {
      setRendererError(error instanceof Error ? error.message : 'WebGL konnte nicht gestartet werden.');
      return undefined;
    }

    let orientationRaf: number | null = null;
    const updateSize = (): void => {
      const rect = stage.getBoundingClientRect();
      const nextSize: ViewportSize = {
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        dpr: Math.min(window.devicePixelRatio || 1, 2.5),
      };
      sizeRef.current = nextSize;
      renderer.resize(nextSize);
      clampActiveView(viewRef.current);
      scheduleFrame();
    };

    const handleOrientationOrViewport = (): void => {
      updateSize();
      if (orientationRaf !== null) cancelAnimationFrame(orientationRaf);
      orientationRaf = requestAnimationFrame(() => {
        orientationRaf = null;
        updateSize();
      });
    };

    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    window.visualViewport?.addEventListener('resize', handleOrientationOrViewport);
    window.addEventListener('orientationchange', handleOrientationOrViewport);
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
        applyZoomAround(viewRef.current.zoom * clamp(scale, 0.72, 1.38), centerX, centerY);
        scheduleFrame();
      },
      onPinchEnd() {
        inertiaRef.current = { x: 0, y: 0 };
        gyroRef.current?.resetBaseline();
      },
      onDoubleTap(x, y) {
        const isPanorama = toViewerMode(projectionModeRef.current) === 'panorama';
        const target = Math.abs(viewRef.current.zoom - 1) > 0.15 ? 1 : isPanorama ? 2.1 : 2.4;
        startZoomAnimation(target, x, y);
      },
      onSingleTap() {
        setControlsHidden((previous) => !previous);
      },
      onWheel(deltaY, x, y) {
        const factor = Math.exp(-deltaY * 0.0012);
        applyZoomAround(viewRef.current.zoom * factor, x, y);
        scheduleFrame();
      },
    });

    const syncFullscreenState = (): void => {
      const doc = document as WebkitFullscreenDocument;
      const active = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
      setNativeFullscreen(active);
      handleOrientationOrViewport();
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);

    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', handleOrientationOrViewport);
      window.removeEventListener('orientationchange', handleOrientationOrViewport);
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
      if (orientationRaf !== null) cancelAnimationFrame(orientationRaf);
      gestureRef.current?.destroy();
      gestureRef.current = null;
      gyroRef.current?.stop();
      gyroRef.current = null;
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
    };
    // Tied to canvas mount lifecycle; asset changes are applied in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const initialMode: ProjectionMode = asset.mode === 'panorama' ? 'panorama' : 'image';
    assetRef.current = asset;
    projectionModeRef.current = initialMode;
    setProjectionMode(initialMode);
    setControlsHidden(false);
    if (initialMode === 'image' && gyroRef.current) {
      gyroRef.current.stop();
      setGyroActive(false);
    }

    viewRef.current = cloneView(DEFAULT_VIEW);
    inertiaRef.current = { x: 0, y: 0 };
    zoomAnimationRef.current = null;

    try {
      rendererRef.current?.setImage(asset);
      setRendererError(null);
    } catch (error) {
      setRendererError(error instanceof Error ? error.message : 'Bild konnte nicht auf die GPU geladen werden.');
    }
    clampActiveView(viewRef.current);
    scheduleFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  const toggleFullscreen = async (): Promise<void> => {
    const doc = document as WebkitFullscreenDocument;
    const stage = stageRef.current as WebkitFullscreenElement | null;
    try {
      if (doc.fullscreenElement) {
        await doc.exitFullscreen();
        return;
      }
      if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
        return;
      }
      if (stage?.requestFullscreen) {
        await stage.requestFullscreen();
        return;
      }
      if (stage?.webkitRequestFullscreen) {
        await stage.webkitRequestFullscreen();
        return;
      }
    } catch {
      // Fall back to immersive HUD-free mode when fullscreen is denied or unsupported.
    }
    setControlsHidden((previous) => !previous);
  };

  const effectiveFullscreen = nativeFullscreen || controlsHidden;

  return (
    <section
      ref={stageRef}
      className="viewer-stage"
      aria-label="Panorama Viewer"
      onDragStart={(event) => event.preventDefault()}
    >
      <BackgroundRenderer ref={backgroundRef} asset={asset} />
      {rendererError && (
        <img
          className="viewer-image-fallback"
          src={asset.url}
          alt={asset.name}
          draggable={false}
        />
      )}
      <canvas ref={canvasRef} className="viewer-canvas" aria-label="Interaktives Foto" />
      <div
        className={`viewer-vignette${controlsHidden ? ' viewer-vignette--hidden' : ''}`}
        aria-hidden="true"
      />
      <ViewerControls
        name={asset.name}
        projectionMode={projectionMode}
        availableModes={availableModes}
        coverage={activeCoverage}
        hidden={controlsHidden}
        isFullscreen={effectiveFullscreen}
        gyroAvailable={gyroAvailable}
        gyroActive={gyroActive}
        onClose={onClose}
        onOpenAnother={onOpenAnother}
        onCycleMode={cycleMode}
        onToggleGyro={() => void toggleGyro()}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
        onReset={resetView}
        onFullscreen={() => void toggleFullscreen()}
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
