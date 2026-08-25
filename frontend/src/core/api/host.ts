// The referee's routes. Every call here carries the host token: grading a
// submission by hand, settling a dispute a team raised, and the three overrides
// that put a race back on the rails.
import type { VerificationMode } from '../projection/projectionStore';
import type { RubricDetail } from './board';
import { request } from './http';

export function resolveDispute(
  gameId: string,
  hostToken: string,
  verdictId: string,
  outcome: 'upheld' | 'overturned'
): Promise<{ status: string }> {
  return request(`/api/games/${gameId}/dispute/resolve`, {
    method: 'POST',
    token: hostToken,
    body: JSON.stringify({ verdict_id: verdictId, outcome })
  });
}

/** One submission waiting on host review. */
export interface PendingReviewItem {
  submission_id: string;
  team_id: string;
  team_name: string;
  kind: 'challenge' | 'roadblock';
  waypoint_id?: string;
  road_id?: string;
  challenge_id: string;
  prompt: string;
  rubric: RubricDetail;
  photo_url?: string;
  blob_ref: string;
  lat?: number;
  lon?: number;
  accuracy_m?: number;
  client_captured_at?: string;
  submitted_at: string;
}

/** Fetches pending evidence submissions for host review. */
export function listPendingReview(
  gameId: string,
  hostToken: string
): Promise<{ game_id: string; verification: VerificationMode; pending: PendingReviewItem[] }> {
  return request(`/api/games/${gameId}/review`, { method: 'GET', token: hostToken });
}

/** Submits a manual host verdict for a pending submission. */
export function submitHostVerdict(
  gameId: string,
  hostToken: string,
  payload: { submission_id: string; verdict: 'pass' | 'fail'; rationale: string }
): Promise<{ verdict: string; status: string; outcome?: string; conflict_message?: string }> {
  return request(`/api/games/${gameId}/verdict`, {
    method: 'POST',
    token: hostToken,
    body: JSON.stringify({ ...payload, confidence: 1 })
  });
}

export function overrideCoins(
  gameId: string,
  hostToken: string,
  teamId: string,
  delta: number,
  note: string
): Promise<{ new_balance: number; applied_delta: number }> {
  return request(`/api/games/${gameId}/override/coins`, {
    method: 'POST',
    token: hostToken,
    body: JSON.stringify({ team_id: teamId, delta, note })
  });
}

export function overrideClearChallenge(
  gameId: string,
  hostToken: string,
  teamId: string,
  waypointId: string,
  note: string,
  awardCoins = true
): Promise<{ status: string }> {
  return request(`/api/games/${gameId}/override/clear-challenge`, {
    method: 'POST',
    token: hostToken,
    body: JSON.stringify({ team_id: teamId, waypoint_id: waypointId, note, award_coins: awardCoins })
  });
}

export function overrideClearEffect(
  gameId: string,
  hostToken: string,
  teamId: string,
  effectType: 'freeze' | 'curse' | 'veto_penalty' | 'tracker_off',
  note: string
): Promise<{ status: string }> {
  return request(`/api/games/${gameId}/override/clear-effect`, {
    method: 'POST',
    token: hostToken,
    body: JSON.stringify({ team_id: teamId, effect_type: effectType, note })
  });
}
