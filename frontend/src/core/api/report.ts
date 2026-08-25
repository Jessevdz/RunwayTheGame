/** Race report API routes and summary data types. */
import type { GameMode, VerificationMode } from '../projection/projectionStore';
import { request } from './http';

/** One photograph submission detail. */
export interface ReportEvidence {
  submission_id: string;
  team_id: string;
  team_name: string;
  kind: 'challenge' | 'roadblock';
  waypoint_id?: string;
  waypoint_name?: string;
  road_id?: string;
  challenge_id?: string;
  prompt?: string;
  status: 'pending' | 'pass' | 'fail';
  /** What graded it, as recorded on the verdict rather than the game's setting. */
  source?: VerificationMode;
  confidence?: number;
  rationale?: string;
  disputed: boolean;
  dispute_status?: string;
  /** Presigned and short-lived. Absent when the photo is gone or no store is configured. */
  photo_url?: string;
  /** Set once the photograph itself has been destroyed. Distinguishes gone from never-stored. */
  photo_deleted_at?: string;
  lat?: number;
  lon?: number;
  accuracy_m?: number;
  client_captured_at?: string;
  submitted_at: string;
}

/** The race in numbers, counted server-side from the event log. */
export interface ReportStats {
  submissions: number;
  passed: number;
  failed: number;
  pending: number;
  vetoes: number;
  waypoints_reached: number;
  disputes: number;
  disputes_upheld: number;
  disputes_overturned: number;
  gm_overrides: number;
  coins_earned: number;
  coins_spent: number;
  finish_bonuses: number;
  powerups_bought: number;
  powerups_used: number;
  roadblocks_placed: number;
  curses_played: number;
  flagged_arrivals: number;
  photos_stored: number;
  photos_deleted: number;
  duration_seconds: number;
}

export interface RaceReport {
  game_id: string;
  race_code?: string;
  mode: GameMode;
  status: 'draft' | 'live' | 'ended';
  verification: VerificationMode;
  board_id: string;
  board_version: number;
  board_name: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  retention: {
    days: number;
    expires_at: string;
    /** Host capability: may destroy the whole race, every team's photos included. */
    can_delete_all: boolean;
    /** Team capability: may take its own photos down without ending the record. */
    can_delete_mine: boolean;
  };
  winner_team_id?: string;
  winner_name?: string;
  teams: Record<string, { name: string; slot_index: number }>;
  standings: Array<{
    team_id: string;
    team_name: string;
    waypoints_reached: number;
    distance_to_finish: number;
    coins: number;
    finished: boolean;
    finish_rank?: number;
    finish_bonus?: number;
  }>;
  clock: { started_at?: string; finished_at?: string; time_penalty_seconds: number; veto_count: number };
  stats: ReportStats;
  evidence: ReportEvidence[];
  timeline: string[];
}

/** Fetches race summary report. Requires host or team token. */
export function getRaceReport(gameId: string, token: string): Promise<RaceReport> {
  return request(`/api/games/${gameId}/report`, { method: 'GET', token });
}

/** Permanently deletes a race and associated stored evidence. Requires host token. */
export function deleteRace(
  gameId: string,
  hostToken: string
): Promise<{ game_id: string; deleted: boolean; photos_deleted: number }> {
  return request(`/api/games/${gameId}`, { method: 'DELETE', token: hostToken });
}

/** Deletes team-submitted photo evidence. Requires team token. */
export function deleteMyEvidence(
  gameId: string,
  teamToken: string
): Promise<{ game_id: string; team_id: string; deleted: boolean; photos_deleted: number; error?: string }> {
  return request(`/api/games/${gameId}/evidence`, { method: 'DELETE', token: teamToken });
}
