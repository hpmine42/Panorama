export type ViewerMode = 'panorama' | 'image';

export interface ViewState {
  /** Horizontal camera angle in radians for equirectangular panoramas. */
  yaw: number;
  /** Vertical camera angle in radians. Positive values look upward. */
  pitch: number;
  /** 1 is the natural view; values below 1 are intentional zoom-out. */
  zoom: number;
  /** Normalized image displacement, positive means the image moves right/down. */
  offsetX: number;
  offsetY: number;
}

export interface ImageAsset {
  id: string;
  file: File;
  url: string;
  source: HTMLImageElement;
  width: number;
  height: number;
  mode: ViewerMode;
  name: string;
  type: string;
}

export interface ViewportSize {
  width: number;
  height: number;
  dpr: number;
}

export const DEFAULT_VIEW: ViewState = {
  yaw: 0,
  pitch: 0,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};
