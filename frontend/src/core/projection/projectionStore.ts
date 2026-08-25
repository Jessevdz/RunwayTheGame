/** Reactive store holding live snapshot state received from the backend projection stream. */

import { loadTeamSession } from '../game/teamSession';

export interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  arrival_radius_m: number;
  isStart: boolean;
  isFinish: boolean;
  challengeId?: string;
}

export interface Road {
  id: string;
  waypointA: string;
  waypointB: string;
  challengeId: string;
  lockState: 'locked' | 'open' | 'bypassed';
  completedBy: string | null;
  lengthM: number;
}

export interface RaceStanding {
  teamId: string;
  teamName: string;
  waypointsReached: number;
  distanceToFinishM: number;
  coins: number;
  finished: boolean;
  finishRank: number;
  /** What the placing paid. Coin rush only; zero everywhere else. */
  finishBonus: number;
}

export interface TeamInfo {
  name: string;
  slotIndex: number;
}

export type Powerup = 'nerf' | 'roadblock' | 'tracker_off' | 'curse' | 'challenge_skip';

export interface Curse {
  id: string;
  card_id: string;
  text: string;
}

/** One team's active effects (freezes, tracker-off deadlines, veto penalties, curses). */
export interface TeamEffects {
  frozenUntil?: string;
  trackerOffUntil?: string;
  vetoPenaltyUntil?: string;
  curses: Curse[];
}

export interface Roadblock {
  roadId: string;
  placedBy: string;
  cardId: string;
  challengeText: string;
  /** Teams that have worked this roadblock off. The first one lifts the card. */
  clearedBy: Record<string, boolean>;
}

/** Returns true if a placed roadblock blocks the specified team. */
export function roadblockBlocksTeam(roadblock: Roadblock | undefined, teamId: string): boolean {
  if (!roadblock || roadblock.placedBy === teamId) return false;
  return !Object.values(roadblock.clearedBy).some(Boolean);
}

