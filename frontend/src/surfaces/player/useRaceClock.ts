import { useEffect, useState } from 'react';
import {
  elapsedSeconds,
  isCoinRush,
  isSoloMode,
  type GameState
} from '../../core/projection/projectionStore';
import { secondsUntil } from './consoleFormat';

/** Race clock state containing elapsed run time and active countdowns. */
export interface RaceClock {
  /** Timestamp tick value for dating events. */
  now: number;
  /** Solo run elapsed seconds including penalties. */
  runElapsed: number;
  freezeLeft: number;
  vetoLeft: number;
  trackerLeft: number;
  /** Coin rush countdown seconds remaining. */
  countdownLeft: number;
  countdownRunning: boolean;
}

/** Hook providing a single-interval tick for active race countdowns. */
export const useRaceClock = (gameState: GameState, teamId: string): RaceClock => {
  const [now, setNow] = useState(() => Date.now());

  const effects = gameState.effects[teamId] || { curses: [] };
  const solo = isSoloMode(gameState.mode);
  const coinRush = isCoinRush(gameState.mode);

  /** A solo run's clock is counting up for as long as it has not finished. */
  const runInProgress = solo && !!gameState.clock.startedAt && !gameState.clock.finishedAt;
  /** A coin rush counts *down*, and only once somebody is home. */
  const coinRushDeadline = coinRush ? gameState.coinRush?.deadline ?? null : null;
  const countdownRunning = !!coinRushDeadline && gameState.state !== 'ended';
  const isTiming =
    !!(effects.frozenUntil || effects.vetoPenaltyUntil || effects.trackerOffUntil) ||
    runInProgress ||
    countdownRunning;

  // Interval timer tick during active timing states.
  useEffect(() => {
    if (!isTiming) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isTiming]);

  return {
    now,
    runElapsed: elapsedSeconds(gameState.clock, now),
    freezeLeft: secondsUntil(effects.frozenUntil, now),
    vetoLeft: secondsUntil(effects.vetoPenaltyUntil, now),
    trackerLeft: secondsUntil(effects.trackerOffUntil, now),
    countdownLeft: coinRushDeadline ? secondsUntil(coinRushDeadline, now) : 0,
    countdownRunning
  };
};
