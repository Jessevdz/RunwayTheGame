import type { FeatureCollection, Feature } from 'geojson';
import type { GameState, Waypoint } from '../projection/projectionStore';
import { loadTeamSession } from '../game/teamSession';
import { getTeamColor } from '../team/palette';
import { computeRouteOrder } from '../editor/geometryUtils';
import { computeRaceAccessibility, type RaceAccessibilityResult } from './raceAccessibility';
import { calculateDistance } from '../player/locationService';
import { makeCirclePolygon } from './geometry';
import type { MapPalette } from './mapTheme';
import type { DraftMapWaypoint, DraftMapRoad, DraggedWaypointPos, PlayerLocation } from './types';

/** Map overlays collection matching MapLibre GeoJSON sources. */
export interface MapOverlays {
  waypoints: FeatureCollection;
  roads: FeatureCollection;
  radii: FeatureCollection;
  teamPositions: FeatureCollection;
  roadMidpoints: FeatureCollection;
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Returns active coordinates for a waypoint, substituting transient drag position if active. */
function livePosition(
  waypoint: { id: string; lat: number; lon: number },
  dragged: DraggedWaypointPos
): { lat: number; lon: number } {
  if (dragged?.id === waypoint.id) return { lat: dragged.lat, lon: dragged.lon };
  return { lat: waypoint.lat, lon: waypoint.lon };
}

export interface EditorOverlayInput {
  waypoints: DraftMapWaypoint[];
  roads: DraftMapRoad[];
  selectedWaypointId: string | null;
  dragged: DraggedWaypointPos;
  palette: MapPalette;
}

/** Generates GeoJSON overlay collections for editor mode. */
export function buildEditorOverlays(input: EditorOverlayInput): MapOverlays {
  const { waypoints, roads, selectedWaypointId, dragged, palette } = input;

  const routeOrder = computeRouteOrder(waypoints, roads);
  const unreachableIds = new Set(routeOrder.unreachable.map((w) => w.id));

  const waypointsGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: waypoints.map((w) => {
      const isSelected = w.id === selectedWaypointId;
      const { lat, lon } = livePosition(w, dragged);
      const isUnreachable = unreachableIds.has(w.id);
      const tier = routeOrder.tierByWaypoint[w.id];
      let color = palette.waypoint;
      let radiusOuter = 8;
      let radiusInner = 4;
      let strokeWidth = 3;
      let symbol = tier !== undefined ? String(tier) : '';
      let textColor = palette.labelHalo;
      let textHaloColor = palette.labelInk;
      let iconImage = '';

      if (isUnreachable) {
        color = palette.waypointError;
        textColor = palette.onAccent;
        textHaloColor = palette.waypointError;
      } else if (w.isStart) {
        color = palette.waypointStart;
        radiusOuter = 16;
        radiusInner = 9;
        strokeWidth = 4.5;
        symbol = '▶';
        textColor = palette.onAccent;
        textHaloColor = palette.waypointStart;
      } else if (w.isFinish) {
        color = palette.waypointFinish;
        radiusOuter = 16;
        radiusInner = 9;
        strokeWidth = 4.5;
        symbol = '🏁';
        textColor = palette.onAccent;
        textHaloColor = palette.waypointFinish;
      } else if (isSelected) {
        textColor = palette.onAccent;
        textHaloColor = palette.waypoint;
      }

      const strokeColor = isUnreachable
        ? palette.waypointError
        : (isSelected
          ? palette.waypoint
          : (w.isStart ? palette.waypointStart : w.isFinish ? palette.waypointFinish : palette.waypointStroke));

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        },
        properties: {
          id: w.id,
          name: w.name,
          isStart: w.isStart,
          isFinish: w.isFinish,
          orderLabel: tier !== undefined ? String(tier) : '',
          isUnreachable,
          color,
          strokeColor,
          strokeWidth,
          radiusOuter,
          radiusInner,
          symbol,
          isSelected,
          textColor,
          textHaloColor,
          iconImage,
          opacity: 0.95,
          // Resolved here rather than in an expression: a waypoint with no
          // challenge yet has no payout to announce, and '' draws nothing.
          coinRewardLabel:
            typeof w.coinReward === 'number' ? `+${w.coinReward} COINS` : ''
        }
      };
    })
  };

  const roadsGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: roads.map((s) => {
      const wpA = waypoints.find((w) => w.id === s.waypoint_id_a);
      const wpB = waypoints.find((w) => w.id === s.waypoint_id_b);

      const a = wpA ? livePosition(wpA, dragged) : { lat: 0, lon: 0 };
      const b = wpB ? livePosition(wpB, dragged) : { lat: 0, lon: 0 };

      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [a.lon, a.lat],
            [b.lon, b.lat]
          ]
        },
        properties: {
          id: s.id,
          waypoint_id_a: s.waypoint_id_a,
          waypoint_id_b: s.waypoint_id_b,
          lockState: 'locked',
          hasRoadblock: false
        }
      };
    })
  };

  // Every waypoint shows its arrival radius while designing; the selected one
  // (and start / finish) is emphasised so the rest read as quiet context.
  const radiiGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: waypoints.map((w) => {
      const { lat, lon } = livePosition(w, dragged);
      const circle = makeCirclePolygon(lat, lon, w.arrival_radius_m);
      return {
        ...circle,
        properties: {
          color: w.isStart ? palette.waypointStart : w.isFinish ? palette.waypointFinish : palette.waypoint,
          emphasis: w.isStart || w.isFinish || w.id === selectedWaypointId ? 1 : 0
        }
      };
    })
  };

  return {
    waypoints: waypointsGeoJson,
    roads: roadsGeoJson,
    radii: radiiGeoJson,
    teamPositions: EMPTY,
    roadMidpoints: EMPTY
  };
}

