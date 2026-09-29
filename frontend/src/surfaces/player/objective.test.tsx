import { describe, expect, it, vi } from 'vitest';
import type { GameState, Road, Waypoint } from '../../core/projection/projectionStore';
import type { TeamSession } from '../../core/game/teamSession';
import { describeGps } from '../../core/player/gpsStatus';
import { buildObjective, type ObjectiveInput } from './objective';
import type { PhotoState } from './photoStatus';
import type { RaceRoute, RaceRouteView } from './useRaceRoute';

const session: TeamSession = {
  gameId: 'game-1',
  teamId: 'team-1',
  teamToken: 't',
  teamName: 'Red',
  slotIndex: 0,
  homeWaypointId: 'a'
};

const wp = (id: string, lat: number, lon: number): Waypoint => ({
  id,
  name: `Stop ${id}`,
  lat,
  lon,
  arrival_radius_m: 25,
  isStart: false,
  isFinish: false,
  challengeId: 'ch'
});

const gameState = {
  mode: 'team',
  winner: null,
  state: 'live',
  coins: {},
  teams: {},
  standings: [],
  coinRush: null,
  ruleset: { vetoTimePenaltySeconds: 900, vetoPenaltyMinSeconds: 900, verification: 'llm' }
} as unknown as GameState;

const clock = { now: 0, runElapsed: 0, freezeLeft: 0, vetoLeft: 0, trackerLeft: 0, countdownLeft: 0, countdownRunning: false };

const NONE: PhotoState = { kind: 'none' };
const gps = describeGps({ position: { lat: 51, lon: 4, accuracy: 5 }, error: null, lastFixAt: 0, now: 0 });

const road = { id: 'r1', challengeId: '', lockState: 'open' } as unknown as Road;

const input = (over: Partial<Omit<ObjectiveInput, 'route'>> & { route: Partial<RaceRouteView> }): ObjectiveInput => ({
  gameState,
  session,
  playerLocation: { lat: 51, lon: 4, accuracy: 5 },
  clock,
  photos: { waypoint: NONE, road: NONE },
  gps,
  busy: false,
  on: { startChallenge: vi.fn(), arrive: vi.fn(), askVeto: vi.fn() },
  ...over,
  route: {
    currentWaypoint: wp('a', 51, 4),
    isCurrentWaypointCleared: false,
    routes: [],
    destination: null,
    destinationId: null,
    destinationChosen: false,
    chooseDestination: vi.fn(),
    reachedFinish: false,
    reached: 1,
    total: 4,
    progressPct: 25,
    ...over.route
  }
});

const routeTo = (distance: number | null, inRange = false): RaceRoute => ({
  road,
  waypoint: wp('b', 51.01, 4),
  distance,
  blocked: false,
  roadblock: undefined,
  inRange
});

describe('buildObjective photo state', () => {
  it('invites a first photo at a challenge', () => {
    const view = buildObjective(input({ route: {} }));
    expect(view.primary?.label).toBe('Do the challenge');
    expect(view.status).toBeUndefined();
  });

  it('says the photo is with the referee and offers no second submission', () => {
    const view = buildObjective(
      input({ route: {}, photos: { waypoint: { kind: 'pending', elapsedSeconds: 42 }, road: NONE } })
    );
    expect(view.status).toEqual({ kind: 'pending', text: 'With the referee, 0:42' });
    expect(view.primary).toBeUndefined();
  });

  it('names the host when the host is grading', () => {
    const hostGame = { ...gameState, ruleset: { ...gameState.ruleset, verification: 'host' } } as GameState;
    const view = buildObjective(
      input({ route: {}, gameState: hostGame, photos: { waypoint: { kind: 'pending', elapsedSeconds: 75 }, road: NONE } })
    );
    expect(view.status?.text).toBe('With your host, 1:15');
  });

  it('says a queued photo will send when online and offers no second submission', () => {
    const view = buildObjective(input({ route: {}, photos: { waypoint: { kind: 'queued' }, road: NONE } }));
    expect(view.status?.kind).toBe('queued');
    expect(view.status?.text).toMatch(/back online/);
    expect(view.primary).toBeUndefined();
  });

  it('turns a rejection into a retake with the reason', () => {
    const view = buildObjective(
      input({ route: {}, photos: { waypoint: { kind: 'rejected', rationale: 'Too dark.' }, road: NONE } })
    );
    expect(view.status?.text).toBe('Not accepted: Too dark.');
    expect(view.primary?.label).toBe('Take another photo');
  });

  it('disables the challenge button while a command is in flight', () => {
    const view = buildObjective(input({ route: {}, busy: true }));
    expect(view.primary?.disabled).toBe(true);
  });
});

describe('buildObjective wayfinding', () => {
  it('points at the destination with a bearing and distance', () => {
    const destination = routeTo(1112);
    const view = buildObjective(
      input({ route: { isCurrentWaypointCleared: true, routes: [destination], destination } })
    );
    expect(view.showArrow).toBe(true);
    expect(view.guide?.bearing).toBeCloseTo(0, 1);
    expect(view.guide?.distance).toBe(1112);
    expect(view.guide?.inRange).toBe(false);
  });

  it('has no guide but still shows the arrow when there is no fix', () => {
    const destination = routeTo(null);
    const view = buildObjective(
      input({
        playerLocation: null,
        gps: describeGps({ position: null, error: { code: 1, message: 'denied' }, lastFixAt: null, now: 0 }),
        route: { isCurrentWaypointCleared: true, routes: [destination], destination }
      })
    );
    expect(view.showArrow).toBe(true);
    expect(view.guide).toBeUndefined();
    expect(view.say).toMatch(/settings/i);
  });

  it('enables arrival only inside the zone', () => {
    const near = routeTo(10, true);
    const view = buildObjective(input({ route: { isCurrentWaypointCleared: true, routes: [near], destination: near } }));
    expect(view.tone).toBe('go');
    expect(view.primary?.disabled).toBe(false);
    expect(view.guide?.inRange).toBe(true);
  });
});
