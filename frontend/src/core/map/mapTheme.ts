import { useState, useEffect } from 'react';
import { resolveToken, onTokenChange } from '@ds';

export interface MapPalette {
  waypoint: string;
  waypointStart: string;
  waypointFinish: string;
  waypointError: string;
  waypointCurrent: string;
  waypointAccessible: string;
  waypointCleared: string;
  waypointInaccessible: string;
  waypointFill: string;
  waypointStroke: string;
  roadLocked: string;
  roadOpen: string;
  roadAccessible: string;
  roadAccessibleGlow: string;
  roadCleared: string;
  roadRoadblock: string;
  roadRoadblockCasing: string;
  roadBypassed: string;
  roadDraft: string;
  labelInk: string;
  labelHalo: string;
  coinReward: string;
  onAccent: string;
  player: string;
}

export function getMapPalette(): MapPalette {
  return {
    waypoint: resolveToken('--map-waypoint'),
    waypointStart: resolveToken('--map-waypoint-start'),
    waypointFinish: resolveToken('--map-waypoint-finish'),
    waypointError: resolveToken('--map-waypoint-error'),
    waypointCurrent: resolveToken('--map-waypoint-current'),
    waypointAccessible: resolveToken('--map-waypoint-accessible'),
    waypointCleared: resolveToken('--map-waypoint-cleared'),
    waypointInaccessible: resolveToken('--map-waypoint-inaccessible'),
    waypointFill: resolveToken('--map-waypoint-fill'),
    waypointStroke: resolveToken('--map-waypoint-stroke'),
    roadLocked: resolveToken('--map-road-locked'),
    roadOpen: resolveToken('--map-road-open'),
    roadAccessible: resolveToken('--map-road-accessible'),
    roadAccessibleGlow: resolveToken('--map-road-accessible-glow'),
    roadCleared: resolveToken('--map-road-cleared'),
    roadRoadblock: resolveToken('--map-road-roadblock'),
    roadRoadblockCasing: resolveToken('--map-road-roadblock-casing'),
    roadBypassed: resolveToken('--map-road-bypassed'),
    roadDraft: resolveToken('--map-road-draft'),
    labelInk: resolveToken('--map-label-ink'),
    labelHalo: resolveToken('--map-label-halo'),
    coinReward: resolveToken('--map-coin-reward'),
    onAccent: resolveToken('--on-accent'),
    player: resolveToken('--map-player'),
  };
}

export function useMapPalette(): MapPalette {
  const [palette, setPalette] = useState<MapPalette>(getMapPalette);

  useEffect(() => {
    return onTokenChange(() => {
      setPalette(getMapPalette());
    });
  }, []);

  return palette;
}

export const PAINT_BINDINGS: ReadonlyArray<readonly [string, string, string]> = [
  ['waypoints-labels-layer', 'text-color', '--map-label-ink'],
  ['waypoints-labels-layer', 'text-halo-color', '--map-label-halo'],
  ['roads-preview-layer', 'line-color', '--map-road-draft'],
  ['waypoints-layer-outer', 'circle-color', '--map-waypoint-fill'],
  ['waypoints-layer-outer', 'circle-stroke-color', '--map-waypoint-stroke'],
  ['player-dot-outer', 'circle-color', '--map-player'],
];
