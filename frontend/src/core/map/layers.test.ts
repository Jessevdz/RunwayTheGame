import { describe, expect, it, vi } from 'vitest';
import { setupMapLayers, OVERLAY_SOURCES, ROAD_HIT_LAYERS, WAYPOINT_HIT_LAYERS } from './layers';
import { getMapPalette } from './mapTheme';
import type * as maplibregl from 'maplibre-gl';

function createMockMap() {
  const addedSources = new Map<string, unknown>();
  const addedLayers = new Map<string, unknown>();
  const eventListeners = new Map<string, Array<{ layer?: string; handler: (...args: any[]) => void }>>();

  const map = {
    addSource: vi.fn((id: string, source: unknown) => {
      addedSources.set(id, source);
    }),
    addLayer: vi.fn((layer: { id: string }) => {
      addedLayers.set(layer.id, layer);
    }),
    hasImage: vi.fn().mockReturnValue(false),
    addImage: vi.fn(),
    on: vi.fn((event: string, layerOrHandler: any, maybeHandler?: any) => {
      const isLayer = typeof layerOrHandler === 'string';
      const layer = isLayer ? layerOrHandler : undefined;
      const handler = isLayer ? maybeHandler : layerOrHandler;

      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event)!.push({ layer, handler });
    }),
    getCanvas: vi.fn().mockReturnValue({ style: { cursor: '' } }),
    queryRenderedFeatures: vi.fn().mockReturnValue([])
  } as unknown as maplibregl.Map;

  return { map, addedSources, addedLayers, eventListeners };
}

describe('layers.ts setupMapLayers', () => {
  it('registers all overlay GeoJSON sources on the map', () => {
    const { map, addedSources } = createMockMap();
    const palette = getMapPalette();

    setupMapLayers(map, palette, { editorMode: false });

    OVERLAY_SOURCES.forEach((sourceId) => {
      expect(addedSources.has(sourceId)).toBe(true);
    });

    // Also registers player location sources
    expect(addedSources.has('player-location')).toBe(true);
    expect(addedSources.has('player-accuracy')).toBe(true);
  });

  it('registers expected map layers including radii, roads, waypoints, and team positions', () => {
    const { map, addedLayers } = createMockMap();
    const palette = getMapPalette();

    setupMapLayers(map, palette, { editorMode: false });

    const expectedLayers = [
      'radii-layer-fill',
      'radii-layer-stroke',
      'roads-hitbox-layer',
      'roads-accessible-glow-layer',
      'roads-inaccessible-layer',
      'roads-roadblock-casing-layer',
      'roads-roadblock-layer',
      'roads-open-layer',
      'roads-midpoints-symbol-layer',
      'roads-preview-layer',
      'waypoints-layer-outer',
      'waypoints-layer-inner',
      'waypoints-symbols-layer',
      'waypoints-labels-layer',
      'waypoints-reward-layer',
      'team-positions-layer-outer',
      'team-positions-layer-inner',
      'player-accuracy-layer',
      'player-accuracy-stroke',
      'player-dot-outer',
      'player-dot-inner'
    ];

    expectedLayers.forEach((layerId) => {
      expect(addedLayers.has(layerId)).toBe(true);
    });
  });

  it('registers hit layer constants correctly', () => {
    expect(ROAD_HIT_LAYERS).toContain('roads-hitbox-layer');
    expect(ROAD_HIT_LAYERS).toContain('roads-open-layer');
    expect(WAYPOINT_HIT_LAYERS).toContain('waypoints-layer-outer');
  });

  it('registers mouse enter and leave cursor event handlers for waypoints', () => {
    const { map, eventListeners } = createMockMap();
    const palette = getMapPalette();

    setupMapLayers(map, palette, { editorMode: false });

    const enterListeners = eventListeners.get('mouseenter')?.filter((l) => l.layer === 'waypoints-layer-outer');
    const leaveListeners = eventListeners.get('mouseleave')?.filter((l) => l.layer === 'waypoints-layer-outer');

    expect(enterListeners?.length).toBe(1);
    expect(leaveListeners?.length).toBe(1);

    enterListeners![0].handler();
    expect(map.getCanvas().style.cursor).toBe('pointer');

    leaveListeners![0].handler();
    expect(map.getCanvas().style.cursor).toBe('');
  });
});
