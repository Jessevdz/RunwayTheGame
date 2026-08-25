import { useEffect } from 'react';
import { projectionStore } from '../projection/projectionStore';
import { touchRace } from './raceSession';

/** Syncs live projection state changes (status and board name) to the local race index. */
export function useRaceIndexSync(gameId: string | undefined): void {
  useEffect(() => {
    if (!gameId) return;
    return projectionStore.subscribe((state) => {
      if (state.gameId !== gameId) return;
      touchRace(gameId, { status: state.state, boardName: state.boardName || undefined });
    });
  }, [gameId]);
}
