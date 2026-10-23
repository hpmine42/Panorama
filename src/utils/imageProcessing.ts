import type { ImageAsset, ViewerMode } from '../types';
import { readGPanoMetadata, resolveImageClassification } from './panoramaMetadata';

const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp)$/i;
const BACKGROUND_THUMB_MAX_EDGE = 72;

export function isSupportedImage(file: File): boolean {
  return file.type.startsWith('image/') || SUPPORTED_EXTENSIONS.test(file.name);
}

export function detectViewerMode(width: number, height: number): ViewerMode {
  return resolveImageClassification(width, height, null).mode;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function waitForImage(image: HTMLImageElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Dieses Bild konnte vom Browser nicht dekodiert werden.'));
    };
    const cleanup = () => {
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
    };

    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
    image.src = url;
  });
}

export async function decodeImageFromUrl(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.draggable = false;
  image.alt = '';
  await waitForImage(image, url);
  if (typeof image.decode === 'function') {
    await image.decode().catch(() => undefined);
  }
  return image;
}

function createBackgroundThumbnail(
  image: HTMLImageElement,
  width: number,
  height: number,
  fallbackUrl: string,
): string {
  try {
    const scale = Math.min(1, BACKGROUND_THUMB_MAX_EDGE / Math.max(width, height, 1));
    const thumbWidth = Math.max(8, Math.round(width * scale));
    const thumbHeight = Math.max(8, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      canvas.width = 0;
      canvas.height = 0;
      return fallbackUrl;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'medium';
    context.drawImage(image, 0, 0, thumbWidth, thumbHeight);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl.startsWith('data:image/') ? dataUrl : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

/**
 * Decodes a local file without uploading it anywhere. Reads optional GPano XMP
 * metadata in parallel and generates a tiny backdrop thumbnail so mobile GPUs
 * do not keep a second full-resolution bitmap in RAM for the blurred background.
 */
export async function loadImageAsset(file: File): Promise<ImageAsset> {
  if (!isSupportedImage(file)) {
    throw new Error('Bitte wähle eine JPG-, PNG-, WEBP- oder HEIC/HEIF-Datei aus.');
  }

  const url = URL.createObjectURL(file);

  try {
    const [image, gpano] = await Promise.all([
      decodeImageFromUrl(url),
      readGPanoMetadata(file),
    ]);

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) {
      image.src = '';
      throw new Error('Das Bild hat keine lesbare Größe.');
    }

    const { mode, coverage } = resolveImageClassification(width, height, gpano);
    const backgroundUrl = createBackgroundThumbnail(image, width, height, url);

    return {
      id: makeId(),
      file,
      url,
      backgroundUrl,
      source: image,
      width,
      height,
      mode,
      coverage,
      name: file.name || 'Panorama',
      type: file.type || 'image/*',
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof Error
      ? error
      : new Error('Das Bild konnte nicht geöffnet werden.');
  }
}

/** Releases the CPU-decoded HTMLImageElement once the GPU texture is uploaded. */
export function releaseImageSource(asset: ImageAsset): void {
  if (asset.source) {
    asset.source.src = '';
    asset.source = null;
  }
}

export function disposeImageAsset(asset: ImageAsset): void {
  releaseImageSource(asset);
  URL.revokeObjectURL(asset.url);
}

export function formatImageDimensions(width: number, height: number): string {
  return `${width.toLocaleString('de-DE')} × ${height.toLocaleString('de-DE')}`;
}
