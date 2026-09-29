import { createGame } from '../../core/api/client';
import type { BoardSummary } from '../../core/api/client';
import { analytics } from '../../core/analytics/analyticsClient';
import { saveHostSession } from '../../core/game/hostSession';
import { rememberRace } from '../../core/game/raceSession';

const GAME_DURATION_MS = 6 * 60 * 60 * 1000;

/** Hosts a team race on a published gallery board with the honour-system default and returns the new game id. */
export async function hostBoardRace(board: BoardSummary): Promise<string> {
  const now = new Date();
  const game = await createGame({
    board_id: board.id,
    board_version: 1,
    starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + GAME_DURATION_MS).toISOString(),
    mode: 'team',
    ruleset: { verification: 'trust' },
  });
  // The host token is returned once, so it is saved before anything else can fail.
  saveHostSession({ gameId: game.id, hostToken: game.host_token });
  rememberRace({
    gameId: game.id,
    raceCode: game.race_code,
    boardName: board.name,
    status: 'draft',
    mode: 'team',
  });
  analytics.track('board.race_launched', { mode: 'team' });
  return game.id;
}
