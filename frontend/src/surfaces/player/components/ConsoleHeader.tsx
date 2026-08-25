import React from 'react';
import { type GameState } from '../../../core/projection/projectionStore';
import { type TeamSession } from '../../../core/game/teamSession';
import { slotColor } from '../../../core/team/palette';
import { formatClock } from '../../../core/format/clock';
import { IconCoin } from '@ds';
import { type RaceClock } from '../useRaceClock';

interface ConsoleHeaderProps {
  gameState: GameState;
  session: TeamSession;
  clock: RaceClock;
  solo: boolean;
  timeTrial: boolean;
  /** A settled coin rush score: the pill still shows it, but opens nothing. */
  shopLocked: boolean;
  onOpenShop: () => void;
}

/** Who you are, what time it is, and what you can spend. */
export const ConsoleHeader: React.FC<ConsoleHeaderProps> = ({
  gameState,
  session,
  clock,
  solo,
  timeTrial,
  shopLocked,
  onOpenShop
}) => {
  const teamColor = slotColor(session.slotIndex).color;
  const coins = gameState.coins[session.teamId] || 0;
  const vetoPenaltyTotal = gameState.clock.timePenaltySeconds;

  return (
    <header className="player-sheet__head">
      <div className="player-id">
        <div className="player-id__info">
          <span className="player-id__dot" style={{ backgroundColor: teamColor }} />
          <span className="player-id__name">{gameState.teams[session.teamId]?.name || session.teamName}</span>
        </div>
        {/* The run clock. Loud in a time trial, where it is the whole point;
            present but quiet in a casual walk, where it is just a fact. */}
        {solo && gameState.clock.startedAt && (
          <span
            className={`run-clock${timeTrial ? ' run-clock--loud' : ''}`}
            role="timer"
            aria-label={timeTrial ? 'Elapsed run time including penalties' : 'Time on the route'}
          >
            {formatClock(clock.runElapsed)}
            {timeTrial && vetoPenaltyTotal > 0 && (
              <span className="run-clock__pen">+{formatClock(vetoPenaltyTotal)}</span>
            )}
          </span>
        )}
        {/* The coin rush countdown, once somebody is home. Always loud: from
            here on it is the only thing left that can end the race. */}
        {clock.countdownRunning && (
          <span
            className="run-clock run-clock--loud"
            role="timer"
            aria-label="Time left before the race is called"
          >
            {formatClock(clock.countdownLeft)}
            <span className="run-clock__pen">left</span>
          </span>
        )}
        <button
          type="button"
          className="coin-pill"
          onClick={onOpenShop}
          // A finished coin rush team has a settled score, and the server 403s
          // its purchases. The pill stays — the number is now the final
          // score — but it stops pretending to be a door.
          aria-label={shopLocked ? `${coins} coins — final score` : `${coins} coins — open shop`}
        >
          <IconCoin /> {coins}
          <span className="coin-pill__tag">{shopLocked ? 'final' : 'shop'}</span>
        </button>
      </div>
    </header>
  );
};
