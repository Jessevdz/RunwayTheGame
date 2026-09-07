import { describe, it, expect } from 'vitest';
import { resolveBasemap, createBasemapStyleSpec } from './basemap';

describe('resolveBasemap', () => {
  it('resolves auto style to default in light theme', () => {
    expect(resolveBasemap('auto', 'day')).toBe('default');
  });

  it('resolves auto style to dark in night theme', () => {
    expect(resolveBasemap('auto', 'night')).toBe('dark');
  });

  it('preserves explicit basemap styles regardless of theme', () => {
    expect(resolveBasemap('satellite', 'day')).toBe('satellite');
    expect(resolveBasemap('satellite', 'night')).toBe('satellite');
    expect(resolveBasemap('dark', 'day')).toBe('dark');
    expect(resolveBasemap('default', 'night')).toBe('default');
  });
});

describe('createBasemapStyleSpec', () => {
  it('builds raster sources without key param when no key is provided', () => {
    const spec = createBasemapStyleSpec('');
    const sources = spec.sources as Record<string, { type: string; tiles: string[] }>;

    expect(sources['carto-voyager'].tiles[0]).toBe(
      'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
    );
    expect(sources['carto-dark'].tiles[0]).toBe(
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
    );
    expect(sources['esri-satellite'].tiles[0]).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    );
  });

  it('appends encoded ?key= parameter to CARTO tile URLs when key is provided', () => {
    const spec = createBasemapStyleSpec('carto-secret-key-123');
    const sources = spec.sources as Record<string, { type: string; tiles: string[] }>;

    for (const url of sources['carto-voyager'].tiles) {
      expect(url).toContain('?key=carto-secret-key-123');
    }
    for (const url of sources['carto-dark'].tiles) {
      expect(url).toContain('?key=carto-secret-key-123');
    }
    // Esri satellite must remain untouched
    expect(sources['esri-satellite'].tiles[0]).not.toContain('?key=');
  });

  it('properly URL-encodes special characters in the API key', () => {
    const spec = createBasemapStyleSpec('key with spaces&special=chars');
    const sources = spec.sources as Record<string, { type: string; tiles: string[] }>;

    expect(sources['carto-voyager'].tiles[0]).toContain(
      '?key=key%20with%20spaces%26special%3Dchars'
    );
  });
});
