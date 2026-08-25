import { useCallback, useRef, useState } from 'react';
import { joinGame, joinExistingTeam } from '../api/client';
import { saveTeamSession, type TeamSession } from './teamSession';
import { savePlayerName } from './playerIdentity';
import { rememberRace } from './raceSession';

/** Custom hook that manages team creation, joining, idempotency keys, and error states. */
export function useJoinTeam(gameId: string | undefined, boardName?: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable attempt key to ensure join idempotency across retries.
  const attemptKey = useRef<string | null>(null);
  const currentAttemptKey = useCallback(() => {
    if (!attemptKey.current) {
      attemptKey.current = `join-${gameId}-${crypto.randomUUID()}`;
    }
    return attemptKey.current;
  }, [gameId]);

  const clearError = useCallback(() => setError(null), []);

  const remember = useCallback(
    (session: TeamSession) => {
      saveTeamSession(session);
      rememberRace({ gameId: session.gameId, boardName });
      if (session.displayName) savePlayerName(session.displayName);
      attemptKey.current = null;
    },
    [boardName]
  );

  const joinNewTeam = useCallback(
    async (teamName: string, slotIndex: number, displayName?: string): Promise<TeamSession | null> => {
      if (!gameId) {
        setError('This link is missing its race id. Ask the host to resend the invite.');
        return null;
      }
      if (!teamName.trim()) return null;

      setBusy(true);
      setError(null);
      try {
        const res = await joinGame(gameId, teamName.trim(), slotIndex, displayName?.trim(), currentAttemptKey());
        const session: TeamSession = {
          gameId,
          teamId: res.team_id,
          teamToken: res.join_token,
          teamName: teamName.trim(),
          slotIndex: res.slot_index,
          homeWaypointId: null,
          joinCode: res.join_code,
          playerId: res.player_id,
          displayName: res.display_name,
        };
        remember(session);
        return session;
      } catch (err: any) {
        if (err?.status === 409) {
          setError('Another team just took that colour. Pick a different one.');
        } else if (err?.status === 404) {
          setError('That race no longer exists. Ask the host for a fresh invite link.');
        } else if (err?.status === 403) {
          setError('This race has already finished, so it can no longer be joined.');
        } else {
          setError(err?.message || 'Failed to join — check your signal and try again');
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [gameId, remember, currentAttemptKey]
  );

  /** Joins an existing team roster slot. */
  const claimExistingTeam = useCallback(
    async (teamId: string, displayName?: string, joinCode?: string): Promise<TeamSession | null> => {
      if (!gameId) return null;

      setBusy(true);
      setError(null);
      try {
        const res = await joinExistingTeam(gameId, teamId, displayName?.trim(), joinCode?.trim() || undefined);
        const session: TeamSession = {
          gameId,
          teamId: res.team_id,
          teamToken: res.join_token,
          teamName: res.team_name,
          slotIndex: res.slot_index,
          homeWaypointId: null,
          joinCode: res.join_code,
          playerId: res.player_id,
          displayName: res.display_name,
        };
        remember(session);
        return session;
      } catch (err: any) {
        if (err?.status === 403) {
          setError('That invite link is out of date. Join the squad from the list instead.');
        } else if (err?.status === 404) {
          setError('That squad is no longer in this race.');
        } else {
          setError(err?.message || 'Failed to join squad — check your signal and try again');
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [gameId, remember]
  );

  return { joinNewTeam, claimExistingTeam, busy, error, setError, clearError };
}
