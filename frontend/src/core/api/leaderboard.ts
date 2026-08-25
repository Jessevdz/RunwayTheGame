/** Leaderboard API routes and entry types for solo runs. */
import type { VerificationMode } from '../projection/projectionStore';
import { request } from './http';

export interface LeaderboardEntry {
  rank: number;
  run_id: string;
  game_id: string;
  board_version: number;
  runner_name: string;
  elapsed_seconds: number;
  veto_count: number;
  veto_penalty_seconds: number;
  coins: number;
  finished_at: string;
  /** How this run's evidence was graded. */
  verification: VerificationMode;
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
