import React, { useEffect, useState } from 'react';
import {
  projectionStore,
  isSoloMode,
  isCoinRush,
  type GameState
} from '../../core/projection/projectionStore';
import { type GPSPosition } from '../../core/player/locationService';
import { type TeamSession } from '../../core/game/teamSession';
import { GameLogFeed } from '../shared/GameLogFeed';
import { ShopPanel } from './ShopPanel';
import { Dialog, Notice } from '@ds';
import { useSheetChrome } from './useSheetChrome';
import { useRaceClock } from './useRaceClock';
import { useRaceRoute } from './useRaceRoute';
import { useRaceActions } from './useRaceActions';
import { useConsoleOverlays } from './useConsoleOverlays';
import { buildObjective } from './objective';
import { SheetHeader } from './components/SheetHeader';
import { ConsoleHeader } from './components/ConsoleHeader';
import { ObjectiveCard } from './components/ObjectiveCard';
import { RouteStrip } from './components/RouteStrip';
import { EffectChips } from './components/EffectChips';
import { ConsoleMore } from './components/ConsoleMore';
import { VetoDialog } from './components/VetoDialog';
import { EndRunDialog } from './components/EndRunDialog';
import { InviteDialog } from './components/InviteDialog';
import './player-console.css';

interface PlayerConsoleProps {
  playerLocation: GPSPosition | null;
  /** Always present: this console only exists for a device holding a team. */
  session: TeamSession;
  /** Steps this device back from its team, which drops it out of the race. */
  onLeave: () => void;
  /** Callback to end a solo run session; omitted in team races. */
  onEndRun?: () => Promise<void>;
  onStartChallenge: (waypointId: string, prompt: string, rubric: any, challengeId?: string) => void;
  /** Opens the capture flow for the roadblock card standing on a road. */
  onClearRoadblock: (roadId: string, cardText: string) => void;
}

