/** Game creation, lobby management, team joining, and race control API routes. */
import type { GameMode, VerificationMode } from '../projection/projectionStore';
import { request } from './http';

/** Hosted lobby game modes. */
export type HostedMode = 'team' | 'coin_rush';

export type SoloMode = 'solo_time_trial' | 'solo_casual';

/** Grading modes available for solo runs. */
export type SoloVerificationMode = Exclude<VerificationMode, 'host'>;

/** Creates a hosted game session and returns initial tokens. */
export function createGame(payload: {
  board_id: string;
  board_version: number;
  starts_at: string;
  ends_at: string;
  mode?: HostedMode;
  ruleset?: { verification?: VerificationMode };
}): Promise<{ id: string; status: string; race_code: string; host_token: string }> {
  return request(`/api/games/`, { method: 'POST', body: JSON.stringify(payload) });
}

export interface SoloRunCreated {
  game_id: string;
  team_id: string;
  team_name: string;
  /** Returned once, like a host token — the runner owns their own run. */
  host_token: string;
  join_token: string;
  join_code: string;
  mode: SoloMode;
  race_code: string;
  /** The GameStarted event's own timestamp. The clock has already begun. */
  started_at: string;
  board_id: string;
  board_version: number;
}

/** Creates and starts an active solo run session. */
export function createSoloRun(payload: {
  board_id: string;
  board_version: number;
  mode: SoloMode;
  runner_name: string;
  ruleset?: { verification?: SoloVerificationMode };
  idempotency_key?: string;
}): Promise<SoloRunCreated> {
  return request(`/api/games/solo`, { method: 'POST', body: JSON.stringify(payload) });
}

/** A person in a lobby. A first name and an id to tell two of them apart. */
export interface LobbyPlayer {
  player_id: string;
  display_name: string;
}

export interface LobbyTeam {
  team_id: string;
  team_name: string;
  slot_index: number;
  /** Roster of players on this team. */
  players: LobbyPlayer[];
}

export interface GameSummary {
  game_id: string;
  board_id: string;
  board_name: string;
  status: 'draft' | 'live' | 'ended';
  /** How it is played. The lobby's only way to learn this — it holds no capability, so it cannot open the feed. */
  mode: GameMode;
  race_code: string;
  starts_at: string;
  ends_at: string;
  /**
   * Names, colours and who is on each — join codes stay on the host-only /teams
   * route, and no position is ever in this payload.
   */
  teams: LobbyTeam[];
}

/** Fetches game summary including lobby status and team roster. */
export function getGame(gameId: string, token?: string): Promise<GameSummary> {
  return request(`/api/games/${gameId}`, { method: 'GET', token });
}

export interface RaceCodeLookup {
  game_id: string;
  race_code: string;
  status: 'draft' | 'live';
  /** A solo run resolves to a 404, so this is only ever a joinable mode. */
  mode: GameMode;
  board_name: string;
  team_count: number;
}

/** Resolves a short race code to target game details. */
export function getGameByCode(code: string): Promise<RaceCodeLookup> {
  return request(`/api/games/by-code/${encodeURIComponent(code)}`, { method: 'GET' });
}

export function startGame(gameId: string, hostToken: string): Promise<{ status: string }> {
  return request(`/api/games/${gameId}/start`, { method: 'POST', token: hostToken });
}

export function endGame(gameId: string, hostToken: string): Promise<{ status: string }> {
  return request(`/api/games/${gameId}/end`, { method: 'POST', token: hostToken });
}

export interface HostTeamSummary {
  team_id: string;
  team_name: string;
  slot_index: number;
  join_code: string;
}

export function listTeams(gameId: string, hostToken: string): Promise<{ teams: HostTeamSummary[] }> {
  return request(`/api/games/${gameId}/teams`, { method: 'GET', token: hostToken });
}

export interface JoinResult {
  team_id: string;
  join_token: string;
  join_code: string;
  slot_index: number;
  player_id: string;
  display_name: string;
  home_waypoint?: string | null;
}

/** Creates a new team and registers the local player. */
export function joinGame(
  gameId: string,
  teamName: string,
  slotIndex: number,
  displayName?: string,
  idempotencyKey?: string
): Promise<JoinResult> {
  return request(`/api/games/${gameId}/join`, {
    method: 'POST',
    body: JSON.stringify({
      team_name: teamName,
      slot_index: slotIndex,
      display_name: displayName,
      idempotency_key: idempotencyKey
    })
  });
}

/** Joins an existing team as a player. */
export function joinExistingTeam(
  gameId: string,
  teamId: string,
  displayName?: string,
  joinCode?: string
): Promise<JoinResult & { team_name: string }> {
  return request(`/api/games/${gameId}/teams/${teamId}/join`, {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName, join_code: joinCode })
  });
}

/** This device's own place in the race, as the server sees it after a change. */
export interface Membership {
  player_id: string;
  display_name: string;
  team_id: string;
  team_name: string;
  slot_index: number;
}

/** Updates display name or team assignment for the local player. */
export function updateMembership(
  gameId: string,
  teamToken: string,
  changes: { display_name?: string; team_id?: string }
): Promise<Membership> {
  return request(`/api/games/${gameId}/me`, {
    method: 'PATCH',
    token: teamToken,
    body: JSON.stringify(changes)
  });
}

/** Renames or recolours a squad prior to race start. */
export function updateTeam(
  gameId: string,
  teamId: string,
  token: string,
  changes: { name?: string; slot_index?: number }
): Promise<{ team_id: string; team_name: string; slot_index: number }> {
  return request(`/api/games/${gameId}/teams/${teamId}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(changes)
  });
}

// Removes a squad nobody is on. Pre-race only (403); 409 while anyone is still
// on it — leaving is done by switching squads, which disbands what it empties.
export function disbandTeam(gameId: string, teamId: string, token: string): Promise<void> {
  return request(`/api/games/${gameId}/teams/${teamId}`, { method: 'DELETE', token });
}