/** Resolves the active team ID for race overlay visualization. */
export function resolveActiveTeamId(
  gameState: GameState,
  activeTeamId: string | null | undefined
): string | null {
  if (activeTeamId !== undefined) return activeTeamId;
  return (gameState.gameId ? loadTeamSession(gameState.gameId)?.teamId : null) ?? null;
}

/** Picks the open waypoint the player stands nearest, or null without a fix. */
function nearestOpenWaypoint(
  gameState: GameState,
  raceAcc: RaceAccessibilityResult,
  playerLocation: PlayerLocation | null
): Waypoint | null {
  if (!playerLocation) return null;

  let nearest: Waypoint | null = null;
  let nearestDistance = Infinity;

  gameState.waypoints.forEach((w) => {
    const acc = raceAcc.waypoints[w.id];
    // Somewhere already stood on is not somewhere left to reach.
    if (!acc?.isAccessible || acc.status === 'cleared' || acc.status === 'current') return;

    const distance = calculateDistance(playerLocation.lat, playerLocation.lon, w.lat, w.lon);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = w;
    }
  });

  return nearest;
}

/** Generates GeoJSON overlay collections for live race visualization. */
export function buildRaceOverlays(
  gameState: GameState,
  teamId: string | null,
  palette: MapPalette,
  playerLocation: PlayerLocation | null = null
): MapOverlays {
  const raceAcc = computeRaceAccessibility(gameState, teamId);

  const gameRoadsDraft = gameState.roads.map((s) => ({
    id: s.id,
    waypoint_id_a: s.waypointA,
    waypoint_id_b: s.waypointB
  }));
  const routeOrder = computeRouteOrder(gameState.waypoints, gameRoadsDraft);

  const waypointsGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: gameState.waypoints.map((w) => {
      const acc = raceAcc.waypoints[w.id];
      const status = acc?.status || 'accessible';
      const tier = routeOrder.tierByWaypoint[w.id];

      let color = palette.waypointFill;
      let strokeColor = palette.waypointStroke;
      let strokeWidth = 3;
      let radiusOuter = 8;
      let radiusInner = 4;
      let opacity = 0.95;
      let symbol = tier !== undefined ? String(tier) : '';
      let textColor = palette.labelHalo;
      let textHaloColor = palette.labelInk;
      // A registered image rather than a glyph, for the statuses whose mark
      // needs more than one colour. Empty means "draw `symbol` as text".
      let iconImage = '';

      if (status === 'current') {
        color = palette.waypointCurrent;
        strokeColor = palette.waypointCurrent;
        strokeWidth = 4;
        radiusOuter = 14;
        radiusInner = 7;
        opacity = 1.0;
        symbol = '📍';
        textColor = palette.onAccent;
        textHaloColor = palette.waypointCurrent;
      } else if (status === 'cleared') {
        color = palette.waypointCleared;
        strokeColor = palette.waypointCleared;
        strokeWidth = 2.5;
        radiusOuter = 9;
        radiusInner = 5;
        opacity = 0.9;
        symbol = '✓';
        textColor = palette.onAccent;
        textHaloColor = palette.waypointCleared;
      } else if (status === 'inaccessible') {
        color = palette.waypointFill;
        strokeColor = palette.waypointStroke;
        strokeWidth = 0;
        radiusOuter = 0;
        radiusInner = 0;
        opacity = 0.0;
        symbol = '';
        iconImage = 'icon-lock';
        textColor = palette.labelInk;
        textHaloColor = palette.labelHalo;
      } else if (w.isStart || status === 'start') {
        color = palette.waypointStart;
        strokeColor = palette.waypointStart;
        strokeWidth = 4.5;
        radiusOuter = 16;
        radiusInner = 9;
        opacity = 1.0;
        symbol = '▶';
        textColor = palette.onAccent;
        textHaloColor = palette.waypointStart;
      } else if (w.isFinish || status === 'finish') {
        color = palette.waypointFinish;
        strokeColor = palette.waypointFinish;
        strokeWidth = 4.5;
        radiusOuter = 16;
        radiusInner = 9;
        opacity = 1.0;
        symbol = '🏁';
        textColor = palette.onAccent;
        textHaloColor = palette.waypointFinish;
      } else if (status === 'accessible') {
        color = palette.waypointAccessible;
        strokeColor = palette.waypointAccessible;
        strokeWidth = 3;
        radiusOuter = 11;
        radiusInner = 6;
        opacity = 1.0;
        symbol = '';
        iconImage = 'icon-target';
        textColor = palette.onAccent;
        textHaloColor = palette.waypointAccessible;
      }

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [w.lon, w.lat]
        },
        properties: {
          id: w.id,
          name: w.name,
          isStart: w.isStart,
          isFinish: w.isFinish,
          status,
          isAccessible: acc?.isAccessible ?? true,
          orderLabel: tier !== undefined ? String(tier) : '',
          color,
          strokeColor,
          strokeWidth,
          radiusOuter,
          radiusInner,
          opacity,
          symbol,
          iconImage,
          textColor,
          textHaloColor
        }
      };
    })
  };

  const roadsGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: gameState.roads.map((s) => {
      const wpA = gameState.waypoints.find((w) => w.id === s.waypointA);
      const wpB = gameState.waypoints.find((w) => w.id === s.waypointB);
      const acc = raceAcc.roads[s.id];
      const status = acc?.status || 'accessible';
      const hasRoadblock = status === 'roadblocked';

      let color = palette.roadAccessible;
      let lineWidth = 5.0;
      let opacity = 1.0;

      if (status === 'roadblocked') {
        color = palette.roadRoadblock;
        lineWidth = 5.0;
        opacity = 1.0;
      } else if (status === 'cleared') {
        color = palette.roadCleared;
        lineWidth = 4.0;
        opacity = 0.85;
      } else if (status === 'inaccessible') {
        color = palette.roadLocked;
        lineWidth = 2.5;
        opacity = 0.35;
      }

      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [wpA?.lon || 0, wpA?.lat || 0],
            [wpB?.lon || 0, wpB?.lat || 0]
          ]
        },
        properties: {
          id: s.id,
          status,
          lockState: s.lockState,
          hasRoadblock,
          color,
          lineWidth,
          opacity,
          isAccessible: acc?.isAccessible ?? true
        }
      };
    })
  };

  // Midpoints of active roadblocks carry the hazard badge.
  const midpointsFeatures: Feature[] = [];
  gameState.roads.forEach((s) => {
    const wpA = gameState.waypoints.find((w) => w.id === s.waypointA);
    const wpB = gameState.waypoints.find((w) => w.id === s.waypointB);
    const acc = raceAcc.roads[s.id];
    const status = acc?.status || 'accessible';

    if (wpA && wpB && status === 'roadblocked') {
      midpointsFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [(wpA.lon + wpB.lon) / 2, (wpA.lat + wpB.lat) / 2]
        },
        properties: {
          id: s.id,
          status
        }
      });
    }
  });

  // A team with Tracker-Off still running is not drawn at all.
  const now = new Date();
  const positionsGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: Object.entries(gameState.positions)
      // Your own live GPS dot already marks where you are.
      .filter(([tId]) => tId !== teamId)
      .filter(([tId]) => {
        const effect = gameState.effects[tId];
        if (effect?.trackerOffUntil) {
          return new Date(effect.trackerOffUntil) <= now;
        }
        return true;
      })
      .map(([tId, pos]) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [pos.lon, pos.lat]
        },
        properties: {
          teamId: tId,
          color: getTeamColor(tId, gameState.teams),
          name: gameState.teams[tId]?.name || 'Unknown Team'
        }
      }))
  };

  // One ring in play, on the open waypoint being walked towards, so a board with
  // ten waypoints unlocked at once does not bury the map in circles.
  const ringed = nearestOpenWaypoint(gameState, raceAcc, playerLocation);
  const radiiGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: ringed
      ? [
        {
          ...makeCirclePolygon(ringed.lat, ringed.lon, ringed.arrival_radius_m),
          properties: {
            color: ringed.isFinish ? palette.waypointFinish : palette.waypointAccessible
          }
        }
      ]
      : []
  };

  return {
    waypoints: waypointsGeoJson,
    roads: roadsGeoJson,
    radii: radiiGeoJson,
    teamPositions: positionsGeoJson,
    roadMidpoints: { type: 'FeatureCollection', features: midpointsFeatures }
  };
}

export interface PlayerOverlays {
  location: FeatureCollection;
  accuracy: FeatureCollection;
}

export function buildPlayerOverlays(playerLocation: PlayerLocation | null): PlayerOverlays {
  if (!playerLocation) {
    return { location: EMPTY, accuracy: EMPTY };
  }

  return {
    location: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [playerLocation.lon, playerLocation.lat]
          },
          properties: {}
        }
      ]
    },
    accuracy: {
      type: 'FeatureCollection',
      features: [makeCirclePolygon(playerLocation.lat, playerLocation.lon, playerLocation.accuracy)]
    }
  };
}
