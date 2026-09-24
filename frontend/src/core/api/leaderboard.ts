/** Leaderboard API routes and entry types for solo runs. */
import type { VerificationMode } from '../projection/projectionStore';
import { request } from './http';

export interface SoloRunRuleset {
  coin_reward_min: number;
  coin_reward_max: number;
  veto_penalty_min_seconds: number;
  veto_penalty_max_seconds: number;
  powerup_costs: Record<string, number>;
  reward_only_first_completer: boolean;
  freeze_duration_seconds: number;
  tracker_off_duration_seconds: number;
  curse_duration_seconds: number;
  veto_time_penalty_seconds: number;
  coin_rush_finish_bonuses: number[];
  coin_rush_late_finish_bonus: number;
  coin_rush_countdown_seconds: number;
  verification: VerificationMode;
}

export interface LeaderboardEntry {
  rank: number;
  run_id: string;
  game_id: string;
  board_version: number;
  runner_name: string;
  elapsed_seconds: number;
  veto_count: number;
  skip_count: number;
  veto_penalty_seconds: number;
  coins: number;
  finished_at: string;
  /** How this run's evidence was graded. */
  verification: VerificationMode;
  /** Effective settings that governed the run. */
  ruleset: SoloRunRuleset;
}

/** Submits a completed solo run to the board leaderboard. */
export function postLeaderboardTime(
  gameId: string,
  teamToken: string
): Promise<{ board_id: string; run: LeaderboardEntry }> {
  return request(`/api/games/${gameId}/leaderboard`, { method: 'POST', token: teamToken, body: JSON.stringify({}) });
}

/** Public. Fastest recorded runs on a board, ascending, across every version. */
export function getBoardLeaderboard(
  boardId: string,
  limit = 25
): Promise<{ board_id: string; current_version: number | null; entries: LeaderboardEntry[] }> {
  return request(`/api/boards/${boardId}/leaderboard?limit=${limit}`, { method: 'GET' });
}
