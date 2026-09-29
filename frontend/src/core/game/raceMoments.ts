import type { GameState } from '../projection/projectionStore';

/** The key moments of a race that earn a full-screen celebration, best first. */
export type CelebrationKind = 'won' | 'finished' | 'cleared' | 'arrived';

export interface CelebrationMoment {
  /** Stable identity of the event, so it is only ever shown once. */
  key: string;
  kind: CelebrationKind;
  waypointId?: string;
  roadId?: string;
  /** Coins this team gained in the same update, or zero. */
  coinsGained: number;
}

/** Things that happened to or around this team that deserve a short pop-up. */
export type RivalEventKind = 'nerfed' | 'rival_finished' | 'rival_won' | 'countdown_started';

export interface RivalEvent {
  key: string;
  kind: RivalEventKind;
  /** The rival involved, when one is known. */
  teamId?: string;
  /** Countdown length in seconds, for a countdown start. */
  seconds?: number;
}

export interface MomentBatch {
  celebration: CelebrationMoment | null;
  rival: RivalEvent[];
}

const EMPTY: MomentBatch = { celebration: null, rival: [] };

const PRIORITY: Record<CelebrationKind, number> = { won: 4, finished: 3, cleared: 2, arrived: 1 };

const clearedSet = (state: GameState, teamId: string): Set<string> => {
  const set = new Set<string>(state.progress[teamId]?.clearedWaypoints ?? []);
  Object.entries(state.waypointStates).forEach(([waypointId, ws]) => {
    if (ws.clearedBy?.[teamId]) set.add(waypointId);
  });
  return set;
};

/** Everything that changed between two projection states that this team should feel. */
export function diffMoments(prev: GameState, next: GameState, teamId: string): MomentBatch {
  const before = prev.progress[teamId];
  const after = next.progress[teamId];
  const coinsGained = Math.max(0, (next.coins[teamId] ?? 0) - (prev.coins[teamId] ?? 0));
  const candidates: CelebrationMoment[] = [];

  if (before && after) {
    if (next.winner === teamId && prev.winner !== teamId) {
      candidates.push({ key: `won:${teamId}`, kind: 'won', coinsGained });
    }
    if (after.reachedFinish && !before.reachedFinish) {
      candidates.push({ key: `finished:${teamId}`, kind: 'finished', waypointId: after.currentWaypointId, coinsGained });
    }

    const arrivedAt = after.currentWaypointId && after.currentWaypointId !== before.currentWaypointId ? after.currentWaypointId : '';
    if (arrivedAt && !after.reachedFinish) {
      candidates.push({ key: `arrived:${arrivedAt}`, kind: 'arrived', waypointId: arrivedAt, coinsGained });
    }

    const wasCleared = clearedSet(prev, teamId);
    clearedSet(next, teamId).forEach((waypointId) => {
      if (wasCleared.has(waypointId)) return;
      const waypoint = next.waypoints.find((w) => w.id === waypointId);
      if (!waypoint?.challengeId) return;
      if (next.waypointStates[waypointId]?.bypassed?.[teamId]) return;
      candidates.push({ key: `cleared:${waypointId}`, kind: 'cleared', waypointId, coinsGained });
    });

    Object.values(next.submissions).forEach((sub) => {
      if (sub.teamId !== teamId || sub.status !== 'pass') return;
      const was = prev.submissions[sub.submissionId];
      if (!was || was.status === 'pass') return;
      candidates.push(
        sub.roadId
          ? { key: `cleared:road:${sub.roadId}`, kind: 'cleared', roadId: sub.roadId, coinsGained }
          : { key: `cleared:${sub.waypointId}`, kind: 'cleared', waypointId: sub.waypointId, coinsGained }
      );
    });

    next.roads.forEach((road) => {
      if (!road.challengeId || road.completedBy !== teamId) return;
      const was = prev.roads.find((r) => r.id === road.id);
      if (!was || was.completedBy === teamId) return;
      candidates.push({ key: `cleared:road:${road.id}`, kind: 'cleared', roadId: road.id, coinsGained });
    });
  }

  candidates.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind]);
  const celebration = candidates[0] ?? null;

  const rival: RivalEvent[] = [];

  const frozenUntil = next.effects[teamId]?.frozenUntil;
  if (frozenUntil && frozenUntil !== prev.effects[teamId]?.frozenUntil) {
    rival.push({ key: `nerfed:${frozenUntil}`, kind: 'nerfed' });
  }

  const rivalWon = next.winner && next.winner !== teamId && next.winner !== prev.winner ? next.winner : null;
  if (rivalWon && next.mode === 'team') {
    rival.push({ key: `rival-won:${rivalWon}`, kind: 'rival_won', teamId: rivalWon });
  }

  Object.entries(next.progress).forEach(([id, progress]) => {
    if (id === teamId || id === rivalWon || !progress.reachedFinish) return;
    if (prev.progress[id]?.reachedFinish) return;
    rival.push({ key: `rival-finished:${id}`, kind: 'rival_finished', teamId: id });
  });

  const deadline = next.coinRush?.deadline;
  if (deadline && !prev.coinRush?.deadline) {
    rival.push({
      key: `countdown:${deadline}`,
      kind: 'countdown_started',
      seconds: next.ruleset.coinRushCountdownSeconds
    });
  }

  if (!celebration && rival.length === 0) return EMPTY;
  return { celebration, rival };
}

/** Feeds successive states in and returns only moments that are new, once each. */
export interface MomentTracker {
  observe: (state: GameState) => MomentBatch;
}

/**
 * The first state seen, and any state before the first snapshot, is only a baseline,
 * so a page reload or a reconnect never replays what already happened.
 */
export function createMomentTracker(teamId: string): MomentTracker {
  let prev: GameState | null = null;
  const seen = new Set<string>();

  return {
    observe(state) {
      const before = prev;
      prev = state;
      if (!before || before.gameId !== state.gameId || before.lastSequence === 0 || state.lastSequence === 0) {
        return EMPTY;
      }
      if (before === state) return EMPTY;

      const batch = diffMoments(before, state, teamId);
      const celebration = batch.celebration && !seen.has(batch.celebration.key) ? batch.celebration : null;
      const rival = batch.rival.filter((event) => !seen.has(event.key));
      if (celebration) seen.add(celebration.key);
      rival.forEach((event) => seen.add(event.key));
      if (!celebration && rival.length === 0) return EMPTY;
      return { celebration, rival };
    }
  };
}
