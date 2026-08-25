import { describe, expect, it } from 'vitest';
import {
  computeRouteOrder,
  validateBoard,
  type BoardDraft,
  type WaypointDraft,
  type RoadDraft
} from './geometryUtils';

describe('geometryUtils.ts computeRouteOrder', () => {
  it('computes BFS tiers and branch points from start waypoint', () => {
    const waypoints: WaypointDraft[] = [
      { id: 'w-start', name: 'Start', lat: 51.2, lon: 4.4, arrival_radius_m: 25, isStart: true, isFinish: false },
      { id: 'w-a', name: 'Waypoint A', lat: 51.21, lon: 4.41, arrival_radius_m: 25, isStart: false, isFinish: false },
      { id: 'w-b', name: 'Waypoint B', lat: 51.22, lon: 4.42, arrival_radius_m: 25, isStart: false, isFinish: false },
      { id: 'w-c', name: 'Waypoint C', lat: 51.23, lon: 4.43, arrival_radius_m: 25, isStart: false, isFinish: false },
      { id: 'w-finish', name: 'Finish', lat: 51.24, lon: 4.44, arrival_radius_m: 25, isStart: false, isFinish: true }
    ];

    const roads: RoadDraft[] = [
      { id: 'r1', waypoint_id_a: 'w-start', waypoint_id_b: 'w-a' },
      { id: 'r2', waypoint_id_a: 'w-start', waypoint_id_b: 'w-b' },
      { id: 'r3', waypoint_id_a: 'w-start', waypoint_id_b: 'w-c' },
      { id: 'r4', waypoint_id_a: 'w-c', waypoint_id_b: 'w-finish' }
    ];

    const result = computeRouteOrder(waypoints, roads);

    expect(result.tierByWaypoint['w-start']).toBe(0);
    expect(result.tierByWaypoint['w-a']).toBe(1);
    expect(result.tierByWaypoint['w-b']).toBe(1);
    expect(result.tierByWaypoint['w-c']).toBe(1);
    expect(result.tierByWaypoint['w-finish']).toBe(2);

    // w-start connects to w-a, w-b, w-c (outDegree 3 > 2)
    expect(result.branchPoints).toEqual([{ waypointId: 'w-start', outDegree: 3 }]);
    expect(result.unreachable).toHaveLength(0);
  });

  it('identifies unreachable disconnected components', () => {
    const waypoints: WaypointDraft[] = [
      { id: 'w-start', name: 'Start', lat: 51.2, lon: 4.4, arrival_radius_m: 25, isStart: true, isFinish: false },
      { id: 'w-isolated-1', name: 'Iso 1', lat: 51.5, lon: 4.8, arrival_radius_m: 25, isStart: false, isFinish: false },
      { id: 'w-isolated-2', name: 'Iso 2', lat: 51.51, lon: 4.81, arrival_radius_m: 25, isStart: false, isFinish: false }
    ];

    const roads: RoadDraft[] = [
      { id: 'r-iso', waypoint_id_a: 'w-isolated-1', waypoint_id_b: 'w-isolated-2' }
    ];

    const result = computeRouteOrder(waypoints, roads);
    expect(result.tierByWaypoint['w-start']).toBe(0);
    expect(result.tierByWaypoint['w-isolated-1']).toBeUndefined();
    expect(result.unreachable.map((w) => w.id)).toContain('w-isolated-1');
    expect(result.unreachable.map((w) => w.id)).toContain('w-isolated-2');
  });
});

