import { describe, expect, it } from 'vitest';
import type { GameState } from '../projection/projectionStore';
import { createMomentTracker, diffMoments } from './raceMoments';
import { describeCelebration, describeRivalEvent } from './momentCopy';

const ME = 'me';
const RIVAL = 'rival';

const base = (): GameState =>
  ({
    gameId: 'g1',
    mode: 'team',
    state: 'live',
    winner: null,
    lastSequence: 5,
    waypoints: [
      { id: 'a', name: 'Start', lat: 0, lon: 0, arrival_radius_m: 20, isStart: true, isFinish: false, challengeId: '' },
      { id: 'b', name: 'Bridge', lat: 0, lon: 0, arrival_radius_m: 20, isStart: false, isFinish: false, challengeId: 'c1' },
      { id: 'c', name: 'Finish', lat: 0, lon: 0, arrival_radius_m: 20, isStart: false, isFinish: true, challengeId: '' }
    ],
    roads: [
      { id: 'r1', waypointA: 'a', waypointB: 'b', challengeId: '', lockState: 'open', completedBy: null, lengthM: 1 },
      { id: 'r2', waypointA: 'b', waypointB: 'c', challengeId: 'c2', lockState: 'locked', completedBy: null, lengthM: 1 }
    ],
    teams: { [ME]: { name: 'Red Fox', slotIndex: 0 }, [RIVAL]: { name: 'Blue Jay', slotIndex: 2 } },
    coins: { [ME]: 0, [RIVAL]: 0 },
    effects: {},
    waypointStates: {},
    submissions: {},
    coinRush: null,
    ruleset: { coinRushCountdownSeconds: 1800 },
    progress: {
      [ME]: { currentWaypointId: 'a', traversedRoads: [], clearedWaypoints: ['a'], reachedFinish: false },
      [RIVAL]: { currentWaypointId: 'a', traversedRoads: [], clearedWaypoints: ['a'], reachedFinish: false }
    }
  }) as unknown as GameState;

const withProgress = (s: GameState, id: string, patch: Partial<GameState['progress'][string]>): GameState => ({
  ...s,
  lastSequence: s.lastSequence + 1,
  progress: { ...s.progress, [id]: { ...s.progress[id], ...patch } }
});

describe('diffMoments', () => {
  it('celebrates arriving at a new waypoint', () => {
    const prev = base();
    const next = withProgress(prev, ME, { currentWaypointId: 'b' });
    const { celebration } = diffMoments(prev, next, ME);
    expect(celebration).toMatchObject({ kind: 'arrived', key: 'arrived:b', waypointId: 'b' });
  });

  it('celebrates a waypoint challenge being cleared and reports coins gained', () => {
    const prev = withProgress(base(), ME, { currentWaypointId: 'b' });
    const next = {
      ...withProgress(prev, ME, { clearedWaypoints: ['a', 'b'] }),
      coins: { [ME]: 10, [RIVAL]: 0 },
      waypointStates: { b: { clearedBy: { [ME]: true }, bypassed: {} } }
    };
    const { celebration } = diffMoments(prev, next, ME);
    expect(celebration).toMatchObject({ kind: 'cleared', key: 'cleared:b', coinsGained: 10 });
  });

  it('does not call a skipped challenge cleared', () => {
    const prev = withProgress(base(), ME, { currentWaypointId: 'b' });
    const next = {
      ...withProgress(prev, ME, { clearedWaypoints: ['a', 'b'] }),
      waypointStates: { b: { clearedBy: {}, bypassed: { [ME]: true } } }
    };
    expect(diffMoments(prev, next, ME).celebration).toBeNull();
  });

  it('celebrates an accepted photo once even if the waypoint state follows in a later update', () => {
    const start = withProgress(base(), ME, { currentWaypointId: 'b' });
    const pending = {
      ...start,
      submissions: { s1: { submissionId: 's1', teamId: ME, waypointId: 'b', roadId: '', status: 'pending' } }
    } as unknown as GameState;
    const passed = {
      ...pending,
      lastSequence: pending.lastSequence + 1,
      submissions: { s1: { ...pending.submissions.s1, status: 'pass' } }
    } as GameState;
    const cleared = {
      ...passed,
      lastSequence: passed.lastSequence + 1,
      waypointStates: { b: { clearedBy: { [ME]: true }, bypassed: {} } }
    } as GameState;

    const tracker = createMomentTracker(ME);
    tracker.observe(pending);
    expect(tracker.observe(passed).celebration?.kind).toBe('cleared');
    expect(tracker.observe(cleared).celebration).toBeNull();
  });

  it('prefers the win over the finish and arrival in the same update', () => {
    const prev = withProgress(base(), ME, { currentWaypointId: 'b', clearedWaypoints: ['a', 'b'] });
    const next = { ...withProgress(prev, ME, { currentWaypointId: 'c', reachedFinish: true }), winner: ME };
    expect(diffMoments(prev, next, ME).celebration?.kind).toBe('won');
  });

  it('reports a finish without a win in a coin rush', () => {
    const prev = withProgress(base(), ME, { currentWaypointId: 'b' });
    const next = withProgress(prev, ME, { currentWaypointId: 'c', reachedFinish: true });
    expect(diffMoments(prev, next, ME).celebration?.kind).toBe('finished');
  });

  it('flags a new freeze on this team as being nerfed', () => {
    const prev = base();
    const next = { ...prev, lastSequence: 6, effects: { [ME]: { curses: [], frozenUntil: '2030-01-01T00:00:00Z' } } };
    expect(diffMoments(prev, next, ME).rival).toEqual([{ key: 'nerfed:2030-01-01T00:00:00Z', kind: 'nerfed' }]);
  });

  it('flags a rival finishing and a coin rush countdown starting', () => {
    const prev = base();
    const next = {
      ...withProgress(prev, RIVAL, { reachedFinish: true }),
      coinRush: { firstFinishAt: 'x', deadline: '2030-01-01T00:30:00Z', finishers: [] }
    } as GameState;
    const kinds = diffMoments(prev, next, ME).rival.map((e) => e.kind);
    expect(kinds).toEqual(['rival_finished', 'countdown_started']);
  });

  it('names a rival winner once instead of also calling it a finish', () => {
    const prev = base();
    const next = { ...withProgress(prev, RIVAL, { reachedFinish: true }), winner: RIVAL };
    expect(diffMoments(prev, next, ME).rival.map((e) => e.kind)).toEqual(['rival_won']);
  });
});

