/** Manages team session credentials and local player state in storage. */

import { getItem, setItem, removeItem } from '../util/storage';

export interface TeamSession {
  gameId: string;
  teamId: string;
  teamToken: string;
  teamName: string;
  slotIndex: number;
  homeWaypointId: string | null;
  /** Optional join code for teammate invitations. */
  joinCode?: string;
  /** Player ID assigned to this device session. */
  playerId?: string;
  /** Display name of the local player. */
  displayName?: string;
}

function storageKey(gameId: string): string {
  return `runway:session:${gameId}`;
}

export function loadTeamSession(gameId: string): TeamSession | null {
  const parsed = getItem<TeamSession>(storageKey(gameId));
  if (parsed && parsed.gameId === gameId && parsed.teamToken) return parsed;
  return null;
}

export function saveTeamSession(session: TeamSession): void {
  setItem(storageKey(session.gameId), session);
}

export function clearTeamSession(gameId: string): void {
  removeItem(storageKey(gameId));
}
