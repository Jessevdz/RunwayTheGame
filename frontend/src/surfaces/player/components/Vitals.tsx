import React from 'react';
import { type GameState } from '../../../core/projection/projectionStore';
import { type TeamSession } from '../../../core/game/teamSession';
import { formatClock } from '../../../core/format/clock';
import { Clock, Icon } from '@ds';
import { type RaceClock } from '../useRaceClock';

interface VitalsProps {
  gameState: GameState;
  session: TeamSession;
  clock: RaceClock;
  solo: boolean;
  timeTrial: boolean;
  /** A settled coin rush score: the pill still shows it, but opens nothing. */
  shopLocked: boolean;
  onOpenShop: () => void;
}

/** The numbers a player checks on the move: run clock, coin rush countdown, and coins. */
export const Vitals: React.FC<VitalsProps> = ({ gameState, session, clock, solo, timeTrial, shopLocked, onOpenShop }) => {
  const coins = gameState.coins[session.teamId] || 0;
  const penalty = gameState.clock.timePenaltySeconds;

  return (
    <div className="vitals">
      {/* Loud in a time trial, where the clock is the whole point; quiet in a casual walk, where it is just a fact. */}
      {solo && gameState.clock.startedAt && (
        <span className={`vitals__clock${timeTrial ? ' vitals__clock--loud' : ''}`}>
          <Clock
            flap
            seconds={clock.runElapsed}
            size="md"
            ariaLabel={timeTrial ? 'Elapsed run time including penalties' : 'Time on the route'}
          />
          {timeTrial && penalty > 0 && <span className="vitals__pen">+{formatClock(penalty)}</span>}
        </span>
      )}
      {/* The coin rush countdown, once somebody is home: from here on it is the only thing that can end the race. */}
      {clock.countdownRunning && (
        <span className="vitals__clock vitals__clock--loud">
          <Clock flap seconds={clock.countdownLeft} size="md" ariaLabel="Time left before the race is called" />
          <span className="vitals__pen">left</span>
        </span>
      )}
      <button
        type="button"
        className="coin-pill"
        onClick={onOpenShop}
        // A finished coin rush team has a settled score, and the server 403s its purchases, so the pill stops pretending to be a door.
        aria-label={shopLocked ? `${coins} coins, final score` : `${coins} coins, open shop`}
      >
        <Icon name="coin" /> {coins}
        <span className="coin-pill__tag">{shopLocked ? 'final' : 'shop'}</span>
      </button>
    </div>
  );
};
