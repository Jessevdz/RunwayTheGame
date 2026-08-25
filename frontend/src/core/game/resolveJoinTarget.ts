/** Resolves parsed JoinTarget objects into saved capabilities and navigation targets. */

import { saveTeamSession, loadTeamSession } from './teamSession';
import { rememberRace, lobbyPath } from './raceSession';
import { getGameByCode, API_BASE_URL, ApiError, isTrustedApiBaseUrl } from '../api/client';
import type { JoinTarget } from './joinTarget';

export interface ResolvedJoin {
  gameId: string;
  boardName?: string;
  raceCode?: string;
  status?: 'draft' | 'live' | 'ended';
  teamCount?: number;
  /** Set when the invite specifies an alternate backend target URL. */
  hardNavigateTo?: string;
}

export class JoinError extends Error {}

/** Persists capabilities from the target and resolves navigation details. */
export async function resolveJoinTarget(target: JoinTarget): Promise<ResolvedJoin> {
  if (target.kind === 'code') {
    let lookup;
    try {
      lookup = await getGameByCode(target.code);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          throw new JoinError(
            'No race with that code. If a teammate sent you a team code, it only works once you are in the lobby — ask the host for the race code or the invite link.'
          );
        }
        if (err.status === 410) throw new JoinError('That race has already finished.');
        if (err.status === 429) throw new JoinError('Too many tries — wait a moment and try again.');
      }
      throw new JoinError('Could not reach the race server. Check your signal and try again.');
    }

    rememberRace({
      gameId: lookup.game_id,
      raceCode: lookup.race_code,
      boardName: lookup.board_name,
      status: lookup.status,
    });

    return {
      gameId: lookup.game_id,
      boardName: lookup.board_name,
      raceCode: lookup.race_code,
      status: lookup.status,
      teamCount: lookup.team_count,
    };
  }

  if (target.kind === 'gameId') {
    rememberRace({ gameId: target.gameId });
    return { gameId: target.gameId };
  }

  // Handle full invite links and persist credentials.
  if (target.teamToken && target.teamId && !loadTeamSession(target.gameId)) {
    saveTeamSession({
      gameId: target.gameId,
      teamId: target.teamId,
      teamToken: target.teamToken,
      teamName: target.teamName || 'Teammate',
      slotIndex: target.slotIndex ?? 0,
      homeWaypointId: null,
    });
  }
  rememberRace({ gameId: target.gameId });

  const resolved: ResolvedJoin = { gameId: target.gameId };

  // Trigger full reload only when the custom API endpoint is a trusted backend;
  // an arbitrary ?api= origin must never receive capability traffic.
  if (target.apiBase && isTrustedApiBaseUrl(target.apiBase) && target.apiBase.replace(/\/+$/, '') !== API_BASE_URL) {
    const url = new URL(lobbyPath(target.gameId), window.location.origin);
    url.searchParams.set('api', target.apiBase);
    resolved.hardNavigateTo = url.toString();
  }

  return resolved;
}