/** Primary player racing surface console component. */
export const PlayerConsole: React.FC<PlayerConsoleProps> = ({
  playerLocation,
  session,
  onLeave,
  onEndRun,
  onStartChallenge,
  onClearRoadblock: _onClearRoadblock
}) => {
  const [gameState, setGameState] = useState<GameState>(projectionStore.getState());

  useEffect(() => {
    const unsubscribe = projectionStore.subscribe((state) => setGameState(state));
    return unsubscribe;
  }, []);

  const solo = isSoloMode(gameState.mode);
  const timeTrial = gameState.mode === 'solo_time_trial';
  const coinRush = isCoinRush(gameState.mode);

  /* How much screen the sheet is allowed to take — dragged by the handle,
     collapsed by tapping it, and remembered between sessions. */
  const sheet = useSheetChrome();
  const overlays = useConsoleOverlays();
  const clock = useRaceClock(gameState, session.teamId);
  const route = useRaceRoute(gameState, session, playerLocation);
  const actions = useRaceActions({
    gameState,
    session,
    playerLocation,
    onStartChallenge,
    onEndRun,
    resetOn: route.currentWaypoint?.id
  });

  const objective = buildObjective({
    gameState,
    session,
    playerLocation,
    clock,
    route,
    on: {
      startChallenge: actions.startChallenge,
      arrive: actions.arrive,
      askVeto: (waypointId) => overlays.open({ kind: 'veto', waypointId })
    }
  });

  /** Mirrors api.coinRushLocksOut. The server's 403 is the rule; this is so the
   *  console does not offer a door it knows is bolted. */
  const shopLocked = coinRush && route.reachedFinish;

  // A veto cooldown is deliberately not on this list: it stops the team taking
  // on challenges, never walking, so the route choice has to stay on screen.
  const showRoutes =
    route.routes.length > 1 &&
    !gameState.winner &&
    clock.freezeLeft === 0 &&
    route.isCurrentWaypointCleared;

  const sheetClass = [
    'player-sheet',
    sheet.collapsed ? 'player-sheet--collapsed' : '',
    sheet.unfolding ? 'player-sheet--unfolding' : '',
    sheet.dragging ? '' : 'player-sheet--animated'
  ]
    .filter(Boolean)
    .join(' ');

  const overlay = overlays.overlay;

  return (
    <aside
      className={sheetClass}
      style={{ '--sheet-h': `${Math.round(sheet.height * 100)}%` } as React.CSSProperties}
      aria-label="Player console"
    >
      <SheetHeader
        sheet={sheet}
        objective={objective}
        reached={route.reached}
        total={route.total}
        progressPct={route.progressPct}
      />

      <ConsoleHeader
        gameState={gameState}
        session={session}
        clock={clock}
        solo={solo}
        timeTrial={timeTrial}
        shopLocked={shopLocked}
        onOpenShop={() => overlays.open({ kind: 'shop' })}
      />

      <div className="player-sheet__scroll">
        <div className="player-sheet__focus">
          {actions.error && (
            <Notice kind="stop" title="That didn't go through">
              {actions.error}
            </Notice>
          )}

          <ObjectiveCard objective={objective} />

          {showRoutes && (
            <RouteStrip
              routes={route.routes}
              selectedWaypointId={route.destination?.waypoint.id}
              onChoose={route.chooseDestination}
            />
          )}

          <EffectChips
            vetoLeft={clock.vetoLeft}
            trackerLeft={clock.trackerLeft}
            /* The cooldown appears here once the waypoint is behind you — while
               you are still standing on the challenge it refuses, the objective
               card carries it instead. */
            showVetoChip={clock.vetoLeft > 0 && route.isCurrentWaypointCleared}
          />
        </div>

        <ConsoleMore
          gameState={gameState}
          session={session}
          solo={solo}
          timeTrial={timeTrial}
          coinRush={coinRush}
          runElapsed={clock.runElapsed}
          total={route.total}
          onOpenLog={() => overlays.open({ kind: 'log' })}
          onOpenInvite={() => overlays.open({ kind: 'invite' })}
          onAskEndRun={onEndRun ? () => overlays.open({ kind: 'end-run' }) : undefined}
          onLeave={onLeave}
        />
      </div>

      {/* Everything that goes over the top of the console. One at a time. */}
      {overlay?.kind === 'log' && (
        <Dialog open title={solo ? '📜 Run log' : '📜 Race log'} onClose={overlays.close}>
          <GameLogFeed logs={gameState.logs} />
        </Dialog>
      )}

      {overlay?.kind === 'veto' && (
        <VetoDialog
          solo={solo}
          timeTrial={timeTrial}
          vetoTimePenalty={gameState.ruleset.vetoTimePenaltySeconds}
          vetoPenaltyTotal={gameState.clock.timePenaltySeconds}
          vetoCooldown={gameState.ruleset.vetoPenaltyMinSeconds}
          onCancel={overlays.close}
          onConfirm={() => {
            const { waypointId } = overlay;
            overlays.close();
            void actions.veto(waypointId);
          }}
        />
      )}

      {overlay?.kind === 'end-run' && (
        <EndRunDialog
          timeTrial={timeTrial}
          onCancel={overlays.close}
          onConfirm={() => {
            overlays.close();
            void actions.endRun();
          }}
        />
      )}

      {overlay?.kind === 'invite' && <InviteDialog session={session} onClose={overlays.close} />}

      {/* The shop needs to know which waypoint a Challenge Skip would be skipping.
          It has no idea where the player is standing, and without this an
          activated skip reached the server with no target and did nothing at
          all — the console is the only thing that knows the gating waypoint, because
          it is rendering the challenge card from it. */}
      {overlay?.kind === 'shop' && (
        <ShopPanel
          session={session}
          gameState={gameState}
          gatingWaypointId={
            !route.isCurrentWaypointCleared ? route.currentWaypoint?.id : undefined
          }
          onClose={overlays.close}
        />
      )}
    </aside>
  );
};
