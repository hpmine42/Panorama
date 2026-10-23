import type { PanoramaCoverage, ProjectionMode, ViewerMode } from '../types';

const TWO_PI = Math.PI * 2;
const WRAP_THRESHOLD = TWO_PI - 0.05;
const PANORAMA_MIN_ASPECT = 1.94;
const EQUIRECTANGULAR_MAX_ASPECT = 2.06;
/** Typical vertical FOV (~62°) of a smartphone camera held upright during a sweep panorama. */
const MOBILE_SWEEP_VERTICAL_SPAN = 1.08;
const MAX_XMP_SCAN_BYTES = 512 * 1024;

export interface ParsedGPanoMetadata {
  usePanoramaViewer?: boolean;
  projectionType?: string;
  fullWidth?: number;
  fullHeight?: number;
  croppedWidth?: number;
  croppedHeight?: number;
  croppedLeft?: number;
  croppedTop?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function matchXmpField(xmp: string, field: string): string | undefined {
  const attrRegex = new RegExp(`GPano:${field}\\s*=\\s*["']([^"']+)["']`, 'i');
  const attrMatch = attrRegex.exec(xmp);
  if (attrMatch?.[1]) return attrMatch[1].trim();

  const tagRegex = new RegExp(`<GPano:${field}[^>]*>([^<]+)</GPano:${field}>`, 'i');
  const tagMatch = tagRegex.exec(xmp);
  if (tagMatch?.[1]) return tagMatch[1].trim();

  return undefined;
}

function parsePositiveNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseGPanoMetadataFromXmp(text: string): ParsedGPanoMetadata | null {
  if (!text.includes('GPano:')) return null;

  const useRaw = matchXmpField(text, 'UsePanoramaViewer');
  const usePanoramaViewer = useRaw === undefined
    ? undefined
    : /^(true|1)$/i.test(useRaw);

  const projectionType = matchXmpField(text, 'ProjectionType')?.toLowerCase();
  const fullWidth = parsePositiveNumber(matchXmpField(text, 'FullPanoWidthPixels'));
  const fullHeight = parsePositiveNumber(matchXmpField(text, 'FullPanoHeightPixels'));
  const croppedWidth = parsePositiveNumber(matchXmpField(text, 'CroppedAreaImageWidthPixels'));
  const croppedHeight = parsePositiveNumber(matchXmpField(text, 'CroppedAreaImageHeightPixels'));
  const croppedLeft = parseNonNegativeNumber(matchXmpField(text, 'CroppedAreaLeftPixels'));
  const croppedTop = parseNonNegativeNumber(matchXmpField(text, 'CroppedAreaTopPixels'));

  if (
    usePanoramaViewer === undefined
    && !projectionType
    && fullWidth === undefined
    && croppedWidth === undefined
  ) {
    return null;
  }

  return {
    usePanoramaViewer,
    projectionType,
    fullWidth,
    fullHeight,
    croppedWidth,
    croppedHeight,
    croppedLeft,
    croppedTop,
  };
}

export async function readGPanoMetadata(file: File): Promise<ParsedGPanoMetadata | null> {
  try {
    const slice = file.slice(0, MAX_XMP_SCAN_BYTES);
    const buffer = typeof slice.arrayBuffer === 'function'
      ? await slice.arrayBuffer()
      : await new Response(slice).arrayBuffer();
    const text = new TextDecoder('latin1').decode(buffer);
    return parseGPanoMetadataFromXmp(text);
  } catch {
    return null;
  }
}

export function inferCoverageFromDimensions(width: number, height: number): PanoramaCoverage {
  const aspect = width / Math.max(height, 1);

  if (aspect >= PANORAMA_MIN_ASPECT && aspect <= EQUIRECTANGULAR_MAX_ASPECT) {
    return {
      horizontalSpan: TWO_PI,
      verticalSpan: Math.PI,
      pitchCenter: 0,
      wrapsHorizontally: true,
      fromMetadata: false,
    };
  }

  const horizontalSpan = clamp(MOBILE_SWEEP_VERTICAL_SPAN * aspect, 0.7, TWO_PI);
  const verticalSpan = clamp(horizontalSpan / Math.max(aspect, 0.25), 0.25, Math.PI);
  return {
    horizontalSpan,
    verticalSpan,
    pitchCenter: 0,
    wrapsHorizontally: horizontalSpan >= WRAP_THRESHOLD,
    fromMetadata: false,
  };
}

export function resolveImageClassification(
  width: number,
  height: number,
  gpano: ParsedGPanoMetadata | null,
): { mode: ViewerMode; coverage: PanoramaCoverage } {
  const aspect = width / Math.max(height, 1);
  const heuristicCoverage = inferCoverageFromDimensions(width, height);

  if (gpano?.usePanoramaViewer === false) {
    return { mode: 'image', coverage: heuristicCoverage };
  }

  if (gpano && gpano.fullWidth && gpano.croppedWidth) {
    const hRatio = clamp(gpano.croppedWidth / gpano.fullWidth, 0.08, 1);
    const horizontalSpan = hRatio * TWO_PI;

    let verticalSpan: number;
    let pitchCenter = 0;

    if (gpano.fullHeight && gpano.croppedHeight) {
      const vRatio = clamp(gpano.croppedHeight / gpano.fullHeight, 0.08, 1);
      verticalSpan = vRatio * Math.PI;
      if (gpano.croppedTop !== undefined) {
        const centerRowRatio = (gpano.croppedTop + gpano.croppedHeight * 0.5) / gpano.fullHeight;
        pitchCenter = clamp((0.5 - centerRowRatio) * Math.PI, -1.2, 1.2);
      }
    } else {
      verticalSpan = clamp(horizontalSpan / Math.max(aspect, 0.25), 0.25, Math.PI);
    }

    return {
      mode: 'panorama',
      coverage: {
        horizontalSpan,
        verticalSpan,
        pitchCenter,
        wrapsHorizontally: horizontalSpan >= WRAP_THRESHOLD,
        fromMetadata: true,
      },
    };
  }

  if (
    gpano?.usePanoramaViewer === true
    || gpano?.projectionType === 'equirectangular'
    || gpano?.projectionType === 'cylindrical'
  ) {
    return {
      mode: 'panorama',
      coverage: { ...heuristicCoverage, fromMetadata: true },
    };
  }

  return {
    mode: aspect >= PANORAMA_MIN_ASPECT ? 'panorama' : 'image',
    coverage: heuristicCoverage,
  };
}

export function getCoverageForProjectionMode(
  width: number,
  height: number,
  baseCoverage: PanoramaCoverage,
  projectionMode: ProjectionMode,
): PanoramaCoverage {
  if (projectionMode !== 'panorama360') {
    return baseCoverage;
  }
  const aspect = width / Math.max(height, 1);
  return {
    horizontalSpan: TWO_PI,
    verticalSpan: clamp(TWO_PI / Math.max(aspect, 2), 0.25, Math.PI),
    pitchCenter: 0,
    wrapsHorizontally: true,
    fromMetadata: baseCoverage.fromMetadata,
  };
}
