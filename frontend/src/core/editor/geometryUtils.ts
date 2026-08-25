export interface WaypointDraft {
  id: string;
  name: string;
  lat: number;
  lon: number;
  arrival_radius_m: number;
  isStart: boolean;
  isFinish: boolean;
  challenge?: any;
  /** Coins this waypoint's challenge pays out, or null when it has none yet. */
  coinReward?: number | null;
}

export interface RoadDraft {
  id: string;
  waypoint_id_a: string;
  waypoint_id_b: string;
  challenge?: {
    prompt: string;
    rubric: { must_show: string[]; fails_if: string[]; acceptable_ambiguity: string };
    coin_reward: number;
    veto_penalty_seconds: number;
  } | null;
}

export interface BoardDraft {
  name: string;
  waypoints: WaypointDraft[];
  roads: RoadDraft[];
  challenges?: { [waypointId: string]: any };
  roadblockCards: { id: string; text: string }[];
  curseCards: { id: string; text: string }[];
  powerupCosts: { [powerup: string]: number };
}

export interface ValidationError {
  id: string;
  message: string;
  type: 'error' | 'warning';
  waypointIds?: string[];
  road?: RoadDraft;
}

// 2D Point helpers for geometry checks
interface Point {
  x: number;
  y: number;
}

// CCW orientation helper
function ccw(p1: Point, p2: Point, p3: Point): number {
  return (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x);
}

// Check if road p1q1 crosses road p2q2 (excluding sharing endpoints)
function roadsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  if (
    (p1.x === p2.x && p1.y === p2.y) ||
    (p1.x === q2.x && p1.y === q2.y) ||
    (q1.x === p2.x && q1.y === p2.y) ||
    (q1.x === q2.x && q1.y === q2.y)
  ) {
    return false;
  }

  const o1 = ccw(p1, q1, p2);
  const o2 = ccw(p1, q1, q2);
  const o3 = ccw(p2, q2, p1);
  const o4 = ccw(p2, q2, q1);

  if (
    ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
    ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
  ) {
    return true;
  }

  return false;
}

// Convert Lat/Lon to Planar Meters using Equirectangular projection
function toPlanar(lat: number, lon: number, latMid: number): Point {
  const cosLat = Math.cos((latMid * Math.PI) / 180);
  return {
    x: lon * cosLat * 111320,
    y: lat * 111132
  };
}

export interface RouteOrderResult {
  tierByWaypoint: Record<string, number>;
  orderedWaypoints: { waypoint: WaypointDraft; tier: number }[];
  orderedRoads: { road: RoadDraft; fromTier: number; toTier: number }[];
  branchPoints: { waypointId: string; outDegree: number }[];
  unreachable: WaypointDraft[];
}

