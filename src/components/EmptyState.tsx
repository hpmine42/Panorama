import { Icon } from './Icon';

interface EmptyStateProps {
  onOpen(): void;
  isLoading: boolean;
  error: string | null;
}

export function EmptyState({ onOpen, isLoading, error }: EmptyStateProps) {
  return (
    <main className="empty-state">
      <div className="empty-state__mark" aria-hidden="true">
        <Icon name="panorama" size={34} />
      </div>
      <p className="eyebrow">PANORAMA VIEWER</p>
      <h1>Ein Foto.<br /><span>Mehr Raum.</span></h1>
      <p className="empty-state__copy">
        Öffne ein Panorama oder ein normales Foto und bewege dich direkt darin.
        Alles bleibt auf diesem Gerät.
      </p>
      <button className="primary-button" type="button" onClick={onOpen} disabled={isLoading}>
        <Icon name={isLoading ? 'refresh' : 'upload'} size={19} className={isLoading ? 'spin' : undefined} />
        {isLoading ? 'Bild wird geöffnet …' : 'Foto öffnen'}
      </button>
      {error && <p className="error-message" role="alert">{error}</p>}
      <p className="empty-state__hint">JPG · PNG · WEBP · HEIC/HEIF</p>
    </main>
  );
}
