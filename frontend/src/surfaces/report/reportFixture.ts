import type { RaceReport } from '../../core/api/client';

type Row = RaceReport['standings'][number];

/** A standings row for tests. */
export const row = (id: string, over: Partial<Row> = {}): Row => ({
  team_id: id,
  team_name: id.toUpperCase(),
  waypoints_reached: 0,
  distance_to_finish: 100,
  coins: 0,
  coins_visible: true,
  finished: false,
  ...over,
});

/** A minimal ended team race report for tests. */
export function makeReport(over: Partial<RaceReport> = {}): RaceReport {
  return {
    game_id: 'g1',
    mode: 'team',
    status: 'ended',
    verification: 'llm',
    board_id: 'b1',
    board_version: 1,
    board_name: 'Canal Dash',
    created_at: '2026-01-01T10:00:00Z',
    retention: { days: 14, expires_at: '2026-01-15T10:00:00Z', can_delete_all: true, can_delete_mine: false },
    teams: {},
    standings: [],
    clock: { time_penalty_seconds: 0, veto_count: 0, skip_count: 0 },
    stats: {
      submissions: 5,
      passed: 3,
      failed: 2,
      pending: 0,
      vetoes: 0,
      challenge_skips: 0,
      waypoints_reached: 4,
      disputes: 0,
      disputes_upheld: 0,
      disputes_overturned: 0,
      gm_overrides: 0,
      coins_earned: 0,
      coins_spent: 0,
      finish_bonuses: 0,
      powerups_bought: 0,
      powerups_used: 0,
      roadblocks_placed: 0,
      curses_played: 0,
      flagged_arrivals: 0,
      photos_stored: 0,
      photos_deleted: 0,
      duration_seconds: 1830,
    },
    evidence: [],
    timeline: [],
    ...over,
  } as RaceReport;
}
