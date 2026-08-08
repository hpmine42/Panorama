import { Icon } from './Icon';
import type { ViewerMode } from '../types';

interface ViewerControlsProps {
  name: string;
  mode: ViewerMode;
  onClose(): void;
  onOpenAnother(): void;
  onZoomOut(): void;
  onZoomIn(): void;
  onReset(): void;
  onFullscreen(): void;
}

export function ViewerControls({
  name,
  mode,
  onClose,
  onOpenAnother,
  onZoomOut,
  onZoomIn,
  onReset,
  onFullscreen,
}: ViewerControlsProps) {
  return (
    <div className="viewer-controls">
      <div className="viewer-topbar">
        <button className="icon-button glass" type="button" onClick={onClose} aria-label="Viewer schließen">
          <Icon name="arrow-left" />
        </button>
        <div className="viewer-title" title={name}>
          <strong>{name}</strong>
          <span>{mode === 'panorama' ? 'Panorama · 360° Ansicht' : 'Foto · interaktive Ansicht'}</span>
        </div>
        <button className="icon-button glass" type="button" onClick={onOpenAnother} aria-label="Anderes Foto öffnen">
          <Icon name="image" />
        </button>
      </div>

      <div className="viewer-bottombar">
        <div className="zoom-controls glass">
          <button className="icon-button" type="button" onClick={onZoomOut} aria-label="Herauszoomen">
            <Icon name="minus" />
          </button>
          <button className="icon-button" type="button" onClick={onReset} aria-label="Ansicht zurücksetzen">
            <Icon name="refresh" size={18} />
          </button>
          <button className="icon-button" type="button" onClick={onZoomIn} aria-label="Hineinzoomen">
            <Icon name="plus" />
          </button>
        </div>
        <button className="icon-button glass" type="button" onClick={onFullscreen} aria-label="Vollbild umschalten">
          <Icon name="expand" />
        </button>
      </div>
    </div>
  );
}
