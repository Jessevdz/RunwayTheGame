import { useCallback, useState } from 'react';
import { updateMembership, updateTeam, disbandTeam } from '../api/client';
import { saveTeamSession, type TeamSession } from './teamSession';
import { savePlayerName } from './playerIdentity';

/** Custom hook to manage pre-race lobby membership edits, squad switching, and team updates. */
export function useLobbyMembership(session: TeamSession | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const persist = useCallback((next: TeamSession) => {
    saveTeamSession(next);
    if (next.displayName) savePlayerName(next.displayName);
    return next;
  }, []);

  const run = useCallback(
    async <T,>(work: () => Promise<T>, fallback: string): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await work();
      } catch (err: any) {
        if (err?.status === 403) {
          setError('The race has started, so this can no longer be changed.');
        } else if (err?.status === 409) {
          setError(fallback);
        } else if (err?.status === 404) {
          setError('That squad is no longer in this race.');
        } else {
          setError(err?.message || 'That did not go through — check your signal and try again.');
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    []
  );

  /** Updates the display name for the local player. */
  const renameMe = useCallback(
    async (displayName: string): Promise<TeamSession | null> => {
      if (!session || !displayName.trim()) return null;
      return run(async () => {
        const res = await updateMembership(session.gameId, session.teamToken, {
          display_name: displayName.trim()
        });
        return persist({ ...session, playerId: res.player_id, displayName: res.display_name });
      }, 'That name could not be set.');
    },
    [session, run, persist]
  );

  /** Moves the local player to another squad in the lobby. */
  const switchTeam = useCallback(
    async (teamId: string): Promise<TeamSession | null> => {
      if (!session || teamId === session.teamId) return null;
      return run(async () => {
        const res = await updateMembership(session.gameId, session.teamToken, { team_id: teamId });
        return persist({
          ...session,
          teamId: res.team_id,
          teamName: res.team_name,
          slotIndex: res.slot_index,
          playerId: res.player_id,
          displayName: res.display_name,
          joinCode: undefined
        });
      }, 'That squad could not be joined.');
    },
    [session, run, persist]
  );

  /** Updates name or slot index for the current squad. */
  const editSquad = useCallback(
    async (changes: { name?: string; slotIndex?: number }): Promise<TeamSession | null> => {
      if (!session) return null;
      return run(async () => {
        const res = await updateTeam(session.gameId, session.teamId, session.teamToken, {
          name: changes.name?.trim(),
          slot_index: changes.slotIndex
        });
        return persist({ ...session, teamName: res.team_name, slotIndex: res.slot_index });
      }, 'Another squad just took that colour. Pick a different one.');
    },
    [session, run, persist]
  );

  /** Disbands an empty squad. */
  const removeSquad = useCallback(
    async (gameId: string, teamId: string, token: string): Promise<boolean> => {
      const done = await run(async () => {
        await disbandTeam(gameId, teamId, token);
        return true;
      }, 'Someone is still on that squad.');
      return done === true;
    },
    [run]
  );

  return { renameMe, switchTeam, editSquad, removeSquad, busy, error, setError, clearError };
}
