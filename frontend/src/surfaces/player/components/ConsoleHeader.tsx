import React from 'react';
import { type GameState } from '../../../core/projection/projectionStore';
import { type TeamSession } from '../../../core/game/teamSession';
import { type GpsStatus } from '../../../core/player/gpsStatus';
import { type RaceClock } from '../useRaceClock';
import { GpsChip } from './GpsChip';
import { TeamAvatar } from './TeamAvatar';
import { Vitals } from './Vitals';

interface ConsoleHeaderProps {
  gameState: GameState;
  session: TeamSession;
  clock: RaceClock;
  solo: boolean;
  timeTrial: boolean;
  /** A settled coin rush score: the pill still shows it, but opens nothing. */
  shopLocked: boolean;
  /** False on phones, where the field bar already carries the clock, coins and GPS chip. */
  showVitals: boolean;
  gps: GpsStatus;
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
  showVitals,
  gps,
  onOpenShop
}) => {
  const teamName = gameState.teams[session.teamId]?.name || session.teamName;

  return (
    <header className="player-sheet__head">
      <div className="player-id">
        <div className="player-id__info">
          <TeamAvatar teamId={session.teamId} name={teamName} teams={gameState.teams} />
          <span className="player-id__name">{teamName}</span>
        </div>
        {showVitals && (
          <Vitals
            gameState={gameState}
            session={session}
            clock={clock}
            solo={solo}
            timeTrial={timeTrial}
            shopLocked={shopLocked}
            onOpenShop={onOpenShop}
          />
        )}
      </div>
      {showVitals && <GpsChip status={gps} />}
    </header>
  );
};
