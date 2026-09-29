import type { RaceReport } from '../../core/api/client';
import { formatClock, formatDurationWords } from '../../core/format/clock';

type Standing = RaceReport['standings'][number];

/** The shape of the headline the report leads with. */
export type ResultKind = 'winner' | 'tie' | 'no-finishers' | 'open' | 'empty' | 'solo-finished' | 'solo-dnf';

export interface RankedStanding {
  teamId: string;
  teamName: string;
  /** Competition rank: tied teams share a place and the next place is skipped (1, 1, 3). */
  place: number;
  finished: boolean;
  waypoints: number;
  coins: number | null;
  coinsVisible: boolean;
  finishRank: number;
  finishBonus: number;
}

export interface RaceResult {
  kind: ResultKind;
  /** Every team in finishing order with its place. */
  ranked: RankedStanding[];
  /** Teams holding first place, more than one on a tie and none when there is no result. */
  leaders: RankedStanding[];
  /** Teams holding second or third place. */
  runnersUp: RankedStanding[];
  /** Solo elapsed seconds including penalties, present only for a solo run that finished. */
  soloSeconds?: number;
}

export interface StatTile {
  id: string;
  label: string;
  value: string | number;
  hint?: string;
  /** Renders the coin glyph ahead of the value. */
  coin?: boolean;
  tone?: 'hot' | 'warm' | 'bright';
}

export interface StatTiles {
  key: StatTile[];
  more: StatTile[];
}

export interface RetentionNotice {
  kind: 'info' | 'warn';
  title: string;
  body: string;
}

export const isSolo = (mode: string): boolean => mode === 'solo_time_trial' || mode === 'solo_casual';

/** "1st", "2nd", "3rd" with teens excepted (11th, not 11st). */
export const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

/** Two teams tie only when every visible score the server sorted them by matches. */
function tiedWith(mode: string, a: Standing, b: Standing): boolean {
  if (a.coins_visible === false || b.coins_visible === false) return false;
  if (mode === 'coin_rush') {
    return a.coins === b.coins && (a.finish_rank ?? 0) === (b.finish_rank ?? 0);
  }
  return a.finished === b.finished && a.distance_to_finish === b.distance_to_finish && a.coins === b.coins;
}

/** Solo elapsed seconds including time penalties, or undefined when the run never finished. */
export function soloElapsedSeconds(report: RaceReport): number | undefined {
  const { started_at, finished_at, time_penalty_seconds } = report.clock;
  if (!finished_at || !started_at) return undefined;
  const raw = Math.round((Date.parse(finished_at) - Date.parse(started_at)) / 1000);
  if (Number.isNaN(raw)) return undefined;
  return Math.max(0, raw) + time_penalty_seconds;
}

/** Ranks the standings and works out which headline the report should lead with. */
export function computeRaceResult(report: RaceReport): RaceResult {
  const winnerId = report.winner_team_id;
  const rows = [...report.standings];
  const coinRush = report.mode === 'coin_rush';

  // The event log names the winner, so a recorded winner always sorts first.
  if (winnerId && !coinRush) {
    const idx = rows.findIndex((r) => r.team_id === winnerId);
    if (idx > 0) rows.unshift(rows.splice(idx, 1)[0]);
  }

  const ranked: RankedStanding[] = [];
  rows.forEach((row, i) => {
    const previous = rows[i - 1];
    const isWinnerRow = !coinRush && !!winnerId && (row.team_id === winnerId || previous?.team_id === winnerId);
    const shares = previous !== undefined && !isWinnerRow && tiedWith(report.mode, previous, row);
    ranked.push({
      teamId: row.team_id,
      teamName: row.team_name,
      place: shares ? ranked[i - 1].place : i + 1,
      finished: row.finished,
      waypoints: row.waypoints_reached,
      coins: row.coins_visible === false ? null : row.coins,
      coinsVisible: row.coins_visible !== false,
      finishRank: row.finish_rank ?? 0,
      finishBonus: row.finish_bonus ?? 0,
    });
  });

  const runnersUp = ranked.filter((r) => r.place === 2 || r.place === 3);
  const top = ranked.filter((r) => r.place === 1);

  if (isSolo(report.mode)) {
    const soloSeconds = soloElapsedSeconds(report);
    const kind: ResultKind = report.status !== 'ended' ? 'open' : soloSeconds === undefined ? 'solo-dnf' : 'solo-finished';
    return { kind, ranked, leaders: top.slice(0, 1), runnersUp: [], soloSeconds };
  }

  if (ranked.length === 0) return { kind: 'empty', ranked, leaders: [], runnersUp: [] };
  if (report.status !== 'ended') return { kind: 'open', ranked, leaders: top, runnersUp };

  // A team race is decided by reaching the finish, so a race nobody finished has no winner.
  const anyoneFinished = coinRush ? !!winnerId || ranked.some((r) => r.finishRank > 0) : !!winnerId || ranked.some((r) => r.finished);
  if (!anyoneFinished) return { kind: 'no-finishers', ranked, leaders: top, runnersUp };

  return { kind: top.length > 1 ? 'tie' : 'winner', ranked, leaders: top, runnersUp };
}