describe('geometryUtils.ts validateBoard', () => {
  const validChallenge = {
    prompt: 'Photograph a red bicycle',
    rubric: { must_show: ['red bicycle'], fails_if: ['car'], acceptable_ambiguity: 'any shade of red' },
    coin_reward: 20,
    veto_penalty_seconds: 1800
  };

  const createValidBoard = (): BoardDraft => ({
    name: 'Valid Board',
    waypoints: [
      { id: 'w-start', name: 'Start', lat: 51.2, lon: 4.4, arrival_radius_m: 25, isStart: true, isFinish: false },
      {
        id: 'w-mid',
        name: 'Middle',
        lat: 51.21,
        lon: 4.41,
        arrival_radius_m: 25,
        isStart: false,
        isFinish: false,
        challenge: validChallenge
      },
      { id: 'w-finish', name: 'Finish', lat: 51.22, lon: 4.42, arrival_radius_m: 25, isStart: false, isFinish: true }
    ],
    roads: [
      { id: 'r1', waypoint_id_a: 'w-start', waypoint_id_b: 'w-mid' },
      { id: 'r2', waypoint_id_a: 'w-mid', waypoint_id_b: 'w-finish' }
    ],
    roadblockCards: [],
    curseCards: [],
    powerupCosts: {}
  });

  it('validates a correct board with zero errors', () => {
    const errors = validateBoard(createValidBoard());
    expect(errors).toHaveLength(0);
  });

  it('errors on empty waypoints', () => {
    const board: BoardDraft = {
      name: 'Empty',
      waypoints: [],
      roads: [],
      roadblockCards: [],
      curseCards: [],
      powerupCosts: {}
    };
    const errors = validateBoard(board);
    expect(errors.some((e) => e.id === 'err-no-waypoints')).toBe(true);
  });

  it('errors when start count is not 1', () => {
    const board = createValidBoard();
    board.waypoints[0].isStart = false; // 0 starts
    const errors = validateBoard(board);
    expect(errors.some((e) => e.id === 'err-start-count')).toBe(true);
  });

  it('errors when finish count is not 1', () => {
    const board = createValidBoard();
    board.waypoints[2].isFinish = false; // 0 finishes
    const errors = validateBoard(board);
    expect(errors.some((e) => e.id === 'err-finish-count')).toBe(true);
  });

  it('errors when a waypoint is both start and finish', () => {
    const board = createValidBoard();
    board.waypoints[0].isFinish = true;
    board.waypoints.pop(); // remove second finish
    const errors = validateBoard(board);
    expect(errors.some((e) => e.id.startsWith('err-start-is-finish'))).toBe(true);
  });

  it('errors on isolated waypoints', () => {
    const board = createValidBoard();
    board.waypoints.push({
      id: 'w-lonely',
      name: 'Lonely',
      lat: 51.3,
      lon: 4.5,
      arrival_radius_m: 25,
      isStart: false,
      isFinish: false,
      challenge: validChallenge
    });
    const errors = validateBoard(board);
    expect(errors.some((e) => e.id === 'err-isolated-w-lonely')).toBe(true);
  });

  it('errors when finish line is unreachable from start', () => {
    const board: BoardDraft = {
      name: 'Broken Route',
      waypoints: [
        { id: 'w-start', name: 'Start', lat: 51.2, lon: 4.4, arrival_radius_m: 25, isStart: true, isFinish: false },
        { id: 'w-other', name: 'Other', lat: 51.21, lon: 4.41, arrival_radius_m: 25, isStart: false, isFinish: false, challenge: validChallenge },
        { id: 'w-finish', name: 'Finish', lat: 51.3, lon: 4.5, arrival_radius_m: 25, isStart: false, isFinish: true }
      ],
      roads: [
        { id: 'r1', waypoint_id_a: 'w-start', waypoint_id_b: 'w-other' }
        // No road to finish
      ],
      roadblockCards: [],
      curseCards: [],
      powerupCosts: {}
    };

    const errors = validateBoard(board);
    expect(errors.some((e) => e.id === 'err-finish-unreachable')).toBe(true);
  });

  it('warns when roads geometrically intersect / cross each other', () => {
    const board: BoardDraft = {
      name: 'Crossing Roads',
      waypoints: [
        { id: 'w1', name: 'Top Left', lat: 51.21, lon: 4.4, arrival_radius_m: 25, isStart: true, isFinish: false },
        { id: 'w2', name: 'Bottom Right', lat: 51.2, lon: 4.41, arrival_radius_m: 25, isStart: false, isFinish: false, challenge: validChallenge },
        { id: 'w3', name: 'Bottom Left', lat: 51.2, lon: 4.4, arrival_radius_m: 25, isStart: false, isFinish: false, challenge: validChallenge },
        { id: 'w4', name: 'Top Right', lat: 51.21, lon: 4.41, arrival_radius_m: 25, isStart: false, isFinish: true }
      ],
      roads: [
        // Diagonal 1: Top Left to Bottom Right
        { id: 'r-diag1', waypoint_id_a: 'w1', waypoint_id_b: 'w2' },
        // Diagonal 2: Bottom Left to Top Right (crosses diagonal 1)
        { id: 'r-diag2', waypoint_id_a: 'w3', waypoint_id_b: 'w4' },
        // Connect w2 to w3 so graph is reachable
        { id: 'r-conn', waypoint_id_a: 'w2', waypoint_id_b: 'w3' }
      ],
      roadblockCards: [],
      curseCards: [],
      powerupCosts: {}
    };

    const errors = validateBoard(board);
    expect(errors.some((e) => e.type === 'warning' && e.id.startsWith('warn-intersect'))).toBe(true);
  });

  it('errors when finish waypoint carries a challenge', () => {
    const board = createValidBoard();
    board.waypoints[2].challenge = validChallenge; // Finish line has challenge
    const errors = validateBoard(board);
    expect(errors.some((e) => e.id === 'err-finish-has-challenge-w-finish')).toBe(true);
  });

  it('validates waypoint challenge coin reward and veto penalty boundaries', () => {
    const board = createValidBoard();
    board.waypoints[1].challenge = {
      prompt: 'Do something',
      coin_reward: 2, // < 5 is invalid
      veto_penalty_seconds: 300 // < 900 is invalid
    };

    const errors = validateBoard(board);
    expect(errors.some((e) => e.id === 'err-waypoint-challenge-coins-w-mid')).toBe(true);
    expect(errors.some((e) => e.id === 'err-waypoint-challenge-veto-w-mid')).toBe(true);
  });
});