export function computeRouteOrder(
  waypoints: WaypointDraft[],
  roads: RoadDraft[]
): RouteOrderResult {
  const adjMap: Record<string, string[]> = {};
  waypoints.forEach((w) => {
    adjMap[w.id] = [];
  });
  roads.forEach((s) => {
    if (adjMap[s.waypoint_id_a] && adjMap[s.waypoint_id_b]) {
      adjMap[s.waypoint_id_a].push(s.waypoint_id_b);
      adjMap[s.waypoint_id_b].push(s.waypoint_id_a);
    }
  });

  const starts = waypoints.filter((w) => w.isStart);
  const tierByWaypoint: Record<string, number> = {};

  if (starts.length === 1) {
    const startWp = starts[0];
    const queue: { id: string; tier: number }[] = [{ id: startWp.id, tier: 0 }];
    tierByWaypoint[startWp.id] = 0;

    while (queue.length > 0) {
      const { id, tier } = queue.shift()!;
      const neighbors = adjMap[id] || [];
      neighbors.forEach((neigh) => {
        if (tierByWaypoint[neigh] === undefined) {
          tierByWaypoint[neigh] = tier + 1;
          queue.push({ id: neigh, tier: tier + 1 });
        }
      });
    }
  }

  const orderedWaypoints: { waypoint: WaypointDraft; tier: number }[] = [];
  const unreachable: WaypointDraft[] = [];
  const branchPoints: { waypointId: string; outDegree: number }[] = [];

  waypoints.forEach((w) => {
    const deg = (adjMap[w.id] || []).length;
    const tier = tierByWaypoint[w.id];

    if (tier !== undefined) {
      orderedWaypoints.push({ waypoint: w, tier });
      if (deg > 2) {
        branchPoints.push({ waypointId: w.id, outDegree: deg });
      }
    } else {
      if (deg > 0) {
        unreachable.push(w);
      }
    }
  });

  orderedWaypoints.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.waypoint.name.localeCompare(b.waypoint.name);
  });

  const orderedRoads: { road: RoadDraft; fromTier: number; toTier: number }[] = [];
  roads.forEach((s) => {
    const tierA = tierByWaypoint[s.waypoint_id_a];
    const tierB = tierByWaypoint[s.waypoint_id_b];
    if (tierA !== undefined || tierB !== undefined) {
      const fromTier = tierA !== undefined ? tierA : (tierB !== undefined ? tierB : 0);
      const toTier = tierB !== undefined ? tierB : (tierA !== undefined ? tierA : 0);
      orderedRoads.push({
        road: s,
        fromTier,
        toTier
      });
    }
  });

  orderedRoads.sort((a, b) => {
    const minA = Math.min(a.fromTier, a.toTier);
    const minB = Math.min(b.fromTier, b.toTier);
    if (minA !== minB) return minA - minB;
    const maxA = Math.max(a.fromTier, a.toTier);
    const maxB = Math.max(b.fromTier, b.toTier);
    return maxA - maxB;
  });

  return {
    tierByWaypoint,
    orderedWaypoints,
    orderedRoads,
    branchPoints,
    unreachable
  };
}