/** The score line shown beside a team on the podium, in the vocabulary of the mode. */
export function entryMetric(mode: string, entry: RankedStanding): string {
  if (mode === 'coin_rush') {
    const coins = entry.coinsVisible ? `${entry.coins} ${entry.coins === 1 ? 'coin' : 'coins'}` : 'Coins hidden';
    return entry.finishRank > 0 ? `${coins} · ${ordinal(entry.finishRank)} across the line` : coins;
  }
  if (entry.finished) return 'Reached the finish';
  return `${entry.waypoints} ${entry.waypoints === 1 ? 'waypoint' : 'waypoints'}`;
}

/** The lead-in label above the hero, one short phrase. */
export function heroEyebrow(result: RaceResult): string {
  switch (result.kind) {
    case 'winner':
      return 'WINNER';
    case 'tie':
      return 'TIED FOR FIRST';
    case 'no-finishers':
      return 'NO ONE FINISHED';
    case 'open':
      return 'STILL RACING';
    case 'empty':
      return 'NO TEAMS';
    case 'solo-finished':
      return 'FINISHED IN';
    case 'solo-dnf':
      return 'DID NOT FINISH';
  }
}

/** The end-of-race stat tiles, four that matter and the rest behind an expander. */
export function buildStatTiles(report: RaceReport): StatTiles {
  const s = report.stats;
  const solo = isSolo(report.mode);
  const penalty = report.clock.time_penalty_seconds;
  const all: StatTile[] = [
    { id: 'route', label: 'On the route', value: formatClock(s.duration_seconds), tone: 'bright' },
    { id: 'waypoints', label: 'Waypoints', value: s.waypoints_reached },
    {
      id: 'approved',
      label: 'Photos approved',
      value: s.passed,
      hint: `of ${s.submissions} taken${s.photos_deleted > 0 ? `, ${s.photos_deleted} since deleted` : ''}`,
    },
  ];

  if (report.mode === 'coin_rush') {
    all.push({ id: 'coins-earned', label: 'Coins earned', value: s.coins_earned, coin: true });
  } else if (solo) {
    all.push({
      id: 'vetoes',
      label: 'Vetoes',
      value: s.vetoes,
      hint: penalty > 0 ? `+${formatDurationWords(penalty)}` : undefined,
    });
  } else {
    all.push({
      id: 'disputes',
      label: 'Disputes',
      value: s.disputes,
      hint: s.disputes > 0 ? `${s.disputes_overturned} overturned` : undefined,
    });
  }

  const rest: StatTile[] = [
    { id: 'rejected', label: 'Rejected', value: s.failed },
    ...(s.pending > 0 ? [{ id: 'pending', label: 'Never graded', value: s.pending }] : []),
    { id: 'vetoes', label: 'Vetoes', value: s.vetoes, hint: solo && penalty > 0 ? `+${formatDurationWords(penalty)}` : undefined },
    { id: 'skipped', label: 'Skipped', value: s.challenge_skips },
    { id: 'coins-earned', label: 'Coins earned', value: s.coins_earned, coin: true },
    { id: 'coins-spent', label: 'Coins spent', value: s.coins_spent, coin: true },
    ...(s.finish_bonuses > 0 ? [{ id: 'bonus', label: 'Paid at the line', value: s.finish_bonuses, coin: true }] : []),
    ...(s.powerups_used > 0
      ? [{ id: 'powerups', label: 'Powerups used', value: s.powerups_used, hint: `${s.powerups_bought} bought` }]
      : []),
    ...(s.roadblocks_placed > 0 ? [{ id: 'roadblocks', label: 'Roadblocks', value: s.roadblocks_placed }] : []),
    ...(s.curses_played > 0 ? [{ id: 'curses', label: 'Curses', value: s.curses_played }] : []),
    ...(!solo
      ? [
        {
          id: 'disputes',
          label: 'Disputes',
          value: s.disputes,
          hint: s.disputes > 0 ? `${s.disputes_overturned} overturned` : undefined,
        },
      ]
      : []),
    ...(s.gm_overrides > 0 ? [{ id: 'overrides', label: 'Host overrides', value: s.gm_overrides }] : []),
    ...(s.flagged_arrivals > 0 ? [{ id: 'odd-arrivals', label: 'Odd arrivals', value: s.flagged_arrivals }] : []),
  ];

  const shown = new Set(all.map((t) => t.id));
  return { key: all, more: rest.filter((t) => !shown.has(t.id)) };
}

/** Whole days until the report is deleted, never negative. */
export function daysUntil(expiresAt: string, now: number): number | null {
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.ceil((ts - now) / 86_400_000));
}

/** The retention notice, or null when there is no usable expiry to state. */
export function retentionNotice(report: RaceReport, now: number): RetentionNotice | null {
  const days = report.retention?.expires_at ? daysUntil(report.retention.expires_at, now) : null;
  if (days === null) return null;
  const title = days === 0 ? 'This report expires today' : `This report is deleted in ${days} ${days === 1 ? 'day' : 'days'}`;
  return {
    kind: days <= 3 ? 'warn' : 'info',
    title,
    body: 'Photos, positions and standings go with it.',
  };
}
