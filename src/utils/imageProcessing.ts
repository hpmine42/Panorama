import type { ImageAsset, ViewerMode } from '../types';

const PANORAMA_ASPECT_RATIO = 1.75;
const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;

export function isSupportedImage(file: File): boolean {
  return file.type.startsWith('image/') || SUPPORTED_EXTENSIONS.test(file.name);
}

export function detectViewerMode(width: number, height: number): ViewerMode {
  return width / Math.max(height, 1) >= PANORAMA_ASPECT_RATIO ? 'panorama' : 'image';
}

function makeId(): string {
  if ('randomUUID' in crypto) {
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

/**
 * Decodes a local file without uploading it anywhere. Keeping an HTMLImageElement
 * here lets WebGL resize the source before it reaches the GPU, which avoids a
 * second full-size ImageBitmap allocation on memory-constrained phones.
 */
export async function loadImageAsset(file: File): Promise<ImageAsset> {
  if (!isSupportedImage(file)) {
    throw new Error('Bitte wähle eine JPG-, PNG-, WEBP- oder HEIC/HEIF-Datei aus.');
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.draggable = false;
  image.alt = '';

  try {
    await waitForImage(image, url);
    // decode() is already implied by load in most browsers. Calling it when
    // available prevents a race between the load event and texImage2D.
    if (typeof image.decode === 'function') {
      await image.decode().catch(() => undefined);
    }

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) {
      throw new Error('Das Bild hat keine lesbare Größe.');
    }

    return {
      id: makeId(),
      file,
      url,
      source: image,
      width,
      height,
      mode: detectViewerMode(width, height),
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

export function disposeImageAsset(asset: ImageAsset): void {
  URL.revokeObjectURL(asset.url);
  // Release the browser-side decoded image as soon as a different photo is
  // selected. The GPU texture is released by PanoramaRenderer.disposeImage().
  asset.source.src = '';
}

export function formatImageDimensions(width: number, height: number): string {
  return `${width.toLocaleString('de-DE')} × ${height.toLocaleString('de-DE')}`;
}
