import { useEffect, useMemo, useState } from 'react';
import {
  roadblockBlocksTeam,
  type GameState,
  type Road,
  type Roadblock,
  type Waypoint
} from '../../core/projection/projectionStore';
import { type GPSPosition, calculateDistance } from '../../core/player/locationService';
import { type TeamSession } from '../../core/game/teamSession';

/** One road out of where this team is standing, and what it costs to take it. */
export interface RaceRoute {
  road: Road;
  waypoint: Waypoint;
  /** Metres to the waypoint at the far end, or null while there is no GPS fix. */
  distance: number | null;
  /** Indicates if a roadblock obstructs this team on the route. */
  blocked: boolean;
  roadblock: Roadblock | undefined;
  inRange: boolean;
}

/** A road out before the far end is known to exist — a board mid-edit has both. */
type RouteCandidate = Omit<RaceRoute, 'waypoint'> & { waypoint: Waypoint | undefined };

export interface RaceRouteView {
  currentWaypoint: Waypoint | null;
  isCurrentWaypointCleared: boolean;
  /** Onward routes, nearest first — the order a walker reads them in. */
  routes: RaceRoute[];
  /** The route the objective card is arguing for. */
  destination: RaceRoute | null;
  destinationId: string | null;
  chooseDestination: (waypointId: string) => void;
  reachedFinish: boolean;
  /** Waypoints behind this team, out of the board's total. */
  reached: number;
  total: number;
  progressPct: number;
}

/**
 * Where this team is standing, what it has already cleared, and every road out
 * of here. The one branch decision — which way the player said they are heading
 * — lives here too, because it is only meaningful against this list.
 */
export const useRaceRoute = (
  gameState: GameState,
  session: TeamSession,
  playerLocation: GPSPosition | null
): RaceRouteView => {
  /** Destination the player chose at a branch. Null means "the nearest one". */
  const [destinationId, setDestinationId] = useState<string | null>(null);

  const myProgress = gameState.progress[session.teamId];
  const currentWaypointId = myProgress?.currentWaypointId;
  const currentWaypoint =
    gameState.waypoints.find((w) => w.id === currentWaypointId) ||
    gameState.waypoints.find((w) => w.isStart) ||
    gameState.waypoints[0] ||
    null;

  // A branch is a choice, not a list, so the pick resets when the player moves
  // on — otherwise a stale id silently survives into the next junction.
  useEffect(() => {
    setDestinationId(null);
  }, [currentWaypoint?.id]);

  const clearedWaypointsSet = useMemo(() => {
    const set = new Set<string>(myProgress?.clearedWaypoints || []);
    Object.entries(gameState.waypointStates || {}).forEach(([waypointId, state]) => {
      if (state.clearedBy?.[session.teamId] || state.bypassed?.[session.teamId]) {
        set.add(waypointId);
      }
    });
    gameState.waypoints.forEach((w) => {
      if (!w.challengeId && (w.isStart || currentWaypoint?.id === w.id)) {
        set.add(w.id);
      }
    });
    return set;
  }, [myProgress?.clearedWaypoints, gameState.waypointStates, gameState.waypoints, session.teamId, currentWaypoint?.id]);

  const routes = useMemo<RaceRoute[]>(() => {
    if (!currentWaypoint) return [];
    return gameState.roads
      .filter((s) => s.waypointA === currentWaypoint.id || s.waypointB === currentWaypoint.id)
      .map((road): RouteCandidate => {
        const nextId = road.waypointA === currentWaypoint.id ? road.waypointB : road.waypointA;
        const waypoint = gameState.waypoints.find((w) => w.id === nextId);
        const distance =
          waypoint && playerLocation
            ? calculateDistance(playerLocation.lat, playerLocation.lon, waypoint.lat, waypoint.lon)
            : null;
        const roadblock = gameState.roadblocks[road.id];
        return {
          road,
          waypoint,
          distance,
          blocked: roadblockBlocksTeam(roadblock, session.teamId),
          roadblock,
          inRange: distance !== null && !!waypoint && distance <= waypoint.arrival_radius_m
        };
      })
      .filter((r): r is RaceRoute => !!r.waypoint && !clearedWaypointsSet.has(r.waypoint.id))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }, [gameState.roads, gameState.waypoints, gameState.roadblocks, currentWaypoint, playerLocation, session, clearedWaypointsSet]);

  const currentWaypointState = currentWaypoint ? gameState.waypointStates[currentWaypoint.id] : null;
  // Checks if waypoint is cleared or bypassed for team.
  const isCurrentWaypointCleared = currentWaypoint
    ? !!(
        Object.values(currentWaypointState?.clearedBy || {}).some(Boolean) ||
        currentWaypointState?.bypassed?.[session.teamId]
      )
    : true;

  const reached = (myProgress?.clearedWaypoints?.length || 0) + 1;
  const total = gameState.waypoints.length;

  return {
    currentWaypoint,
    isCurrentWaypointCleared,
    routes,
    destination: routes.find((r) => r.waypoint.id === destinationId) || routes[0] || null,
    destinationId,
    chooseDestination: setDestinationId,
    reachedFinish: !!myProgress?.reachedFinish,
    reached,
    total,
    progressPct: total > 0 ? Math.min(100, Math.round((reached / total) * 100)) : 0
  };
};
