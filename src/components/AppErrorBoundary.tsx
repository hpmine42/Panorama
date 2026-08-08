import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/** Keeps a broken browser/runtime from becoming an unexplained black page. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep diagnostics in the browser console without sending anything away.
    console.error('Panorama Viewer runtime error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-crash" role="alert">
        <div className="empty-state__mark" aria-hidden="true">
          <Icon name="image" size={32} />
        </div>
        <p className="eyebrow">PANORAMA VIEWER</p>
        <h1>Die App konnte<br /><span>nicht starten.</span></h1>
        <p className="empty-state__copy">
          Bitte lade die Seite neu. Falls der Fehler bleibt, öffne die Browser-Konsole
          und prüfe, ob ein alter Service Worker gelöscht werden muss.
        </p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>
          Erneut laden
        </button>
        <code className="app-crash__details">{this.state.error.message}</code>
      </main>
    );
  }
}