/** Returns the furthest-out ISO timestamp string between current and candidate. */
function laterOf(current: string | undefined, candidate: string): string {
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

export interface DisputeInfo {
  verdictId: string;
  byTeamId: string;
  objection: string;
  status: 'pending' | 'upheld' | 'overturned';
  source: string;
}

export interface TeamProgress {
  currentWaypointId: string;
  traversedRoads: string[];
  clearedWaypoints: string[];
  reachedFinish: boolean;
}

export interface SubmissionInfo {
  submissionId: string;
  teamId: string;
  waypointId: string;
  roadId: string;
  challengeId: string;
  blobRef: string;
  status: 'pending' | 'pass' | 'fail';
  confidence: number;
  rationale: string;
  /**
   * What graded it, folded from the verdict event — not from the game's current
   * setting, so it stays true for evidence graded before a setting changed.
   * Empty while pending, and on verdicts predating the choice.
   */
  source: VerificationMode | '';
  createdAt: string;
}

/** Photo evidence verification mode ('llm', 'host', or 'trust'). */
export type VerificationMode = 'llm' | 'host' | 'trust';

/** True when a photo taken in this mode is sent to a third-party model. */
export const gradedByModel = (v: VerificationMode): boolean => v === 'llm';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'catching_up';

/** Supported game modes. */
export type GameMode = 'team' | 'solo_time_trial' | 'solo_casual' | 'coin_rush';

export const isSoloMode = (mode: GameMode): boolean =>
  mode === 'solo_time_trial' || mode === 'solo_casual';

/** Returns true if mode is coin_rush. */
export const isCoinRush = (mode: GameMode): boolean => mode === 'coin_rush';

/** Solo run timer state. */
export interface RunClock {
  /** ISO timestamp, or null before the run is live. */
  startedAt: string | null;
  /** ISO timestamp, or null while the run is still going — which is the signal to keep ticking. */
  finishedAt: string | null;
  /** Every veto penalty this run has earned, in seconds. Zero outside a time trial. */
  timePenaltySeconds: number;
  /** Challenges walked away from, penalised or not. */
  vetoCount: number;
}

/** Returns elapsed seconds for a solo run clock based on start/finish timestamps and penalties. */
export function elapsedSeconds(clock: RunClock, nowMs: number): number {
  if (!clock.startedAt) return 0;
  const start = new Date(clock.startedAt).getTime();
  const end = clock.finishedAt ? new Date(clock.finishedAt).getTime() : nowMs;
  const wall = Math.max(0, Math.floor((end - start) / 1000));
  return wall + Math.max(0, clock.timePenaltySeconds);
}

/** Game rules configuration parameters exposed to UI components. */
export interface RulesetView {
  /** Cooldown floor a team-race veto is clamped to, in seconds. */
  vetoPenaltyMinSeconds: number;
  /** What a time-trial veto adds to the recorded clock, in seconds. */
  vetoTimePenaltySeconds: number;
  /** How long the field has once the first coin rush team is home, in seconds. */
  coinRushCountdownSeconds: number;
  /** The coin rush placement ladder, best first, so a console can quote what a finish is worth. */
  coinRushFinishBonuses: number[];
  /** Who grades this game's photos. */
  verification: VerificationMode;
}

/** One team's crossing in a coin rush, in the order it happened. */
export interface CoinRushFinisher {
  teamId: string;
  rank: number;
  bonusCoins: number;
  finishedAt: string;
}

/** Coin rush mode countdown state and finisher rankings. */
export interface CoinRushView {
  firstFinishAt: string | null;
  deadline: string | null;
  finishers: CoinRushFinisher[];
}

export interface GameState {
  boardId: string | null;
  boardName: string;
  gameId: string | null;
  /** Games that predate modes, and every team race, are 'team'. */
  mode: GameMode;
  clock: RunClock;
  /** Only set in a coin rush, and only once somebody is home. */
  coinRush: CoinRushView | null;
  ruleset: RulesetView;
  state: 'draft' | 'live' | 'ended';
  waypoints: Waypoint[];
  roads: Road[];
  teams: { [teamId: string]: TeamInfo };
  standings: RaceStanding[];
  positions: Record<string, { lat: number; lon: number; accuracy: number; reportedAt: string }>;
  coins: Record<string, number>;
  inventory: Record<string, Powerup[]>;
  effects: Record<string, TeamEffects>;
  roadblocks: Record<string, Roadblock>;
  waypointStates: Record<string, { clearedBy: Record<string, boolean>; bypassed: Record<string, boolean> }>;
  winner: string | null;
  disputes: { [verdictId: string]: DisputeInfo };
  progress: Record<string, TeamProgress>;
  submissions: Record<string, SubmissionInfo>;
  logs: string[];
  lastSequence: number;
  connection: ConnectionState;
}

const emptyClock: RunClock = { startedAt: null, finishedAt: null, timePenaltySeconds: 0, vetoCount: 0 };

// Default ruleset view configuration fallbacks.
const defaultRulesetView: RulesetView = {
  vetoPenaltyMinSeconds: 900,
  vetoTimePenaltySeconds: 900,
  coinRushCountdownSeconds: 1800,
  coinRushFinishBonuses: [150, 100, 60, 30],
  verification: 'llm'
};

const initialGameState: GameState = {
  boardId: null,
  boardName: '',
  gameId: null,
  mode: 'team',
  clock: emptyClock,
  coinRush: null,
  ruleset: defaultRulesetView,
  state: 'draft',
  waypoints: [],
  roads: [],
  teams: {},
  standings: [],
  positions: {},
  coins: {},
  inventory: {},
  effects: {},
  roadblocks: {},
  waypointStates: {},
  winner: null,
  disputes: {},
  progress: {},
  submissions: {},
  logs: [],
  lastSequence: 0,
  connection: 'disconnected'
};

/** Standings row wire format. */
type StandingsWire = {
  team_id: string;
  team_name: string;
  waypoints_reached: number;
  distance_to_finish: number;
  coins: number;
  finished?: boolean;
  finish_rank?: number;
  finish_bonus?: number;
}[];

/** Raw snapshot payload pushed by backend WebSocket. */
export interface RawSnapshot {
  game_id: string;
  /** Folded from the event stream. Optional only while a new client can meet an old server. */
  status?: 'draft' | 'live' | 'ended';
  /** Absent on a server that predates modes, where every game is a team race. */
  mode?: GameMode;
  /** Only meaningful in a solo mode; a team race never reads it. */
  clock?: {
    started_at?: string;
    finished_at?: string;
    time_penalty_seconds?: number;
    veto_count?: number;
  };
  /** Absent outside a coin rush, and until the first team is home. */
  coin_rush?: {
    first_finish_at?: string;
    deadline?: string;
    finishers?: { team_id: string; rank: number; bonus_coins: number; finished_at: string }[];
  };
  /** The game's stored tunables. Absent on a server that predates the field. */
  ruleset?: {
    veto_penalty_min_seconds?: number;
    veto_time_penalty_seconds?: number;
    coin_rush_countdown_seconds?: number;
    coin_rush_finish_bonuses?: number[];
    verification?: VerificationMode;
  };
  board: {
    id: string;
    name: string;
    waypoints: { id: string; name: string; lat: number; lon: number; arrival_radius_m: number; is_start: boolean; is_finish: boolean; challenge_id?: string }[];
    roads: { id: string; waypoint_id_a?: string; waypoint_id_b?: string; waypoint_a?: string; waypoint_b?: string; challenge_id?: string; length_m: number }[];
  };
  teams: { [teamId: string]: { name: string; slot_index: number } };
  waypoint_states?: { [waypointId: string]: { cleared_by?: { [teamId: string]: boolean }; bypassed?: { [teamId: string]: boolean } } };
  road_states?: { [roadId: string]: { completed_by: string | null; bypassed_teams?: string[]; bypassed?: { [teamId: string]: boolean } } };
  positions: { [teamId: string]: { lat: number; lon: number; accuracy_m: number; reported_at: string } };
  coins: { [teamId: string]: number };
  inventory: { [teamId: string]: Powerup[] };
  /** Active effect rows per team. */
  effects: {
    [teamId: string]: { kind: string; until: string; meta?: string }[];
  };
  roadblocks: {
    [roadId: string]: {
      road_id: string;
      placed_by: string;
      card_id?: string;
      challenge_text: string;
      cleared_by?: { [teamId: string]: boolean };
    };
  };
  /** Accepts standings data from websocket (`standings_list`) or API response (`standings`). */
  standings_list?: StandingsWire;
  standings?: StandingsWire;
  winner: string | null;
  public_log: string[];
  last_sequence: number;
  disputes: {
    [verdictId: string]: { verdict_id: string; by_team_id: string; objection: string; status: string; source: string };
  };
  progress?: {
    [teamId: string]: {
      current_waypoint_id: string;
      traversed_roads: string[];
      cleared_waypoints: string[];
      reached_finish: boolean;
    };
  };
  submissions?: {
    [submissionId: string]: {
      submission_id: string;
      team_id: string;
      waypoint_id?: string;
      road_id?: string;
      challenge_id: string;
      blob_ref: string;
      status: string;
      confidence: number;
      rationale: string;
      source?: VerificationMode;
      created_at: string;
    };
  };
}

type Listener = (state: GameState) => void;

class ProjectionStore {
  private state: GameState = { ...initialGameState };
  private listeners: Set<Listener> = new Set();

  getState(): GameState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((listener) => listener(this.state));
  }

  reset() {
    this.state = { ...initialGameState, connection: this.state.connection };
    this.emit();
  }

  setConnectionState(status: ConnectionState) {
    this.state = { ...this.state, connection: status };
    this.emit();
  }

  /** Seed gameId from invite link before WebSocket snapshot arrives. */
  setGameId(gameId: string) {
    if (!gameId || this.state.gameId === gameId) return;
    this.state = { ...this.state, gameId };
    this.emit();
  }

  /** Applies a full server snapshot to update the store state. */
  applySnapshot(raw: RawSnapshot) {
    const gameId = raw.game_id || this.state.gameId;
    const session = gameId ? loadTeamSession(gameId) : null;
    const teamId = session?.teamId || null;

    const waypoints: Waypoint[] = (raw.board?.waypoints || []).map((w) => ({
      id: w.id,
      name: w.name,
      lat: w.lat,
      lon: w.lon,
      arrival_radius_m: w.arrival_radius_m,
      isStart: w.is_start,
      isFinish: w.is_finish,
      challengeId: w.challenge_id || ''
    }));

    const roads: Road[] = (raw.board?.roads || []).map((s) => {
      const state = raw.road_states?.[s.id];
      let lockState: Road['lockState'] = 'locked';
      if (state) {
        if (state.completed_by) {
          lockState = 'open';
        } else if (teamId && (state.bypassed_teams?.includes(teamId) || state.bypassed?.[teamId])) {
          lockState = 'bypassed';
        }
      }
      return {
        id: s.id,
        waypointA: s.waypoint_id_a || s.waypoint_a || '',
        waypointB: s.waypoint_id_b || s.waypoint_b || '',
        // Omitted by the server when the road carries no gating challenge,
        // and raceAccessibility reads its absence as "open road".
        challengeId: s.challenge_id || '',
        lockState,
        completedBy: state?.completed_by || null,
        lengthM: s.length_m
      };
    });

    const teams: { [teamId: string]: TeamInfo } = {};
    Object.entries(raw.teams || {}).forEach(([tId, info]) => {
      teams[tId] = { name: info.name, slotIndex: info.slot_index };
    });

    const standings: RaceStanding[] = (raw.standings_list || raw.standings || []).map((s) => ({
      teamId: s.team_id,
      teamName: s.team_name,
      waypointsReached: s.waypoints_reached,
      distanceToFinishM: s.distance_to_finish,
      coins: s.coins,
      finished: s.finished ?? false,
      finishRank: s.finish_rank ?? 0,
      finishBonus: s.finish_bonus ?? 0
    }));

    const positions: Record<string, { lat: number; lon: number; accuracy: number; reportedAt: string }> = {};
    Object.entries(raw.positions || {}).forEach(([tId, p]) => {
      positions[tId] = {
        lat: p.lat,
        lon: p.lon,
        accuracy: p.accuracy_m,
        reportedAt: p.reported_at
      };
    });

    const coins: Record<string, number> = raw.coins || {};
    const inventory: Record<string, Powerup[]> = raw.inventory || {};
    const effects: Record<string, TeamEffects> = {};
    Object.entries(raw.effects || {}).forEach(([tId, rows]) => {
      const view: TeamEffects = { curses: [] };
      (rows || []).forEach((row) => {
        switch (row.kind) {
          case 'freeze':
            view.frozenUntil = laterOf(view.frozenUntil, row.until);
            break;
          case 'tracker_off':
            view.trackerOffUntil = laterOf(view.trackerOffUntil, row.until);
            break;
          case 'veto_penalty':
            view.vetoPenaltyUntil = laterOf(view.vetoPenaltyUntil, row.until);
            break;
          case 'curse':
            /* The wire carries the card's id but not its text — that only ever
               appears in the race log — so a surface that wants the words has
               to go and get them. The curse UI is disabled in the PoC. */
            view.curses.push({ id: row.meta || '', card_id: row.meta || '', text: '' });
            break;
        }
      });
      effects[tId] = view;
    });

    // The server speaks snake_case. Passing the raw object straight through
    // typed as Roadblock left every camelCase field undefined at runtime, which
    // is why a placed roadblock rendered with no card text and no owner.
    const roadblocks: Record<string, Roadblock> = {};
    Object.entries(raw.roadblocks || {}).forEach(([roadId, rb]) => {
      roadblocks[roadId] = {
        roadId: rb.road_id || roadId,
        placedBy: rb.placed_by,
        cardId: rb.card_id || '',
        challengeText: rb.challenge_text,
        clearedBy: rb.cleared_by || {}
      };
    });
    const waypointStates: Record<string, { clearedBy: Record<string, boolean>; bypassed: Record<string, boolean> }> = {};
    Object.entries(raw.waypoint_states || {}).forEach(([nId, ns]) => {
      waypointStates[nId] = {
        clearedBy: ns.cleared_by || {},
        bypassed: ns.bypassed || {}
      };
    });
    const winner: string | null = raw.winner || null;

    const disputes: { [verdictId: string]: DisputeInfo } = {};
    Object.entries(raw.disputes || {}).forEach(([id, d]) => {
      disputes[id] = {
        verdictId: d.verdict_id,
        byTeamId: d.by_team_id,
        objection: d.objection,
        status: d.status === 'upheld' || d.status === 'overturned' ? d.status : 'pending',
        source: d.source
      };
    });

    const progress: Record<string, TeamProgress> = {};
    Object.entries(raw.progress || {}).forEach(([tId, p]) => {
      progress[tId] = {
        currentWaypointId: p.current_waypoint_id,
        traversedRoads: p.traversed_roads || [],
        clearedWaypoints: p.cleared_waypoints || [],
        reachedFinish: p.reached_finish
      };
    });

    const submissions: Record<string, SubmissionInfo> = {};
    Object.entries(raw.submissions || {}).forEach(([id, s]) => {
      submissions[id] = {
        submissionId: s.submission_id,
        teamId: s.team_id,
        waypointId: s.waypoint_id || s.road_id || '',
        roadId: s.road_id || '',
        challengeId: s.challenge_id,
        blobRef: s.blob_ref,
        status: s.status as SubmissionInfo['status'],
        confidence: s.confidence,
        rationale: s.rationale,
        source: s.source ?? '',
        createdAt: s.created_at
      };
    });

    // Derives game state from raw status or log fallback.
    const logs = raw.public_log || [];
    let derivedState: GameState['state'] = 'draft';
    if (raw.status) {
      derivedState = raw.status;
    } else if (logs.some((l) => l.includes('Game ended'))) derivedState = 'ended';
    else if (logs.some((l) => l.includes('Game started'))) derivedState = 'live';

    // Mapped field by field, like everything else here. The server speaks
    // snake_case, and a payload assumed to be camelCase is the exact shape of
    // bug that left placed roadblocks with no card text.
    const mode: GameMode = raw.mode || 'team';
    const clock: RunClock = {
      startedAt: raw.clock?.started_at || null,
      finishedAt: raw.clock?.finished_at || null,
      timePenaltySeconds: raw.clock?.time_penalty_seconds ?? 0,
      vetoCount: raw.clock?.veto_count ?? 0
    };
    const ruleset: RulesetView = {
      vetoPenaltyMinSeconds: raw.ruleset?.veto_penalty_min_seconds ?? defaultRulesetView.vetoPenaltyMinSeconds,
      vetoTimePenaltySeconds: raw.ruleset?.veto_time_penalty_seconds ?? defaultRulesetView.vetoTimePenaltySeconds,
      coinRushCountdownSeconds:
        raw.ruleset?.coin_rush_countdown_seconds ?? defaultRulesetView.coinRushCountdownSeconds,
      coinRushFinishBonuses: raw.ruleset?.coin_rush_finish_bonuses ?? defaultRulesetView.coinRushFinishBonuses,
      verification: raw.ruleset?.verification ?? defaultRulesetView.verification
    };
    // Null rather than an empty object when the key is absent: "no countdown is
    // running" and "a countdown of zero" have to stay distinguishable, and the
    // server omits the key precisely so they do.
    const coinRush: CoinRushView | null = raw.coin_rush
      ? {
          firstFinishAt: raw.coin_rush.first_finish_at || null,
          deadline: raw.coin_rush.deadline || null,
          finishers: (raw.coin_rush.finishers || []).map((f) => ({
            teamId: f.team_id,
            rank: f.rank,
            bonusCoins: f.bonus_coins,
            finishedAt: f.finished_at
          }))
        }
      : null;

    this.state = {
      ...this.state,
      boardId: raw.board?.id || null,
      boardName: raw.board?.name || '',
      gameId,
      mode,
      clock,
      coinRush,
      ruleset,
      state: derivedState,
      waypoints,
      roads,
      teams,
      standings,
      positions,
      coins,
      inventory,
      effects,
      roadblocks,
      waypointStates,
      winner,
      disputes,
      progress,
      submissions,
      logs,
      lastSequence: raw.last_sequence || 0
    };
    this.emit();
  }
}

export const projectionStore = new ProjectionStore();
