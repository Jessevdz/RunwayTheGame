import { useEffect, useState } from 'react';
import { startChallenge, vetoChallenge, arriveWaypoint } from '../../core/api/client';
import { type GameState } from '../../core/projection/projectionStore';
import { type GPSPosition } from '../../core/player/locationService';
import { type TeamSession } from '../../core/game/teamSession';

/** Race action handlers and error state interface. */
export interface RaceActions {
  /** The last failure message, or null when clean. */
  error: string | null;
  startChallenge: (waypointId: string) => Promise<void>;
  veto: (waypointId: string) => Promise<void>;
  arrive: (waypointId: string) => Promise<void>;
  endRun: () => Promise<void>;
}

interface RaceActionsInput {
  gameState: GameState;
  session: TeamSession;
  playerLocation: GPSPosition | null;
  onStartChallenge: (waypointId: string, prompt: string, rubric: any, challengeId?: string) => void;
  /** Solo mode callback for finishing a run. */
  onEndRun?: () => Promise<void>;
  /** Waypoint ID to trigger error banner reset when changed. */
  resetOn: string | undefined;
}

export const useRaceActions = ({
  gameState,
  session,
  playerLocation,
  onStartChallenge,
  onEndRun,
  resetOn
}: RaceActionsInput): RaceActions => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [resetOn]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(`${label} — ${err?.message || 'unknown error'}`);
    }
  };

  /** Every command carries where the phone thinks it is; the server decides what that buys. */
  const here = () => ({
    team_token: session.teamToken,
    lat: playerLocation?.lat || 0,
    lon: playerLocation?.lon || 0,
    accuracy_m: playerLocation?.accuracy || 10
  });

  return {
    error,

    startChallenge: (waypointId) =>
      run('Could not start the challenge', async () => {
        const result = await startChallenge(gameState.gameId!, {
          waypoint_id: waypointId,
          ...here(),
          idempotency_key: `challenge-${waypointId}-${Date.now()}`
        });
        onStartChallenge(waypointId, result.prompt, result.rubric, result.challenge_id);
      }),

    veto: (waypointId) =>
      run('Veto failed', () =>
        vetoChallenge(gameState.gameId!, {
          waypoint_id: waypointId,
          team_token: session.teamToken,
          idempotency_key: `veto-${waypointId}-${Date.now()}`
        })
      ),

    arrive: (waypointId) =>
      run('Arrival not recorded', () =>
        arriveWaypoint(gameState.gameId!, {
          waypoint_id: waypointId,
          ...here(),
          idempotency_key: `arrive-${waypointId}-${Date.now()}`
        })
      ),

    endRun: async () => {
      if (!onEndRun) return;
      await run('Could not end the run', onEndRun);
    }
  };
};
