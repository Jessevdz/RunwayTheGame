/** Combines public gallery boards with local draft maps for map picker selections. */

import { listBoards, listBoardsByIds, type BoardSummary } from '../api/client';
import { listMyMaps } from './mapSession';

export interface CatalogBoard extends BoardSummary {
  /** Indicates whether this device holds the edit token for the map. */
  mine: boolean;
}

export async function listRaceableBoards(): Promise<CatalogBoard[]> {
  const myIds = listMyMaps().map((m) => m.mapId);
  const mine = new Set(myIds);

  // Fall back to empty array if fetching private maps fails.
  const [publicBoards, ownBoards] = await Promise.all([
    listBoards(),
    listBoardsByIds(myIds).catch(() => [] as BoardSummary[])
  ]);

  const byId = new Map<string, BoardSummary>();
  for (const board of publicBoards) byId.set(board.id, board);
  // Merge user-owned boards last to ensure freshest metadata.
  for (const board of ownBoards) byId.set(board.id, board);

  return [...byId.values()]
    .map((board) => ({ ...board, mine: mine.has(board.id) }))
    .sort((a, b) => {
      // Prioritize user-owned maps.
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
}
