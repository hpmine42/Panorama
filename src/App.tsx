import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { EmptyState } from './components/EmptyState';
import { ImagePicker, type ImagePickerHandle } from './components/ImagePicker';
import { Icon } from './components/Icon';
import { PanoramaViewer } from './components/PanoramaViewer';
import type { ImageAsset } from './types';
import { consumeIncomingShare, clearShareLaunchUrl, isShareLaunch } from './pwa/shareTarget';
import { disposeImageAsset, loadImageAsset } from './utils/imageProcessing';

export function App() {
  const pickerRef = useRef<ImagePickerHandle>(null);
  const assetRef = useRef<ImageAsset | null>(null);
  const loadSequenceRef = useRef(0);
  const viewerHistoryRef = useRef(false);
  const [asset, setAsset] = useState<ImageAsset | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearAsset = useCallback(() => {
    const previous = assetRef.current;
    assetRef.current = null;
    setAsset(null);
    if (previous) disposeImageAsset(previous);
  }, []);

  const openFile = useCallback(async (file: File) => {
    const sequence = ++loadSequenceRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const nextAsset = await loadImageAsset(file);
      if (sequence !== loadSequenceRef.current) {
        disposeImageAsset(nextAsset);
        return;
      }

      const previous = assetRef.current;
      assetRef.current = nextAsset;
      setAsset(nextAsset);
      if (previous) disposeImageAsset(previous);

      if (!viewerHistoryRef.current) {
        viewerHistoryRef.current = true;
        const url = `${window.location.pathname}${window.location.search}#viewer`;
        window.history.pushState({ viewer: true }, '', url);
      }
    } catch (loadError) {
      if (sequence === loadSequenceRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'Das Bild konnte nicht geöffnet werden.');
      }
    } finally {
      if (sequence === loadSequenceRef.current) setIsLoading(false);
    }
  }, []);

  const closeViewer = useCallback(() => {
    const hadViewerHistory = viewerHistoryRef.current;
    viewerHistoryRef.current = false;
    clearAsset();
    if (hadViewerHistory && window.location.hash === '#viewer') {
      window.history.back();
    }
  }, [clearAsset]);

  useEffect(() => {
    const handlePopState = () => {
      if (viewerHistoryRef.current) {
        viewerHistoryRef.current = false;
        clearAsset();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [clearAsset]);

  useEffect(() => {
    let cancelled = false;
    if (isShareLaunch()) {
      void (async () => {
        try {
          const sharedFile = await consumeIncomingShare();
          clearShareLaunchUrl();
          if (!cancelled && sharedFile) {
            await openFile(sharedFile);
          } else if (!cancelled) {
            setError('Es wurde kein Bild im Teilen-Vorgang empfangen.');
          }
        } catch {
          clearShareLaunchUrl();
          if (!cancelled) setError('Das geteilte Bild konnte nicht gelesen werden.');
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [openFile]);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined;
    const serviceWorkerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI).toString();
    void navigator.serviceWorker.register(serviceWorkerUrl).catch(() => {
      // The viewer itself remains fully usable if a host does not allow SWs.
    });
    return undefined;
  }, []);

  useEffect(() => () => {
    if (assetRef.current) disposeImageAsset(assetRef.current);
  }, []);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void openFile(file);
  };

  return (
    <div
      className="app-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <ImagePicker ref={pickerRef} onFile={(file) => void openFile(file)} disabled={isLoading} />
      {asset ? (
        <PanoramaViewer
          asset={asset}
          onClose={closeViewer}
          onOpenAnother={() => pickerRef.current?.open()}
        />
      ) : (
        <>
          <EmptyState
            onOpen={() => pickerRef.current?.open()}
            isLoading={isLoading}
            error={error}
          />
          <footer className="app-footer">
            <Icon name="image" size={14} />
            <span>Lokal auf deinem Gerät · keine Uploads</span>
          </footer>
        </>
      )}
      {isLoading && asset && (
        <div className="loading-pill" role="status">
          <Icon name="refresh" size={16} className="spin" /> Bild wird vorbereitet …
        </div>
      )}
    </div>
  );
}
