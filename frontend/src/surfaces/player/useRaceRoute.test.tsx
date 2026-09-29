import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GameState, Road, Waypoint } from '../../core/projection/projectionStore';
import type { TeamSession } from '../../core/game/teamSession';
import type { GPSPosition } from '../../core/player/locationService';
import { useRaceRoute, type DestinationChoice } from './useRaceRoute';

const session: TeamSession = {
  gameId: 'game-1',
  teamId: 'team-1',
  teamToken: 't',
  teamName: 'Red',
  slotIndex: 0,
  homeWaypointId: 'a'
};

const wp = (id: string, lat: number, lon: number, extra: Partial<Waypoint> = {}): Waypoint => ({
  id,
  name: id,
  lat,
  lon,
  arrival_radius_m: 25,
  isStart: false,
  isFinish: false,
  challengeId: '',
  ...extra
});

const road = (id: string, waypointA: string, waypointB: string): Road => ({
  id,
  waypointA,
  waypointB,
  challengeId: '',
  lockState: 'open',
  completedBy: null,
  lengthM: 100
});

/** A start with two branches: north (b) and east (c), both about 1 km out. */
const state = {
  gameId: 'game-1',
  waypoints: [wp('a', 51, 4, { isStart: true }), wp('b', 51.009, 4), wp('c', 51, 4.0143)],
  roads: [road('r1', 'a', 'b'), road('r2', 'a', 'c')],
  roadblocks: {},
  waypointStates: { a: { clearedBy: { 'team-1': true }, bypassed: {} } },
  progress: { 'team-1': { currentWaypointId: 'a', traversedRoads: [], clearedWaypoints: ['a'], reachedFinish: false } }
} as unknown as GameState;

const at = (lat: number, lon: number): GPSPosition => ({ lat, lon, accuracy: 6 });
const noChoice = (id: string | null = null): DestinationChoice => ({ id, set: vi.fn() });

describe('useRaceRoute destination', () => {
  it('keeps route order stable instead of re-sorting by distance', () => {
    const { result } = renderHook(() => useRaceRoute(state, session, at(51, 4.02), noChoice()));
    expect(result.current.routes.map((r) => r.waypoint.id)).toEqual(['b', 'c']);
  });

  it('does not flip between branches as GPS drifts near the fork', () => {
    const { result, rerender } = renderHook(({ pos }) => useRaceRoute(state, session, pos, noChoice()), {
      initialProps: { pos: at(51, 4.0) }
    });
    const first = result.current.destination?.waypoint.id;

    // Drifting to where the other branch is a little nearer must not move the pick.
    rerender({ pos: at(51.0003, 4.0002) });
    rerender({ pos: at(51.0006, 4.0005) });
    rerender({ pos: at(51.0002, 4.0001) });

    expect(first).toBeDefined();
    expect(result.current.destination?.waypoint.id).toBe(first);
  });

  it('re-picks the nearest branch once the first GPS fix arrives', () => {
    const { result, rerender } = renderHook(({ pos }) => useRaceRoute(state, session, pos, noChoice()), {
      initialProps: { pos: null as GPSPosition | null }
    });
    expect(result.current.destination?.waypoint.id).toBe('b');

    rerender({ pos: at(51, 4.013) });
    expect(result.current.destination?.waypoint.id).toBe('c');
  });

  it('follows an explicit choice over the nearest branch', () => {
    const { result } = renderHook(() => useRaceRoute(state, session, at(51, 4.013), noChoice('b')));
    expect(result.current.destination?.waypoint.id).toBe('b');
    expect(result.current.destinationChosen).toBe(true);
  });

  it('switches when the player walks clearly nearer to the other branch', () => {
    const { result, rerender } = renderHook(({ pos }) => useRaceRoute(state, session, pos, noChoice()), {
      initialProps: { pos: at(51.002, 4.0) }
    });
    const first = result.current.destination?.waypoint.id;
    expect(first).toBe('b');

    rerender({ pos: at(51, 4.0135) });
    expect(result.current.destination?.waypoint.id).toBe('c');
  });
});
