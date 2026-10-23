import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { ImageAsset, ViewerMode, ViewState } from '../types';

export interface BackgroundRendererHandle {
  update(view: ViewState, mode: ViewerMode, width: number, height: number): void;
}

interface BackgroundRendererProps {
  asset: ImageAsset;
}

/**
 * Lightweight CSS compositor backdrop behind the transparent WebGL canvas.
 * Uses a tiny pre-downscaled thumbnail and mutates only GPU-composited
 * transform/opacity properties so mobile devices never re-blur full-res photos.
 */
export const BackgroundRenderer = forwardRef<BackgroundRendererHandle, BackgroundRendererProps>(
  function BackgroundRenderer({ asset }, ref) {
    const imageRef = useRef<HTMLImageElement>(null);
    const shadeRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        update(view, mode, width, height) {
          const image = imageRef.current;
          const shade = shadeRef.current;
          if (!image || !shade) return;

          const horizontalShift = mode === 'panorama'
            ? Math.sin(view.yaw) * width * 0.08
            : view.offsetX * width * 0.18;
          const verticalShift = mode === 'panorama'
            ? (view.pitch / Math.PI) * height * 0.14
            : view.offsetY * height * 0.18;
          const zoomScale = mode === 'panorama'
            ? 1.12 + Math.max(0, view.zoom - 1) * 0.015
            : 1.12 + Math.max(0, view.zoom - 1) * 0.035;

          image.style.transform = `translate3d(${horizontalShift.toFixed(1)}px, ${verticalShift.toFixed(1)}px, 0) scale(${zoomScale.toFixed(3)})`;
          shade.style.opacity = view.zoom < 0.92 ? '0.68' : '0.88';
        },
      }),
      [],
    );

    return (
      <div className="viewer-background" aria-hidden="true">
        <img ref={imageRef} src={asset.backgroundUrl} alt="" draggable={false} />
        <div ref={shadeRef} className="viewer-background__shade" />
      </div>
    );
  },
);
