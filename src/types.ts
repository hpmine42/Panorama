export type ViewerMode = 'panorama' | 'image';

/** Active user-selectable rendering projection in the viewer. */
export type ProjectionMode = 'panorama' | 'panorama360' | 'image';

export interface PanoramaCoverage {
  /** Horizontal angular span of the image in radians, in (0, 2π]. */
  horizontalSpan: number;
  /** Vertical angular span of the image in radians, in (0, π]. */
  verticalSpan: number;
  /** Elevation angle of the image center in radians (0 = horizon, >0 = up). */
  pitchCenter: number;
  /** Whether horizontal panning wraps continuously around 360°. */
  wrapsHorizontally: boolean;
  /** Whether coverage came from embedded GPano XMP metadata. */
  fromMetadata: boolean;
}

export interface ViewState {
  /** Horizontal camera rotation in radians. Increasing yaw shifts scene content right. */
  yaw: number;
  /** Vertical camera rotation in radians. Increasing pitch shifts scene content down (looks up). */
  pitch: number;
  /** 1 is the natural view; values below 1 zoom out into a curved/framed view. */
  zoom: number;
  /** Normalized image displacement for flat photo mode; positive moves image right/down. */
  offsetX: number;
  offsetY: number;
}

export interface ImageAsset {
  id: string;
  file: File;
  url: string;
  /** Tiny downscaled data URL for the blurred backdrop so mobile keeps minimal RAM. */
  backgroundUrl: string;
  /** Initial decoded image element; cleared once uploaded to WebGL to save mobile RAM. */
  source: HTMLImageElement | null;
  width: number;
  height: number;
  mode: ViewerMode;
  coverage: PanoramaCoverage;
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
