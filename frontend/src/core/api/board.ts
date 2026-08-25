/** Board schema definitions and API endpoints. */
import { adminAuth } from './admin';
import { request } from './http';

export interface ApiWaypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  arrival_radius_m: number;
  is_start: boolean;
  is_finish: boolean;
  challenge_id?: string;
}

export interface ApiRoad {
  id: string;
  waypoint_id_a?: string;
  waypoint_id_b?: string;
  waypoint_a?: string;
  waypoint_b?: string;
  challenge_id?: string;
  length_m: number;
}

export interface RubricDetail {
  must_show: string[];
  fails_if: string[];
  acceptable_ambiguity: string;
}

export interface ApiChallenge {
  id: string;
  waypoint_id?: string;
  road_id?: string;
  prompt: string;
  rubric: RubricDetail;
  coin_reward: number;
  veto_penalty_seconds: number;
}

export interface ApiPowerup {
  id: string;
  icon?: string;
  name: string;
  description: string;
  cost: number;
  duration_s: number;
  effect: string;
}

export interface ApiBoard {
  id: string;
  version: number;
  name: string;
  waypoints: ApiWaypoint[];
  roads: ApiRoad[];
  challenges?: ApiChallenge[];
  roadblock_deck: { id: string; text: string }[];
  curse_deck: { id: string; text: string }[];
  powerup_costs: { [powerup: string]: number };
  powerups?: ApiPowerup[];
}

export interface BoardPreviewPoint {
  lat: number;
  lon: number;
  is_start: boolean;
  is_finish: boolean;
}

/** Route geometry for a card thumbnail. `roads` indexes into `waypoints`. */
export interface BoardPreview {
  waypoints: BoardPreviewPoint[];
  roads: [number, number][];
}

export interface BoardSummary {
  id: string;
  name: string;
  updated_at: string;
  waypoint_count: number;
  is_listed?: boolean;
  preview?: BoardPreview;
}

export function createBoard(name: string): Promise<{ id: string; version: number; status: string; edit_token: string; name: string }> {
  return request(`/api/boards/`, { method: 'POST', body: JSON.stringify({ name }) });
}

export function updateBoard(
  boardId: string,
  payload: {
    name?: string;
    waypoints?: ApiWaypoint[];
    roads?: ApiRoad[];
    challenges?: ApiChallenge[];
    roadblock_cards?: { id: string; text: string }[];
    curse_cards?: { id: string; text: string }[];
    powerup_costs?: { [powerup: string]: number };
    powerups?: ApiPowerup[];
    edit_token?: string;
  }
): Promise<{ status: string }> {
  const { edit_token, ...body } = payload;
  return request(`/api/boards/${boardId}/`, { method: 'PUT', token: edit_token, body: JSON.stringify(body) });
}

export function getBoard(boardId: string, version?: number): Promise<{ board: ApiBoard; recommended_team_count?: number; is_listed?: boolean }> {
  const path = version ? `/api/boards/${boardId}/versions/${version}` : `/api/boards/${boardId}/`;
  return request(path);
}

export function listBoards(): Promise<BoardSummary[]> {
  return request('/api/boards/');
}

/** Fetches board summaries for a list of board IDs. */
export function listBoardsByIds(ids: string[]): Promise<BoardSummary[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return request(`/api/boards/?ids=${encodeURIComponent(ids.join(','))}`);
}

/** Every map in the gallery, unlisted ones included. Admin session only. */
export function listBoardsAdmin(): Promise<BoardSummary[]> {
  return request('/api/boards/?all=true', adminAuth());
}

/**
 * Updates public gallery visibility for a board, as the map's editor or as an
 * admin. An editor proves it with the board's edit token; an admin with the
 * session this browser holds.
 */
export function setBoardVisibility(
  boardId: string,
  isListed: boolean,
  auth: { asAdmin?: boolean; editToken?: string }
): Promise<{ id: string; is_listed: boolean }> {
  return request<{ id: string; is_listed: boolean }>(`/api/boards/${boardId}/visibility`, {
    method: 'PUT',
    ...(auth.asAdmin ? adminAuth() : {}),
    token: auth.editToken,
    body: JSON.stringify({ is_listed: isListed })
  });
}

export function deleteBoardAdmin(boardId: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/boards/${boardId}`, {
    method: 'DELETE',
    ...adminAuth()
  });
}

export function forkBoard(boardId: string): Promise<{ id: string; edit_token: string; name: string }> {
  return request(`/api/boards/${boardId}/fork`, { method: 'POST' });
}

export function validateBoard(boardId: string): Promise<{ errors: string[]; warnings: string[] }> {
  return request(`/api/boards/${boardId}/validate`, { method: 'POST' });
}

/** Publishes a board using its edit token. */
export function publishBoard(
  boardId: string,
  editToken: string | null
): Promise<{ status: string; board: ApiBoard }> {
  return request(`/api/boards/${boardId}/publish`, { method: 'POST', token: editToken ?? undefined });
}

export function addChallenge(
  boardId: string,
  waypointId: string,
  payload: { prompt: string; rubric: RubricDetail; coin_reward: number; veto_penalty_seconds: number }
): Promise<{ id: string; challenge_id: string }> {
  return request(`/api/boards/${boardId}/waypoints/${waypointId}/challenges`, { method: 'POST', body: JSON.stringify(payload) });
}

/** Sets the roadblock deck cards for a board. */
export function setRoadblockDeck(
  boardId: string,
  cards: { id: string; text: string }[],
  editToken: string
): Promise<{ status: string }> {
  return request(`/api/boards/${boardId}/decks/roadblock`, {
    method: 'POST',
    token: editToken,
    body: JSON.stringify({ cards })
  });
}

export function setCurseDeck(
  boardId: string,
  cards: { id: string; text: string }[],
  editToken: string
): Promise<{ status: string }> {
  return request(`/api/boards/${boardId}/decks/curse`, {
    method: 'POST',
    token: editToken,
    body: JSON.stringify({ cards })
  });
}
