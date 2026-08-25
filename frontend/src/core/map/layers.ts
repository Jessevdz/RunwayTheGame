import * as maplibregl from 'maplibre-gl';
import type { MapPalette } from './mapTheme';
import { registerMapIcons } from './iconRegistry';

/** GeoJSON sources populated by map overlays. */
export const OVERLAY_SOURCES = [
  'waypoints',
  'roads',
  'radii',
  'team-positions',
  'road-preview',
  'road-midpoints'
] as const;

/** Layer IDs checked for road click hits. */
export const ROAD_HIT_LAYERS = [
  'roads-hitbox-layer',
  'roads-inaccessible-layer',
  'roads-open-layer',
  'roads-roadblock-layer'
];

/** Layer IDs checked for waypoint click hits. */
export const WAYPOINT_HIT_LAYERS = ['waypoints-layer-outer', 'waypoints-layer-inner'];

/** Configures and registers all GeoJSON sources and MapLibre render layers. */
export function setupMapLayers(
  map: maplibregl.Map,
  mapPalette: MapPalette,
  options: { editorMode: boolean }
): void {
  registerMapIcons(map, mapPalette);

  OVERLAY_SOURCES.forEach((id) => {
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  });

  addRadiiLayers(map);
  addRoadLayers(map, mapPalette);
  addWaypointLayers(map, mapPalette);
  addTeamPositionLayers(map, mapPalette);
  addPlayerLocationLayers(map, mapPalette);
  addWaypointPopups(map, options.editorMode);
}

// `emphasis` is 0 for the unselected editor rings and 1 for the focused ones;
// features without it (live game) are treated as emphasised.
function addRadiiLayers(map: maplibregl.Map): void {
  map.addLayer({
    id: 'radii-layer-fill',
    type: 'fill',
    source: 'radii',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['==', ['coalesce', ['get', 'emphasis'], 1], 0], 0.05, 0.12]
    }
  });

  map.addLayer({
    id: 'radii-layer-stroke',
    type: 'line',
    source: 'radii',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['case', ['==', ['coalesce', ['get', 'emphasis'], 1], 0], 1.5, 2.5],
      'line-dasharray': [3, 2],
      'line-opacity': ['case', ['==', ['coalesce', ['get', 'emphasis'], 1], 0], 0.4, 0.75]
    }
  });
}

function addRoadLayers(map: maplibregl.Map, mapPalette: MapPalette): void {
  map.addLayer({
    id: 'roads-hitbox-layer',
    type: 'line',
    source: 'roads',
    paint: {
      'line-width': 16,
      'line-opacity': 0
    }
  });

  // 1. Ambient Glow / Casing Layer for Accessible Paths (Illuminated flight corridor)
  map.addLayer({
    id: 'roads-accessible-glow-layer',
    type: 'line',
    source: 'roads',
    filter: ['==', ['get', 'status'], 'accessible'],
    paint: {
      'line-color': mapPalette.roadAccessibleGlow,
      'line-width': 12,
      'line-blur': 3,
      'line-opacity': 0.85
    }
  });

  // 2. Closed / Inaccessible roads layer (structured high-contrast dashed line for route planning)
  map.addLayer({
    id: 'roads-inaccessible-layer',
    type: 'line',
    source: 'roads',
    filter: ['==', ['get', 'status'], 'inaccessible'],
    paint: {
      'line-color': mapPalette.roadLocked,
      'line-width': 3,
      'line-dasharray': [2, 3],
      'line-opacity': 0.75
    }
  });

  // 3. Roadblocked roads outer casing (hazard outline)
  map.addLayer({
    id: 'roads-roadblock-casing-layer',
    type: 'line',
    source: 'roads',
    filter: ['==', ['get', 'status'], 'roadblocked'],
    paint: {
      'line-color': mapPalette.roadRoadblockCasing,
      'line-width': 11,
      'line-opacity': 0.9
    }
  });

  // 4. Roadblocked roads inner dashed layer
  map.addLayer({
    id: 'roads-roadblock-layer',
    type: 'line',
    source: 'roads',
    filter: ['==', ['get', 'status'], 'roadblocked'],
    paint: {
      'line-color': mapPalette.roadRoadblock,
      'line-width': 5,
      'line-dasharray': [5, 3],
      'line-opacity': 1.0
    }
  });

  // 5. Solid open / accessible / cleared roads layer
  map.addLayer({
    id: 'roads-open-layer',
    type: 'line',
    source: 'roads',
    filter: ['all', ['!=', ['get', 'status'], 'inaccessible'], ['!=', ['get', 'status'], 'roadblocked']],
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'status'], 'cleared'], mapPalette.roadCleared,
        ['==', ['get', 'status'], 'accessible'], mapPalette.roadAccessible,
        ['==', ['get', 'lockState'], 'open'], mapPalette.roadOpen,
        ['==', ['get', 'lockState'], 'bypassed'], mapPalette.roadBypassed,
        mapPalette.roadDraft
      ],
      'line-width': [
        'case',
        ['==', ['get', 'status'], 'accessible'], 5,
        ['==', ['get', 'status'], 'cleared'], 4,
        4.5
      ],
      'line-opacity': ['coalesce', ['get', 'opacity'], 1.0]
    }
  });

  // 6. Roadblock midpoint symbol layer
  map.addLayer({
    id: 'roads-midpoints-symbol-layer',
    type: 'symbol',
    source: 'road-midpoints',
    layout: {
      'icon-image': 'icon-roadblock',
      'icon-size': 1.0,
      'icon-allow-overlap': true,
      'text-field': 'ROADBLOCK',
      'text-font': ['Noto Sans Regular'],
      'text-size': 10,
      'text-offset': [0, 1.6],
      'text-anchor': 'top'
    },
    paint: {
      'text-color': mapPalette.roadRoadblock,
      'text-halo-color': mapPalette.labelHalo,
      'text-halo-width': 2
    }
  });

  // Preview draft roads
  map.addLayer({
    id: 'roads-preview-layer',
    type: 'line',
    source: 'road-preview',
    paint: {
      'line-color': mapPalette.roadDraft,
      'line-width': 2.5,
      'line-dasharray': [3, 3]
    }
  });
}

