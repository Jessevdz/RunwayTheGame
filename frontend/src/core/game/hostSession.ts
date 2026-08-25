/** Manages host session token persistence in local storage for game administration. */

import { getItem, setItem, removeItem } from '../util/storage';

export interface HostSession {
  gameId: string;
  hostToken: string;
}

function storageKey(gameId: string): string {
  return `runway:host:${gameId}`;
}

export function loadHostSession(gameId: string): HostSession | null {
  const parsed = getItem<HostSession>(storageKey(gameId));
  if (parsed && parsed.gameId === gameId && parsed.hostToken) return parsed;
  return null;
}

export function saveHostSession(session: HostSession): void {
  setItem(storageKey(session.gameId), session);
}

export function clearHostSession(gameId: string): void {
  removeItem(storageKey(gameId));
}
