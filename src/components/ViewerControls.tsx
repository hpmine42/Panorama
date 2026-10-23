import { Icon } from './Icon';
import type { PanoramaCoverage, ProjectionMode } from '../types';

interface ViewerControlsProps {
  name: string;
  projectionMode: ProjectionMode;
  availableModes: ProjectionMode[];
  coverage: PanoramaCoverage;
  hidden: boolean;
  isFullscreen: boolean;
  gyroAvailable: boolean;
  gyroActive: boolean;
  onClose(): void;
  onOpenAnother(): void;
  onCycleMode(): void;
  onToggleGyro(): void;
  onZoomOut(): void;
  onZoomIn(): void;
  onReset(): void;
  onFullscreen(): void;
}

function formatSubtitle(projectionMode: ProjectionMode, coverage: PanoramaCoverage): string {
  if (projectionMode === 'image') {
    return 'Foto · interaktive Ansicht';
  }
  if (projectionMode === 'panorama360' || coverage.wrapsHorizontally) {
    return 'Panorama · 360° Ansicht';
  }
  const degrees = Math.round((coverage.horizontalSpan * 180) / Math.PI);
  return `Panorama · ${degrees}° Ansicht`;
}

function formatModeBadge(projectionMode: ProjectionMode, coverage: PanoramaCoverage): string {
  if (projectionMode === 'image') return 'Foto';
  if (projectionMode === 'panorama360' || coverage.wrapsHorizontally) return '360°';
  return 'Pano';
}

export function ViewerControls({
  name,
  projectionMode,
  availableModes,
  coverage,
  hidden,
  isFullscreen,
  gyroAvailable,
  gyroActive,
  onClose,
  onOpenAnother,
  onCycleMode,
  onToggleGyro,
  onZoomOut,
  onZoomIn,
  onReset,
  onFullscreen,
}: ViewerControlsProps) {
  const showModeSwitch = availableModes.length > 1;
  const showGyro = gyroAvailable && projectionMode !== 'image';

  return (
    <div
      className={`viewer-controls${hidden ? ' viewer-controls--hidden' : ''}`}
      aria-hidden={hidden}
    >
      <div className="viewer-topbar">
        <button
          className="icon-button glass"
          type="button"
          onClick={onClose}
          tabIndex={hidden ? -1 : 0}
          aria-label="Viewer schließen"
        >
          <Icon name="arrow-left" />
        </button>
        <div className="viewer-title" title={name}>
          <strong>{name}</strong>
          <span>{formatSubtitle(projectionMode, coverage)}</span>
        </div>
        <button
          className="icon-button glass"
          type="button"
          onClick={onOpenAnother}
          tabIndex={hidden ? -1 : 0}
          aria-label="Anderes Foto öffnen"
        >
          <Icon name="image" />
        </button>
      </div>

      <div className="viewer-bottombar">
        <div className="zoom-controls glass">
          <button
            className="icon-button"
            type="button"
            onClick={onZoomOut}
            tabIndex={hidden ? -1 : 0}
            aria-label="Herauszoomen"
          >
            <Icon name="minus" />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onReset}
            tabIndex={hidden ? -1 : 0}
            aria-label="Ansicht zurücksetzen"
          >
            <Icon name="refresh" size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onZoomIn}
            tabIndex={hidden ? -1 : 0}
            aria-label="Hineinzoomen"
          >
            <Icon name="plus" />
          </button>
        </div>

        <div className="viewer-actions">
          {showModeSwitch && (
            <button
              className="mode-button glass"
              type="button"
              onClick={onCycleMode}
              tabIndex={hidden ? -1 : 0}
              aria-label="Projektionsmodus wechseln"
            >
              <Icon name={projectionMode === 'image' ? 'image' : 'panorama'} size={17} />
              <span>{formatModeBadge(projectionMode, coverage)}</span>
            </button>
          )}
          {showGyro && (
            <button
              className={`icon-button glass${gyroActive ? ' is-active' : ''}`}
              type="button"
              onClick={onToggleGyro}
              tabIndex={hidden ? -1 : 0}
              aria-pressed={gyroActive}
              aria-label="Bewegungssteuerung umschalten"
            >
              <Icon name="compass" />
            </button>
          )}
          <button
            className={`icon-button glass${isFullscreen ? ' is-active' : ''}`}
            type="button"
            onClick={onFullscreen}
            tabIndex={hidden ? -1 : 0}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? 'Vollbild beenden' : 'Vollbild umschalten'}
          >
            <Icon name={isFullscreen ? 'compress' : 'expand'} />
          </button>
        </div>
      </div>
    </div>
  );
}
