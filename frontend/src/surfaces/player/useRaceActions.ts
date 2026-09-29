import { useEffect, useRef, useState } from 'react';
import { startChallenge, vetoChallenge, arriveWaypoint } from '../../core/api/client';
import { type GameState } from '../../core/projection/projectionStore';
import { type GPSPosition } from '../../core/player/locationService';
import { type TeamSession } from '../../core/game/teamSession';
import { NO_FIX_MESSAGE, playerErrorMessage, type PlayerAction } from './playerErrors';

/** Race action handlers and error state interface. */
export interface RaceActions {
  /** The last failure as a plain sentence, or null when clean. */
  error: string | null;
  /** True while a command is on its way, so a second tap cannot send it twice. */
  busy: boolean;
  startChallenge: (waypointId: string, roadId?: string) => Promise<void>;
  veto: (waypointId: string, roadId?: string) => Promise<void>;
  arrive: (waypointId: string) => Promise<void>;
  endRun: () => Promise<void>;
}

interface RaceActionsInput {
  gameState: GameState;
  session: TeamSession;
  playerLocation: GPSPosition | null;
  onStartChallenge: (waypointId: string, prompt: string, rubric: any, challengeId?: string, roadId?: string) => void;
  /** Solo mode callback for finishing a run. */
  onEndRun?: () => Promise<void>;
  /** Waypoint ID to trigger error banner reset when changed. */
  resetOn: string | undefined;
}

/** Raised instead of sending a command that needs a position when the phone has none. */
class NoFixError extends Error {}

export const useRaceActions = ({
  gameState,
  session,
  playerLocation,
  onStartChallenge,
  onEndRun,
  resetOn
}: RaceActionsInput): RaceActions => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    setError(null);
  }, [resetOn]);

  const run = async (action: PlayerAction, fn: () => Promise<unknown>) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof NoFixError ? NO_FIX_MESSAGE : playerErrorMessage(err, action));
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  /** Every command carries where the phone is; with no fix it refuses rather than claim to be at 0, 0. */
  const here = () => {
    if (!playerLocation) throw new NoFixError();
    return {
      team_token: session.teamToken,
      lat: playerLocation.lat,
      lon: playerLocation.lon,
      accuracy_m: playerLocation.accuracy || 10
    };
  };

  return {
    error,
    busy,

    startChallenge: (waypointId, roadId) =>
      run('start', async () => {
        const result = await startChallenge(gameState.gameId!, {
          waypoint_id: waypointId,
          ...(roadId ? { road_id: roadId } : {}),
          ...here(),
          idempotency_key: `challenge-${roadId || waypointId}-${Date.now()}`
        });
        onStartChallenge(waypointId, result.prompt, result.rubric, result.challenge_id, roadId);
      }),

    veto: (waypointId, roadId) =>
      run('veto', () =>
        vetoChallenge(gameState.gameId!, {
          waypoint_id: waypointId,
          ...(roadId ? { road_id: roadId } : {}),
          team_token: session.teamToken,
          idempotency_key: `veto-${roadId || waypointId}-${Date.now()}`
        })
      ),

    arrive: (waypointId) =>
      run('arrive', () =>
        arriveWaypoint(gameState.gameId!, {
          waypoint_id: waypointId,
          ...here(),
          idempotency_key: `arrive-${waypointId}-${Date.now()}`
        })
      ),

    endRun: async () => {
      if (!onEndRun) return;
      await run('end', onEndRun);
    }
  };
};
