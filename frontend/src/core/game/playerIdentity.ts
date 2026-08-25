/** Manages player display name prefill and persistence in localStorage across sessions. */

const PLAYER_NAME_KEY = 'runway:runner-name';

/** Maximum character length for a player display name. */
export const PLAYER_NAME_MAX = 40;

export function loadPlayerName(): string {
  try {
    return localStorage.getItem(PLAYER_NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(PLAYER_NAME_KEY, trimmed.slice(0, PLAYER_NAME_MAX));
  } catch {
    // Ignore storage errors.
  }
}
