import type * as maplibregl from 'maplibre-gl';

/** What the user picked. `auto` follows the app theme. */
export type BasemapStyle = 'auto' | 'default' | 'dark' | 'satellite';
/** What `auto` resolves to — the tile layer actually shown. */
export type EffectiveBasemap = 'default' | 'dark' | 'satellite';

/** Default map center coordinates prior to board bounds fitting. */
export const DEFAULT_CENTER: [number, number] = [4.4051, 51.2213];
export const DEFAULT_ZOOM = 12;

export function resolveBasemap(style: BasemapStyle, theme: string): EffectiveBasemap {
  if (style !== 'auto') return style;
  return theme === 'night' ? 'dark' : 'default';
}

/** Creates MapLibre style specification preloading default, dark, and satellite tile sources. */
export function createBasemapStyleSpec(
  cartoApiKey: string = (import.meta.env.VITE_CARTO_API_KEY as string) || ''
): maplibregl.StyleSpecification {
  const cartoParam = cartoApiKey ? `?key=${encodeURIComponent(cartoApiKey)}` : '';

  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'carto-voyager': {
        type: 'raster',
        tiles: [
          `https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png${cartoParam}`,
          `https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png${cartoParam}`,
          `https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png${cartoParam}`,
          `https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png${cartoParam}`
        ],
        tileSize: 256,
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap'
      },
      'carto-dark': {
        type: 'raster',
        tiles: [
          `https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${cartoParam}`,
          `https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${cartoParam}`,
          `https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${cartoParam}`,
          `https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png${cartoParam}`
        ],
        tileSize: 256,
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap'
      },
      'esri-satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: 'Tiles &copy; Esri'
      }
    },
    layers: [
      {
        id: 'base-tiles-default',
        type: 'raster',
        source: 'carto-voyager',
        minzoom: 0,
        maxzoom: 19,
        layout: { visibility: 'visible' }
      },
      {
        id: 'base-tiles-dark',
        type: 'raster',
        source: 'carto-dark',
        minzoom: 0,
        maxzoom: 19,
        layout: { visibility: 'none' }
      },
      {
        id: 'base-tiles-satellite',
        type: 'raster',
        source: 'esri-satellite',
        minzoom: 0,
        maxzoom: 19,
        layout: { visibility: 'none' }
      }
    ]
  };
}

const BASEMAP_LAYERS: ReadonlyArray<readonly [string, EffectiveBasemap]> = [
  ['base-tiles-default', 'default'],
  ['base-tiles-dark', 'dark'],
  ['base-tiles-satellite', 'satellite']
];

export function applyBasemapVisibility(map: maplibregl.Map, effective: EffectiveBasemap): void {
  BASEMAP_LAYERS.forEach(([layerId, style]) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', effective === style ? 'visible' : 'none');
    }
  });
}
