// What a team does while the race is live. Every call here carries a team
// token, and the ones that submit evidence carry the fix the photo was taken
// at — the server grades the evidence against where it came from.
import type { RubricDetail } from './board';
import { request } from './http';

export interface ChallengeDrawResult {
  challenge_id: string;
  prompt: string;
  rubric: RubricDetail;
  nonce: string;
}

/** Submission processing status ('pass', 'pending_review', or 'pending'). */
export type SubmissionStatus = 'pass' | 'pending_review' | 'pending';

export function startChallenge(
  gameId: string,
  payload: {
    waypoint_id?: string;
    road_id?: string;
    team_token: string;
    lat: number;
    lon: number;
    accuracy_m: number;
    client_started_at?: string;
    idempotency_key: string;
  }
): Promise<ChallengeDrawResult> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/challenge/start`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

/** Requests a presigned URL for uploading evidence blobs. */
export function presignUpload(
  gameId: string,
  payload: { team_token: string; content_type: string }
): Promise<{ upload_url: string; blob_ref: string }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/presign`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

export function submitChallengeEvidence(
  gameId: string,
  payload: {
    team_token: string;
    waypoint_id?: string;
    road_id?: string;
    challenge_id: string;
    blob_ref: string;
    // The fix taken with the photo. The server checks it against the waypoint
    // and forwards it to the grader, so a submission without one is refused.
    lat: number;
    lon: number;
    accuracy_m: number;
    idempotency_key: string;
    client_captured_at?: string;
  }
): Promise<{ submission_id: string; status: SubmissionStatus }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/submission`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

export function vetoChallenge(
  gameId: string,
  payload: {
    waypoint_id?: string;
    road_id?: string;
    team_token: string;
    idempotency_key: string;
  }
): Promise<{ status: string }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/veto`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

export function arriveWaypoint(
  gameId: string,
  payload: {
    waypoint_id: string;
    team_token: string;
    lat: number;
    lon: number;
    accuracy_m: number;
    idempotency_key: string;
  }
): Promise<{ status: string }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/arrive`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

export function buyPowerup(
  gameId: string,
  payload: {
    powerup: string;
    team_token: string;
    idempotency_key: string;
  }
): Promise<{ status: string }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/shop/buy`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

export function activatePowerup(
  gameId: string,
  payload: {
    powerup: string;
    team_token: string;
    target_team_id?: string;
    road_id?: string;
    idempotency_key: string;
  }
): Promise<{ status: string }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/powerup/use`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

/** Submits photo evidence that the team has cleared a roadblock on a road. */
export function clearRoadblock(
  gameId: string,
  payload: {
    road_id: string;
    team_token: string;
    blob_ref: string;
    // Same rule as a waypoint capture: the server grades the evidence against
    // where it was taken, so the fix travels with it.
    lat: number;
    lon: number;
    accuracy_m: number;
    idempotency_key: string;
    client_captured_at?: string;
  }
): Promise<{ submission_id: string; road_id: string; status: SubmissionStatus }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/roadblock/clear`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

export function resolveCurse(
  gameId: string,
  payload: {
    card_id: string;
    team_token: string;
    idempotency_key: string;
  }
): Promise<{ status: string }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/curse/resolve`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

export function reportPosition(
  gameId: string,
  payload: {
    team_token: string;
    lat: number;
    lon: number;
    accuracy_m: number;
  }
): Promise<void> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/position`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}

/** Submits a team's objection to a verdict for host resolution. */
export function raiseDispute(
  gameId: string,
  payload: { team_token: string; verdict_id: string; objection: string }
): Promise<{ status: string }> {
  const { team_token, ...body } = payload;
  return request(`/api/games/${gameId}/dispute`, { method: 'POST', token: team_token, body: JSON.stringify(body) });
}