function addWaypointLayers(map: maplibregl.Map, mapPalette: MapPalette): void {
  map.addLayer({
    id: 'waypoints-layer-outer',
    type: 'circle',
    source: 'waypoints',
    paint: {
      'circle-color': ['coalesce', ['get', 'strokeColor'], mapPalette.waypointFill],
      'circle-radius': [
        'case',
        ['get', 'isStart'], 16,
        ['get', 'isFinish'], 16,
        ['coalesce', ['get', 'radiusOuter'], 8]
      ],
      'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], mapPalette.waypointStroke],
      'circle-stroke-width': [
        'case',
        ['get', 'isStart'], 4.5,
        ['get', 'isFinish'], 4.5,
        ['coalesce', ['get', 'strokeWidth'], 3]
      ],
      'circle-opacity': [
        'case',
        ['==', ['get', 'status'], 'inaccessible'], 0,
        ['coalesce', ['get', 'opacity'], 0.95]
      ]
    }
  });

  map.addLayer({
    id: 'waypoints-layer-inner',
    type: 'circle',
    source: 'waypoints',
    paint: {
      'circle-color': ['coalesce', ['get', 'color'], mapPalette.waypointFill],
      'circle-radius': [
        'case',
        ['get', 'isStart'], 9,
        ['get', 'isFinish'], 9,
        ['coalesce', ['get', 'radiusInner'], 4]
      ],
      'circle-opacity': [
        'case',
        ['==', ['get', 'status'], 'inaccessible'], 0,
        ['coalesce', ['get', 'opacity'], 0.95]
      ]
    }
  });

  map.addLayer({
    id: 'waypoints-symbols-layer',
    type: 'symbol',
    source: 'waypoints',
    paint: {
      'text-color': ['coalesce', ['get', 'textColor'], mapPalette.onAccent],
      'text-halo-color': ['coalesce', ['get', 'textHaloColor'], mapPalette.labelInk],
      'text-halo-width': 1.5
    },
    layout: {
      'icon-image': [
        'case',
        ['!=', ['coalesce', ['get', 'iconImage'], ''], ''],
        ['get', 'iconImage'],
        ''
      ],
      'icon-size': 1.1,
      'icon-allow-overlap': true,
      'icon-optional': true,
      'text-allow-overlap': true,
      'text-optional': true,
      'text-field': [
        'case',
        ['==', ['get', 'status'], 'inaccessible'], '',
        ['get', 'isStart'], '▶',
        ['get', 'isFinish'], '🏁',
        ['coalesce', ['get', 'symbol'], ['get', 'orderLabel'], '']
      ],
      'text-size': [
        'case',
        ['get', 'isStart'], 14,
        ['get', 'isFinish'], 14,
        11
      ],
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0, 0]
    }
  });

  map.addLayer({
    id: 'waypoints-labels-layer',
    type: 'symbol',
    source: 'waypoints',
    paint: {
      'text-color': mapPalette.labelInk,
      'text-halo-color': mapPalette.labelHalo,
      'text-halo-width': 2.5
    },
    layout: {
      'text-field': [
        'case',
        ['get', 'isStart'], ['concat', '▶ START · ', ['coalesce', ['get', 'name'], '']],
        ['get', 'isFinish'], ['concat', '🏁 FINISH · ', ['coalesce', ['get', 'name'], '']],
        ['coalesce', ['get', 'name'], '']
      ],
      'text-size': [
        'case',
        ['get', 'isStart'], 13,
        ['get', 'isFinish'], 13,
        12
      ],
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0, 1.8],
      'text-anchor': 'top',
      'text-allow-overlap': true
    },
    minzoom: 7
  });

  // The payout sits above the waypoint, opposite its name, so a designer can read
  // the reward curve along a route without opening every waypoint.
  map.addLayer({
    id: 'waypoints-reward-layer',
    type: 'symbol',
    source: 'waypoints',
    paint: {
      'text-color': mapPalette.coinReward,
      'text-halo-color': mapPalette.labelHalo,
      'text-halo-width': 2.5
    },
    layout: {
      'text-field': ['coalesce', ['get', 'coinRewardLabel'], ''],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0, -1.8],
      'text-anchor': 'bottom'
    },
    minzoom: 7
  });
}

