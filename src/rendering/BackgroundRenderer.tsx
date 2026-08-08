import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { ImageAsset, ViewState } from '../types';

export interface BackgroundRendererHandle {
  update(view: ViewState, asset: ImageAsset, width: number, height: number): void;
}

interface BackgroundRendererProps {
  asset: ImageAsset;
}

/** CSS compositor layer behind the transparent WebGL canvas. */
export const BackgroundRenderer = forwardRef<BackgroundRendererHandle, BackgroundRendererProps>(
  function BackgroundRenderer({ asset }, ref) {
    const layerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
      ref,
      () => ({
        update(view, currentAsset, width, height) {
          const layer = layerRef.current;
          if (!layer || currentAsset.id !== asset.id) return;

          const horizontalShift = currentAsset.mode === 'panorama'
            ? (view.yaw / (Math.PI * 2)) * width * 0.26
            : view.offsetX * width * 0.22;
          const verticalShift = currentAsset.mode === 'panorama'
            ? (view.pitch / (Math.PI * 2)) * height * 0.2
            : view.offsetY * height * 0.22;
          const zoomScale = currentAsset.mode === 'panorama'
            ? 1.08 + Math.max(0, view.zoom - 1) * 0.015
            : 1.08 + Math.max(0, view.zoom - 1) * 0.04;

          layer.style.setProperty('--background-shift-x', `${horizontalShift}px`);
          layer.style.setProperty('--background-shift-y', `${verticalShift}px`);
          layer.style.setProperty('--background-scale', String(zoomScale));
          layer.style.setProperty('--background-brightness', view.zoom < 0.9 ? '0.76' : '0.62');
        },
      }),
      [asset],
    );

    return (
      <div ref={layerRef} className="viewer-background" aria-hidden="true">
        <img src={asset.url} alt="" draggable={false} />
        <div className="viewer-background__shade" />
      </div>
    );
  },
);
