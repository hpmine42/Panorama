import { describe, expect, it } from 'vitest';
import {
  getCoverageForProjectionMode,
  parseGPanoMetadataFromXmp,
  resolveImageClassification,
} from './panoramaMetadata';

describe('panoramaMetadata', () => {
  it('treats standard 16:9 and 4:3 photos as flat images rather than warping them onto a sphere', () => {
    expect(resolveImageClassification(1920, 1080, null).mode).toBe('image');
    expect(resolveImageClassification(4032, 2268, null).mode).toBe('image');
    expect(resolveImageClassification(3024, 4032, null).mode).toBe('image');
  });

  it('recognizes 2:1 equirectangular images as full 360x180 panoramas', () => {
    const result = resolveImageClassification(8192, 4096, null);
    expect(result.mode).toBe('panorama');
    expect(result.coverage.wrapsHorizontally).toBe(true);
    expect(result.coverage.horizontalSpan).toBeCloseTo(Math.PI * 2, 5);
    expect(result.coverage.verticalSpan).toBeCloseTo(Math.PI, 5);
  });

  it('preserves 1:1 natural pixel proportions on partial mobile sweep panoramas (e.g. 4:1)', () => {
    const result = resolveImageClassification(8000, 2000, null);
    expect(result.mode).toBe('panorama');
    expect(result.coverage.wrapsHorizontally).toBe(false);
    expect(result.coverage.horizontalSpan / result.coverage.verticalSpan).toBeCloseTo(4, 4);
  });

  it('wraps ultra-wide 360° cylindrical sweeps (e.g. 6.5:1) while preserving aspect ratio', () => {
    const result = resolveImageClassification(13000, 2000, null);
    expect(result.mode).toBe('panorama');
    expect(result.coverage.wrapsHorizontally).toBe(true);
    expect(result.coverage.horizontalSpan).toBeCloseTo(Math.PI * 2, 5);
    expect(result.coverage.horizontalSpan / result.coverage.verticalSpan).toBeCloseTo(6.5, 4);
  });

  it('parses Google Camera GPano XMP attributes and element tags accurately', () => {
    const xmpAttributes = `
      <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF>
          <rdf:Description
            GPano:UsePanoramaViewer="True"
            GPano:ProjectionType="equirectangular"
            GPano:FullPanoWidthPixels="10000"
            GPano:FullPanoHeightPixels="5000"
            GPano:CroppedAreaImageWidthPixels="5000"
            GPano:CroppedAreaImageHeightPixels="1500"
            GPano:CroppedAreaLeftPixels="2500"
            GPano:CroppedAreaTopPixels="1750" />
        </rdf:RDF>
      </x:xmpmeta>
    `;
    const parsed = parseGPanoMetadataFromXmp(xmpAttributes);
    expect(parsed).not.toBeNull();

    const classified = resolveImageClassification(5000, 1500, parsed);
    expect(classified.mode).toBe('panorama');
    expect(classified.coverage.fromMetadata).toBe(true);
    expect(classified.coverage.wrapsHorizontally).toBe(false);
    expect(classified.coverage.horizontalSpan).toBeCloseTo(Math.PI, 4);
    expect(classified.coverage.verticalSpan).toBeCloseTo(Math.PI * 0.3, 4);
    expect(classified.coverage.pitchCenter).toBeCloseTo(0, 4);

    const xmpElements = `
      <rdf:Description>
        <GPano:UsePanoramaViewer>False</GPano:UsePanoramaViewer>
      </rdf:Description>
    `;
    const disabled = resolveImageClassification(4000, 2000, parseGPanoMetadataFromXmp(xmpElements));
    expect(disabled.mode).toBe('image');
  });

  it('computes non-stretched 360° override coverage for wide cropped strips', () => {
    const base = resolveImageClassification(7000, 2000, null).coverage;
    const forced360 = getCoverageForProjectionMode(7000, 2000, base, 'panorama360');
    expect(forced360.wrapsHorizontally).toBe(true);
    expect(forced360.horizontalSpan).toBeCloseTo(Math.PI * 2, 5);
    expect(forced360.horizontalSpan / forced360.verticalSpan).toBeCloseTo(3.5, 4);
  });
});
