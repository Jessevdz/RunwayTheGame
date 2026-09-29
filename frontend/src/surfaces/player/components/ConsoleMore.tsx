import React from 'react';
import { useNavigate } from 'react-router-dom';
import { type GameState } from '../../../core/projection/projectionStore';
import { type TeamSession } from '../../../core/game/teamSession';
import { Button, Icon } from '@ds';
import { SoloFinish } from '../SoloFinish';
import { StandingsBoard } from './StandingsBoard';

interface ConsoleMoreProps {
  gameState: GameState;
  session: TeamSession;
  solo: boolean;
  timeTrial: boolean;
  coinRush: boolean;
  runElapsed: number;
  total: number;
  onOpenLog: () => void;
  onOpenInvite: () => void;
  /** Solo only, and only while the run can still be stopped. */
  onAskEndRun?: () => void;
  onLeave: () => void;
}

/** Secondary controls and information section for the player console. */
export const ConsoleMore: React.FC<ConsoleMoreProps> = ({
  gameState,
  session,
  solo,
  timeTrial,
  coinRush,
  runElapsed,
  total,
  onOpenLog,
  onOpenInvite,
  onAskEndRun,
  onLeave
}) => {
  const navigate = useNavigate();
  const ended = gameState.state === 'ended';

  return (
    <div className="player-sheet__more">
      {/* Solo run summary for finished solo runs. */}
      {solo && gameState.winner === session.teamId && (
        <SoloFinish
          session={session}
          gameState={gameState}
          elapsedSeconds={runElapsed}
          timeTrial={timeTrial}
        />
      )}

      {/* Link to full race report when race has ended. */}
      {ended && (
        <section className="player-more__sec">
          <h3 className="player-more__title">Race report</h3>
          <p className="player-more__note">Photos and stats from this race. Deleted after 30 days.</p>
          <div className="player-more__row">
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon name="camera" />}
              onClick={() => navigate(`/race/${session.gameId}/report`)}
            >
              Open the report
            </Button>
          </div>
        </section>
      )}

      {/* Standings board for multi-team races. */}
      {!solo && (
        <section className="player-more__sec">
          <h3 className="player-more__title">Standings</h3>
          {gameState.standings.length > 0 ? (
            <StandingsBoard
              gameState={gameState}
              teamId={session.teamId}
              coinRush={coinRush}
              total={total}
            />
          ) : (
            <p className="player-more__note">No standings yet.</p>
          )}
        </section>
      )}

      <section className="player-more__sec">
        <div className="player-more__header">
          <h3 className="player-more__title">{solo ? 'Run log' : 'Race log'}</h3>
          <Button variant="secondary" size="sm" icon={<Icon name="log" />} onClick={onOpenLog}>
            Open {solo ? 'run log' : 'race log'}
          </Button>
        </div>
      </section>

      {/* Solo run controls vs team squad options. */}
      {solo ? (
        <section className="player-more__sec">
          <h3 className="player-more__title">This run</h3>
          {(gameState.winner || ended || timeTrial) && (
            <p className="player-more__note">
              {gameState.winner || ended ? 'Run over. Find it in My Races.' : 'Ending early posts no time.'}
            </p>
          )}
          <div className="player-more__row">
            {onAskEndRun && !gameState.winner && !ended && (
              <Button variant="secondary" size="sm" onClick={onAskEndRun}>
                End run
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onLeave}>
              Leave run
            </Button>
          </div>
        </section>
      ) : (
        <section className="player-more__sec">
          <div className="player-more__header">
            <h3 className="player-more__title">Your Squad</h3>
            <Button variant="secondary" size="sm" icon={<Icon name="link" />} onClick={onOpenInvite}>
              Invite
            </Button>
          </div>
          <div className="player-more__row">
            <Button variant="ghost" size="sm" onClick={onLeave}>
              Leave race
            </Button>
          </div>
        </section>
      )}
    </div>
  );
};