// Full board validation for Runway
export function validateBoard(board: BoardDraft): ValidationError[] {
  const errors: ValidationError[] = [];
  const { waypoints, roads } = board;

  if (waypoints.length === 0) {
    errors.push({ id: 'err-no-waypoints', message: 'Board must contain at least 2 waypoints.', type: 'error' });
    return errors;
  }

  // 1. Start and Finish waypoint checks
  const starts = waypoints.filter((w) => w.isStart);
  const finishes = waypoints.filter((w) => w.isFinish);

  if (starts.length !== 1) {
    errors.push({
      id: 'err-start-count',
      message: `Board must have exactly one start waypoint (currently has ${starts.length}).`,
      type: 'error'
    });
  }

  if (finishes.length !== 1) {
    errors.push({
      id: 'err-finish-count',
      message: `Board must have exactly one finish waypoint (currently has ${finishes.length}).`,
      type: 'error'
    });
  }

  // Start and finish must be distinct waypoints.
  waypoints.forEach((w) => {
    if (w.isStart && w.isFinish) {
      errors.push({
        id: `err-start-is-finish-${w.id}`,
        message: `Waypoint "${w.name}" cannot be both the start and the finish. For a circular route, place a separate finish waypoint next to the start.`,
        type: 'error',
        waypointIds: [w.id]
      });
    }
  });

  // Convert all waypoints to planar coordinates for road intersection check
  let latSum = 0;
  waypoints.forEach((w) => {
    latSum += w.lat;
  });
  const latMid = latSum / waypoints.length;

  const waypointPoints: { [id: string]: Point } = {};
  waypoints.forEach((w) => {
    waypointPoints[w.id] = toPlanar(w.lat, w.lon, latMid);
  });

  // 2. Check for overlapping (crossing) roads
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const s1 = roads[i];
      const s2 = roads[j];

      const p1 = waypointPoints[s1.waypoint_id_a];
      const q1 = waypointPoints[s1.waypoint_id_b];
      const p2 = waypointPoints[s2.waypoint_id_a];
      const q2 = waypointPoints[s2.waypoint_id_b];

      if (p1 && q1 && p2 && q2) {
        if (roadsIntersect(p1, q1, p2, q2)) {
          errors.push({
            id: `warn-intersect-${i}-${j}`,
            message: `Overlapping roads detected between road ${s1.id} and road ${s2.id}.`,
            type: 'warning',
            waypointIds: [s1.waypoint_id_a, s1.waypoint_id_b, s2.waypoint_id_a, s2.waypoint_id_b]
          });
        }
      }
    }
  }

  // 3. Adjacency lists for graph connectivity
  const adjMap: { [id: string]: string[] } = {};
  waypoints.forEach((w) => {
    adjMap[w.id] = [];
  });
  roads.forEach((s) => {
    if (adjMap[s.waypoint_id_a] && adjMap[s.waypoint_id_b]) {
      adjMap[s.waypoint_id_a].push(s.waypoint_id_b);
      adjMap[s.waypoint_id_b].push(s.waypoint_id_a);
    }
  });

  // 4. Check for isolated waypoints
  waypoints.forEach((w) => {
    const deg = adjMap[w.id].length;
    if (deg === 0) {
      errors.push({
        id: `err-isolated-${w.id}`,
        message: `Waypoint "${w.name}" is completely isolated. All waypoints must connect to at least one road.`,
        type: 'error',
        waypointIds: [w.id]
      });
    }
  });

  // 5. Reachability Check (Start BFS & unreachable waypoints)
  const routeOrder = computeRouteOrder(waypoints, roads);

  if (starts.length === 1 && finishes.length === 1) {
    const startWp = starts[0];
    const finishWp = finishes[0];

    if (routeOrder.tierByWaypoint[finishWp.id] === undefined) {
      errors.push({
        id: 'err-finish-unreachable',
        message: `Invalid route layout: The finish line "${finishWp.name}" is not reachable from the start "${startWp.name}".`,
        type: 'error',
        waypointIds: [startWp.id, finishWp.id]
      });
    }
  }

  routeOrder.unreachable.forEach((w) => {
    errors.push({
      id: `err-unreachable-${w.id}`,
      message: `Waypoint "${w.name}" is not reachable from the start along any road.`,
      type: 'error',
      waypointIds: [w.id]
    });
  });

  // 6. Waypoint Challenge Validation
  waypoints.forEach((w) => {
    // Finish line waypoints cannot carry a challenge.
    if (w.isFinish && ((board.challenges && board.challenges[w.id]) || w.challenge)) {
      errors.push({
        id: `err-finish-has-challenge-${w.id}`,
        message: `The finish line "${w.name}" cannot carry a challenge. Reaching it is the objective — remove the challenge, or move the finish to another waypoint.`,
        type: 'error',
        waypointIds: [w.id]
      });
      return;
    }
    if (w.isStart || w.isFinish) return; // Start and finish waypoints are exempt from gating challenges.
    const ch = (board.challenges && board.challenges[w.id]) || w.challenge;
    if (!ch) {
      errors.push({
        id: `warn-waypoint-challenge-missing-${w.id}`,
        message: `Waypoint "${w.name}" has no gating challenge configured.`,
        type: 'warning',
        waypointIds: [w.id]
      });
      return;
    }

    const { prompt, coin_reward, veto_penalty_seconds } = ch;
    if (!prompt || !prompt.trim()) {
      errors.push({
        id: `err-waypoint-challenge-prompt-${w.id}`,
        message: `Challenge on waypoint "${w.name}" cannot have an empty prompt.`,
        type: 'error',
        waypointIds: [w.id]
      });
    }

    if (coin_reward !== undefined && (coin_reward < 5 || coin_reward > 40)) {
      errors.push({
        id: `err-waypoint-challenge-coins-${w.id}`,
        message: `Challenge reward on waypoint "${w.name}" must be between 5 and 40 coins (currently ${coin_reward}).`,
        type: 'error',
        waypointIds: [w.id]
      });
    }

    if (veto_penalty_seconds !== undefined && (veto_penalty_seconds < 900 || veto_penalty_seconds > 14400)) {
      errors.push({
        id: `err-waypoint-challenge-veto-${w.id}`,
        message: `Veto penalty on waypoint "${w.name}" must be between 15 minutes and 4 hours (currently ${Math.round(veto_penalty_seconds / 60)} minutes).`,
        type: 'error',
        waypointIds: [w.id]
      });
    }
  });

  return errors;
}