describe('createMomentTracker', () => {
  it('treats the first state as a baseline so a reload replays nothing', () => {
    const tracker = createMomentTracker(ME);
    const finished = withProgress(base(), ME, { currentWaypointId: 'c', reachedFinish: true });
    expect(tracker.observe(finished)).toEqual({ celebration: null, rival: [] });
    expect(tracker.observe({ ...finished, lastSequence: finished.lastSequence + 1 })).toEqual({ celebration: null, rival: [] });
  });

  it('treats states before the first snapshot as baseline', () => {
    const tracker = createMomentTracker(ME);
    tracker.observe({ ...base(), lastSequence: 0, progress: {} });
    const first = withProgress(base(), ME, { currentWaypointId: 'b' });
    expect(tracker.observe(first).celebration).toBeNull();
  });

  it('shows each event once', () => {
    const tracker = createMomentTracker(ME);
    const start = base();
    const arrived = withProgress(start, ME, { currentWaypointId: 'b' });
    tracker.observe(start);
    expect(tracker.observe(arrived).celebration?.key).toBe('arrived:b');
    const again = { ...arrived, lastSequence: arrived.lastSequence + 1 };
    expect(tracker.observe(again).celebration).toBeNull();
    const away = withProgress(again, ME, { currentWaypointId: 'a' });
    tracker.observe(away);
    const back = withProgress(away, ME, { currentWaypointId: 'b' });
    expect(tracker.observe(back).celebration).toBeNull();
  });
});

describe('describeCelebration', () => {
  it('says what a cleared waypoint unlocked and where to go next', () => {
    const state = withProgress(base(), ME, { currentWaypointId: 'b' });
    const copy = describeCelebration({ key: 'cleared:b', kind: 'cleared', waypointId: 'b', coinsGained: 5 }, state, ME);
    expect(copy.title).toBe('Cleared!');
    expect(copy.unlocked).toContain('Finish');
    expect(copy.next).toBe('Next stop: Finish');
    expect(copy.coins).toBe('+5 coins');
  });

  it('writes a plain rival pop-up', () => {
    const text = describeRivalEvent({ key: 'k', kind: 'rival_finished', teamId: RIVAL }, base()).text;
    expect(text).toBe('Blue Jay reached the finish.');
  });
});