function addTeamPositionLayers(map: maplibregl.Map, mapPalette: MapPalette): void {
  map.addLayer({
    id: 'team-positions-layer-outer',
    type: 'circle',
    source: 'team-positions',
    paint: {
      'circle-color': mapPalette.labelHalo,
      'circle-radius': 9,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 3
    }
  });

  map.addLayer({
    id: 'team-positions-layer-inner',
    type: 'circle',
    source: 'team-positions',
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': 5
    }
  });
}

function addPlayerLocationLayers(map: maplibregl.Map, mapPalette: MapPalette): void {
  map.addSource('player-location', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('player-accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({
    id: 'player-accuracy-layer',
    type: 'fill',
    source: 'player-accuracy',
    paint: {
      'fill-color': mapPalette.player,
      'fill-opacity': 0.15
    }
  });

  map.addLayer({
    id: 'player-accuracy-stroke',
    type: 'line',
    source: 'player-accuracy',
    paint: {
      'line-color': mapPalette.player,
      'line-width': 1,
      'line-opacity': 0.5
    }
  });

  map.addLayer({
    id: 'player-dot-outer',
    type: 'circle',
    source: 'player-location',
    paint: {
      'circle-color': mapPalette.waypointFill,
      'circle-radius': 9,
      'circle-opacity': 1.0,
      'circle-stroke-color': mapPalette.player,
      'circle-stroke-width': 2
    }
  });

  map.addLayer({
    id: 'player-dot-inner',
    type: 'circle',
    source: 'player-location',
    paint: {
      'circle-color': mapPalette.player,
      'circle-radius': 5
    }
  });
}

/** Name-and-role popup on a live-game waypoint. The editor has its own
 *  inspector, so it opts out. */
function addWaypointPopups(map: maplibregl.Map, editorMode: boolean): void {
  map.on('click', 'waypoints-layer-outer', (e) => {
    if (editorMode) return;

    const features = map.queryRenderedFeatures(e.point, { layers: ['waypoints-layer-outer'] });
    if (!features.length) return;

    const props = features[0].properties;
    const geometry = features[0].geometry;
    if (geometry.type !== 'Point') return;
    const coordinates = geometry.coordinates as [number, number];

    let roleText = 'Waypoint';
    if (props.isStart) roleText = '▶ Start Point';
    else if (props.isFinish) roleText = '🏁 Finish Line';

    new maplibregl.Popup({ className: 'custom-map-popup' })
      .setLngLat(coordinates)
      .setHTML(`
        <div class="map-popup">
          <h4 class="map-popup__name">${props.name}</h4>
          <p class="map-popup__role">${roleText}</p>
        </div>
      `)
      .addTo(map);
  });

  map.on('mouseenter', 'waypoints-layer-outer', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'waypoints-layer-outer', () => { map.getCanvas().style.cursor = ''; });
}
