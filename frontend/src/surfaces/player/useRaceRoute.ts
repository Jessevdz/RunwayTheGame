import { useMemo, useRef } from 'react';
import {
  roadblockBlocksTeam,
  type GameState,
  type Road,
  type Roadblock,
  type Waypoint
} from '../../core/projection/projectionStore';
import { type GPSPosition, calculateDistance } from '../../core/player/locationService';
import { type TeamSession } from '../../core/game/teamSession';
import { resolveDestinationId } from './destination';

/** The destination a player picked by hand, held by the shell so it survives the console closing for a photo. */
export interface DestinationChoice {
  id: string | null;
  set: (waypointId: string | null) => void;
}

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
  /** Onward routes in board order, so the strip does not reshuffle as GPS drifts. */
  routes: RaceRoute[];
  /** The route the objective card is arguing for; it stays put until the player picks another or one is clearly nearer. */
  destination: RaceRoute | null;
  destinationId: string | null;
  /** True when the player picked the destination rather than the app defaulting to the nearest. */
  destinationChosen: boolean;
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
  playerLocation: GPSPosition | null,
  choice: DestinationChoice
): RaceRouteView => {
  const myProgress = gameState.progress[session.teamId];
  const currentWaypointId = myProgress?.currentWaypointId;
  const currentWaypoint =
    gameState.waypoints.find((w) => w.id === currentWaypointId) ||
    gameState.waypoints.find((w) => w.isStart) ||
    gameState.waypoints[0] ||
    null;

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
      .filter((r): r is RaceRoute => !!r.waypoint && !clearedWaypointsSet.has(r.waypoint.id));
  }, [gameState.roads, gameState.waypoints, gameState.roadblocks, currentWaypoint, playerLocation, session, clearedWaypointsSet]);

  // The pick from the previous render is kept unless another route is clearly nearer, but a pick made before any GPS fix was only a guess.
  const pickedRef = useRef<{ at: string | undefined; id: string | null; measured: boolean }>({
    at: undefined,
    id: null,
    measured: false
  });
  const previous = pickedRef.current;
  const destinationId = resolveDestinationId(
    routes.map((r) => ({ waypointId: r.waypoint.id, distance: r.distance })),
    choice.id,
    previous.at === currentWaypoint?.id && previous.measured ? previous.id : null
  );
  pickedRef.current = {
    at: currentWaypoint?.id,
    id: destinationId,
    measured: routes.find((r) => r.waypoint.id === destinationId)?.distance != null
  };

  const currentWaypointState = currentWaypoint ? gameState.waypointStates[currentWaypoint.id] : null;
  // Checks if waypoint is cleared or bypassed for team.
  const isCurrentWaypointCleared = currentWaypoint
    ? !!(
        Object.values(currentWaypointState?.clearedBy || {}).some(Boolean) ||
        currentWaypointState?.bypassed?.[session.teamId]
      )
    : true;

  const reached = clearedWaypointsSet.size + (currentWaypoint && !clearedWaypointsSet.has(currentWaypoint.id) ? 1 : 0);
  const total = gameState.waypoints.length;

  return {
    currentWaypoint,
    isCurrentWaypointCleared,
    routes,
    destination: routes.find((r) => r.waypoint.id === destinationId) || null,
    destinationId,
    destinationChosen: !!choice.id && choice.id === destinationId,
    chooseDestination: choice.set,
    reachedFinish: !!myProgress?.reachedFinish,
    reached,
    total,
    progressPct: total > 0 ? Math.min(100, Math.round((reached / total) * 100)) : 0
  };
};
