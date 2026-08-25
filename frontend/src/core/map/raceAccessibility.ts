import { type GameState, roadblockBlocksTeam } from '../projection/projectionStore';

export type WaypointRaceStatus = 'current' | 'accessible' | 'cleared' | 'inaccessible' | 'start' | 'finish';
export type RoadRaceStatus = 'accessible' | 'cleared' | 'roadblocked' | 'inaccessible';

export interface WaypointAccessibility {
  id: string;
  status: WaypointRaceStatus;
  isAccessible: boolean;
}

export interface RoadAccessibility {
  id: string;
  status: RoadRaceStatus;
  isAccessible: boolean;
}

export interface RaceAccessibilityResult {
  waypoints: Record<string, WaypointAccessibility>;
  roads: Record<string, RoadAccessibility>;
}

export function computeRaceAccessibility(
  gameState: GameState,
  teamId?: string | null
): RaceAccessibilityResult {
  const result: RaceAccessibilityResult = {
    waypoints: {},
    roads: {}
  };

  if (!gameState.waypoints || gameState.waypoints.length === 0) {
    return result;
  }

  const activeTeamId = teamId || null;
  const progress = activeTeamId ? gameState.progress[activeTeamId] : null;

  // 1. Identify cleared waypoints
  const clearedWaypoints = new Set<string>();
  if (activeTeamId) {
    if (progress?.clearedWaypoints) {
      progress.clearedWaypoints.forEach((id) => clearedWaypoints.add(id));
    }
    Object.entries(gameState.waypointStates || {}).forEach(([waypointId, state]) => {
      if (state.clearedBy?.[activeTeamId] || state.bypassed?.[activeTeamId]) {
        clearedWaypoints.add(waypointId);
      }
    });
    // Include passing submissions
    Object.values(gameState.submissions || {}).forEach((sub) => {
      if (sub.teamId === activeTeamId && sub.status === 'pass' && (sub.waypointId || sub.challengeId)) {
        clearedWaypoints.add(sub.waypointId || sub.challengeId);
      }
    });
    // Waypoints without a gating challenge are implicitly cleared when reached or at start
    gameState.waypoints.forEach((w) => {
      if (!w.challengeId) {
        if (w.isStart || progress?.currentWaypointId === w.id) {
          clearedWaypoints.add(w.id);
        }
      }
    });
  } else {
    // No team in focus (board preview): a waypoint is cleared if any team cleared it
    Object.entries(gameState.waypointStates || {}).forEach(([waypointId, state]) => {
      if (state.clearedBy && Object.values(state.clearedBy).some(Boolean)) {
        clearedWaypoints.add(waypointId);
      }
      if (state.bypassed && Object.values(state.bypassed).some(Boolean)) {
        clearedWaypoints.add(waypointId);
      }
    });
    Object.values(gameState.progress || {}).forEach((p) => {
      p.clearedWaypoints?.forEach((id) => clearedWaypoints.add(id));
    });
    Object.values(gameState.submissions || {}).forEach((sub) => {
      if (sub.status === 'pass' && (sub.waypointId || sub.challengeId)) {
        clearedWaypoints.add(sub.waypointId || sub.challengeId);
      }
    });
    gameState.waypoints.forEach((w) => {
      if (!w.challengeId && w.isStart) {
        clearedWaypoints.add(w.id);
      }
    });
  }

  // 2. Identify current waypoint for active team
  const startWp = gameState.waypoints.find((w) => w.isStart) || gameState.waypoints[0];
  const currentWaypointId = (activeTeamId && progress?.currentWaypointId)
    ? progress.currentWaypointId
    : (startWp ? startWp.id : '');

  // 3. Identify waypoints that unlock outgoing roads.
  // A waypoint unlocks outgoing roads if cleared by this team or any team.
  const openedByField = new Set<string>();
  Object.entries(gameState.waypointStates || {}).forEach(([waypointId, state]) => {
    if (state.clearedBy && Object.values(state.clearedBy).some(Boolean)) {
      openedByField.add(waypointId);
    }
  });
  const outgoingUnlockedWaypoints = new Set<string>([...clearedWaypoints, ...openedByField]);

  // If a start waypoint has no gating challenge attached, it is implicitly unlocked
  if (startWp && !startWp.challengeId) {
    outgoingUnlockedWaypoints.add(startWp.id);
  }

  // Unlocks start waypoint when no waypoints are cleared during preview.
  if (!activeTeamId && outgoingUnlockedWaypoints.size === 0 && startWp) {
    outgoingUnlockedWaypoints.add(startWp.id);
  }

  // 4. Compute Road Accessibility
  (gameState.roads || []).forEach((s) => {
    const roadblock = gameState.roadblocks?.[s.id];
    const isRoadblocked = activeTeamId
      ? roadblockBlocksTeam(roadblock, activeTeamId)
      : (roadblock ? !roadblock.clearedBy || Object.keys(roadblock.clearedBy).length === 0 : false);

    const isTraversed = activeTeamId
      ? (progress?.traversedRoads?.includes(s.id) || s.completedBy === activeTeamId)
      : !!s.completedBy;

    const connectsToUnlocked = outgoingUnlockedWaypoints.has(s.waypointA) || outgoingUnlockedWaypoints.has(s.waypointB);
    const bothCleared = clearedWaypoints.has(s.waypointA) && clearedWaypoints.has(s.waypointB);

    // A road is passable if un-gated, bypassed, or completed.
    const isGateOpen = !s.challengeId || s.lockState === 'open' || s.lockState === 'bypassed';

    let status: RoadRaceStatus;
    let isAccessible = false;

    if (isRoadblocked) {
      status = 'roadblocked';
      isAccessible = false;
    } else if (isTraversed || (bothCleared && isGateOpen)) {
      status = 'cleared';
      isAccessible = true;
    } else if (connectsToUnlocked && isGateOpen) {
      status = 'accessible';
      isAccessible = true;
    } else {
      status = 'inaccessible';
      isAccessible = false;
    }

    result.roads[s.id] = {
      id: s.id,
      status,
      isAccessible
    };
  });

  // 5. Compute Waypoint Accessibility
  gameState.waypoints.forEach((w) => {
    let status: WaypointRaceStatus;
    let isAccessible = false;

    const isCurrent = currentWaypointId === w.id && !clearedWaypoints.has(w.id);
    const isCleared = clearedWaypoints.has(w.id);

    if (isCurrent) {
      status = 'current';
      isAccessible = true;
    } else if (isCleared) {
      status = 'cleared';
      isAccessible = true;
    } else if (w.isStart && !activeTeamId) {
      status = 'start';
      isAccessible = true;
    } else {
      // Check if any road touching this waypoint is accessible or cleared
      const connectedRoads = (gameState.roads || []).filter(
        (s) => s.waypointA === w.id || s.waypointB === w.id
      );
      const isConnectedToAccessibleRoad = connectedRoads.some(
        (s) => result.roads[s.id]?.isAccessible
      );

      if (isConnectedToAccessibleRoad) {
        status = w.isFinish ? 'finish' : 'accessible';
        isAccessible = true;
      } else {
        status = 'inaccessible';
        isAccessible = false;
      }
    }

    result.waypoints[w.id] = {
      id: w.id,
      status,
      isAccessible
    };
  });

  return result;
}
