/** Manages local race index records and storage key management. */

import { getItem, setItem } from '../util/storage';
import { loadHostSession, clearHostSession } from './hostSession';
import { loadTeamSession, clearTeamSession } from './teamSession';
import { purgeQueueForGame } from '../projection/offlineStore';

/** Role held by this device in a game session. */
export type RaceRole = 'host' | 'player' | 'both' | 'none';
export type RaceStatus = 'draft' | 'live' | 'ended';
/** Supported game modes for race records. */
export type RaceMode = 'team' | 'solo_time_trial' | 'solo_casual' | 'coin_rush';

/** Returns true if the race mode is a solo run. */
export const isSoloRaceMode = (mode?: RaceMode): boolean =>
  mode === 'solo_time_trial' || mode === 'solo_casual';

export interface RaceRecord {
  gameId: string;
  raceCode?: string;
  boardName: string;
  role: RaceRole;
  status: RaceStatus;
  mode?: RaceMode;
  gmOnly?: boolean;
  joinedAt: string;
  lastSeenAt: string;
}

const RACES_STORAGE_KEY = 'runway:races';

const MAX_RACES = 50;

function readRaw(): RaceRecord[] {
  const parsed = getItem<RaceRecord[]>(RACES_STORAGE_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

function writeRaw(records: RaceRecord[]): void {
  setItem(RACES_STORAGE_KEY, records.slice(0, MAX_RACES));
}

/** Resolves active race role based on stored host and team tokens. */
export function resolveRole(gameId: string): RaceRole {
  const host = !!loadHostSession(gameId);
  const team = !!loadTeamSession(gameId);
  if (host && team) return 'both';
  if (host) return 'host';
  if (team) return 'player';
  return 'none';
}

export function listMyRaces(): RaceRecord[] {
  return readRaw().map((record) => ({ ...record, role: resolveRole(record.gameId) }));
}

export function getRace(gameId: string): RaceRecord | null {
  const match = readRaw().find((r) => r.gameId === gameId);
  return match ? { ...match, role: resolveRole(gameId) } : null;
}

export function getRaceMode(gameId: string): RaceMode {
  return getRace(gameId)?.mode ?? 'team';
}

/** Upserts a race record in local storage. */
export function rememberRace(entry: Partial<RaceRecord> & { gameId: string }): void {
  const current = readRaw();
  const index = current.findIndex((r) => r.gameId === entry.gameId);
  const now = new Date().toISOString();
  const existing = index >= 0 ? current[index] : null;

  const merged: RaceRecord = {
    gameId: entry.gameId,
    raceCode: entry.raceCode ?? existing?.raceCode,
    boardName: entry.boardName || existing?.boardName || 'Untitled race',
    role: resolveRole(entry.gameId),
    status: entry.status ?? existing?.status ?? 'draft',
    mode: entry.mode ?? existing?.mode,
    gmOnly: entry.gmOnly ?? existing?.gmOnly,
    joinedAt: existing?.joinedAt ?? now,
    lastSeenAt: now,
  };

  if (index >= 0) {
    current.splice(index, 1);
  }
  current.unshift(merged);
  writeRaw(current);
}

/** Refreshes cached status and board name for a race. */
export function touchRace(gameId: string, next: { status?: RaceStatus; boardName?: string }): boolean {
  const current = readRaw();
  const index = current.findIndex((r) => r.gameId === gameId);
  if (index < 0) return false;

  const record = current[index];
  const statusChanged = !!next.status && next.status !== record.status;
  const nameChanged = !!next.boardName && next.boardName !== record.boardName;
  if (!statusChanged && !nameChanged) return false;

  current[index] = {
    ...record,
    status: next.status ?? record.status,
    boardName: next.boardName || record.boardName,
    lastSeenAt: new Date().toISOString(),
  };
  writeRaw(current);
  if (statusChanged && next.status === 'ended') {
    void purgeQueueForGame(gameId).catch(() => {});
  }
  return true;
}

/** Removes a race and its associated local host and team sessions. */
export async function forgetRace(gameId: string): Promise<void> {
  writeRaw(readRaw().filter((r) => r.gameId !== gameId));
  clearHostSession(gameId);
  clearTeamSession(gameId);
  await purgeQueueForGame(gameId).catch(() => {});
}

/** Refreshes the lifecycle status for all unfinished races. */
export async function refreshRaceStatuses(
  fetchGame: (gameId: string) => Promise<{ status: RaceStatus; board_name?: string; race_code?: string }>
): Promise<boolean> {
  const pending = readRaw().filter((r) => r.status !== 'ended');
  if (pending.length === 0) return false;

  const results = await Promise.allSettled(pending.map((r) => fetchGame(r.gameId)));
  let changed = false;
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const race = pending[i];
    if (touchRace(race.gameId, { status: result.value.status, boardName: result.value.board_name })) {
      changed = true;
    }
    if (result.value.race_code && !race.raceCode) {
      rememberRace({ gameId: race.gameId, raceCode: result.value.race_code });
      changed = true;
    }
  });
  return changed;
}

/** Returns the join lobby path for a game ID. */
export function lobbyPath(gameId: string): string {
  return `/join/${gameId}`;
}

/** Returns the appropriate lobby path based on device host capability. */
export function lobbyPathForDevice(gameId: string): string {
  return loadHostSession(gameId) ? `/host/${gameId}` : lobbyPath(gameId);
}

/** Resolves target route path for a game given its status and local device capabilities. */
export function racePathFor(gameId: string, status: RaceStatus): string {
  if (status === 'ended') return `/race/${gameId}/report`;
  if (isSoloRaceMode(getRaceMode(gameId))) return `/race/${gameId}?view=play`;
  if (status === 'draft') return lobbyPathForDevice(gameId);
  const role = resolveRole(gameId);
  if (role === 'none') return lobbyPath(gameId);
  const view = role === 'host' ? 'host' : 'play';
  return `/race/${gameId}?view=${view}`;
}

/** Resolves the authorization token (host or team) for the realtime WebSocket connection. */
export function resolveFeedToken(gameId: string): string {
  if (!gameId) return '';
  const host = loadHostSession(gameId);
  if (host?.hostToken) return host.hostToken;
  const team = loadTeamSession(gameId);
  if (team?.teamToken) return team.teamToken;
  return '';
}
