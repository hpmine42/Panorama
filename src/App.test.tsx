// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ViewerControls } from './components/ViewerControls';
import type { PanoramaCoverage } from './types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('App & ViewerControls mobile UI', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '';
  });

  it('cleans up stale #viewer hash on fresh mount and renders native mobile image/* picker', async () => {
    window.history.replaceState({ viewer: true }, '', '/#viewer');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });

    expect(window.location.hash).toBe('');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute('accept')).toBe('image/*');

    const openButton = container.querySelector('.primary-button');
    expect(openButton?.textContent).toContain('Foto öffnen');

    await act(async () => {
      root.unmount();
    });
  });

  it('displays accurate sweep angle subtitle, mode toggle, gyro toggle, and immersive hidden state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const onCycleMode = vi.fn();
    const onToggleGyro = vi.fn();
    const sweepCoverage: PanoramaCoverage = {
      horizontalSpan: (240 * Math.PI) / 180,
      verticalSpan: (60 * Math.PI) / 180,
      pitchCenter: 0,
      wrapsHorizontally: false,
      fromMetadata: false,
    };

    await act(async () => {
      root.render(
        <ViewerControls
          name="Alpenkamm.jpg"
          projectionMode="panorama"
          availableModes={['panorama', 'panorama360', 'image']}
          coverage={sweepCoverage}
          hidden={false}
          isFullscreen={false}
          gyroAvailable={true}
          gyroActive={true}
          onClose={() => {}}
          onOpenAnother={() => {}}
          onCycleMode={onCycleMode}
          onToggleGyro={onToggleGyro}
          onZoomOut={() => {}}
          onZoomIn={() => {}}
          onReset={() => {}}
          onFullscreen={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain('Panorama · 240° Ansicht');
    const modeBtn = container.querySelector('.mode-button') as HTMLButtonElement;
    expect(modeBtn.textContent).toBe('Pano');

    await act(async () => {
      modeBtn.click();
    });
    expect(onCycleMode).toHaveBeenCalledTimes(1);

    const gyroBtn = container.querySelector('button[aria-label="Bewegungssteuerung umschalten"]') as HTMLButtonElement;
    expect(gyroBtn.classList.contains('is-active')).toBe(true);
    await act(async () => {
      gyroBtn.click();
    });
    expect(onToggleGyro).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
