import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  projectionStore,
  isSoloMode,
  isCoinRush,
  type GameState
} from '../../core/projection/projectionStore';
import { type GPSPosition } from '../../core/player/locationService';
import { type GpsErrorInfo } from '../../core/player/gpsStatus';
import { useGpsStatus } from '../../core/player/useGpsWatch';
import { type TeamSession } from '../../core/game/teamSession';
import { GameLogFeed } from '../shared/GameLogFeed';
import { ShopPanel } from './ShopPanel';
import { Dialog, Notice, Progress, Sheet, showToast } from '@ds';
import { useIsPhone, usePlayerSheet, useSheetAttention } from './useSheetChrome';
import { useRaceClock } from './useRaceClock';
import { useRaceRoute, type DestinationChoice } from './useRaceRoute';
import { useRaceActions } from './useRaceActions';
import { useConsoleOverlays } from './useConsoleOverlays';
import { useChallengePhotos } from './photoStatus';
import { buildObjective } from './objective';
import { ConsoleHeader } from './components/ConsoleHeader';
import { FieldBar } from './components/FieldBar';
import { Vitals } from './components/Vitals';
import { ObjectiveCard } from './components/ObjectiveCard';
import { RouteStrip } from './components/RouteStrip';
import { EffectChips } from './components/EffectChips';
import { ConsoleMore } from './components/ConsoleMore';
import { VetoDialog } from './components/VetoDialog';
import { EndRunDialog } from './components/EndRunDialog';
import { InviteDialog } from './components/InviteDialog';
import './player-console.css';

/** What the phone's GPS watch has reported besides the position itself. */
export interface GpsFacts {
  error: GpsErrorInfo | null;
  lastFixAt: number | null;
}

interface PlayerConsoleProps {
  playerLocation: GPSPosition | null;
  gps: GpsFacts;
  /** Always present: this console only exists for a device holding a team. */
  session: TeamSession;
  /** The destination the player picked by hand, held above so it survives the console closing for a photo. */
  destinationChoice: DestinationChoice;
  /** Reports the waypoint the map should highlight as the chosen next stop, or null for none. */
  onDestinationChange?: (waypointId: string | null) => void;
  /** Reports how many pixels of the sheet are showing above the screen bottom, so the map can keep its controls and centre clear of it. */
  onSheetInset?: (visiblePx: number) => void;
  /** Steps this device back from its team, which drops it out of the race. */
  onLeave: () => void;
  /** Callback to end a solo run session; omitted in team races. */
  onEndRun?: () => Promise<void>;
  onStartChallenge: (waypointId: string, prompt: string, rubric: any, challengeId?: string, roadId?: string) => void;
  /** Opens the capture flow for the roadblock card standing on a road. */
  onClearRoadblock: (roadId: string, cardText: string) => void;
}

/** Primary player racing surface console component. */
export const PlayerConsole: React.FC<PlayerConsoleProps> = ({
  playerLocation,
  gps,
  session,
  destinationChoice,
  onDestinationChange,
  onSheetInset,
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

  const phone = useIsPhone();
  const sheet = usePlayerSheet();
  const overlays = useConsoleOverlays();
  const clock = useRaceClock(gameState, session.teamId);
  const route = useRaceRoute(gameState, session, playerLocation, destinationChoice);
  const gpsStatus = useGpsStatus({ position: playerLocation, error: gps.error, lastFixAt: gps.lastFixAt });
  const photos = useChallengePhotos({
    gameState,
    teamId: session.teamId,
    waypointId: route.currentWaypoint?.id,
    roadId: route.destination?.road.id
  });
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
    photos,
    gps: gpsStatus,
    busy: actions.busy,
    on: {
      startChallenge: actions.startChallenge,
      arrive: actions.arrive,
      askVeto: (waypointId, roadId) => overlays.open({ kind: 'veto', waypointId, roadId })
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

  // A tap on a waypoint that is not one of the roads out is refused with a plain word instead of silently ignored.
  const routesRef = useRef(route.routes);
  routesRef.current = route.routes;
  const { id: pickedId, set: setPicked } = destinationChoice;
  useEffect(() => {
    if (!pickedId || routesRef.current.length === 0) return;
    if (routesRef.current.some((r) => r.waypoint.id === pickedId)) return;
    setPicked(null);
    showToast("That stop isn't one of your next roads. Pick from the routes out.", { tone: 'gold' });
  }, [pickedId, setPicked]);

  // The sheet opens itself and the action pulses when a challenge unlocks or the arrival zone is entered.
  const alertKey =
    objective.primary && (objective.tone === 'go' || objective.tone === 'challenge')
      ? `${objective.tone}:${objective.primary.label}:${route.currentWaypoint?.id ?? ''}:${route.destination?.road.id ?? ''}`
      : null;
  const pulseKey = useSheetAttention(alertKey, sheet.openToPeek);

  // Only the next stop is highlighted, and only while the team is actually choosing or walking to one.
  const mapTarget =
    route.isCurrentWaypointCleared && !route.reachedFinish && !gameState.winner && gameState.state !== 'ended'
      ? route.destination?.waypoint.id ?? null
      : null;
  const onDestinationChangeRef = useRef(onDestinationChange);
  onDestinationChangeRef.current = onDestinationChange;
  useEffect(() => {
    onDestinationChangeRef.current?.(mapTarget);
  }, [mapTarget]);

  const onSheetInsetRef = useRef(onSheetInset);
  onSheetInsetRef.current = onSheetInset;

  // The visible height goes up to the shell so the map can aim its camera at the part of the screen the sheet leaves free.
  const reportInset = useCallback((px: number) => {
    onSheetInsetRef.current?.(Math.max(0, Math.round(px)));
  }, []);

  useEffect(() => {
    if (!phone) {
      reportInset(0);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = document.querySelector<HTMLElement>('.player-sheet');
        if (root) reportInset(window.innerHeight - root.getBoundingClientRect().top);
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [phone, reportInset]);

  useEffect(
    () => () => {
      onSheetInsetRef.current?.(0);
    },
    []
  );

  const overlay = overlays.overlay;
  const gpsBlocks = gpsStatus.state === 'denied' || gpsStatus.state === 'unavailable';

  const vitals = (
    <Vitals
      gameState={gameState}
      session={session}
      clock={clock}
      solo={solo}
      timeTrial={timeTrial}
      shopLocked={shopLocked}
      onOpenShop={() => overlays.open({ kind: 'shop' })}
    />
  );

  return (
    <>
      <Sheet
        className="player-sheet"
        label="Race panel"
        snap={phone ? sheet.snap : 'expanded'}
        onSnapChange={sheet.setSnap}
        onSettle={(_snap, visible) => reportInset(visible)}
        summary={
          phone ? (
            <FieldBar
              objective={objective}
              gps={gpsStatus}
              vitals={vitals}
              pulseKey={pulseKey}
              error={actions.error}
            />
          ) : undefined
        }
      >
        <ConsoleHeader
          gameState={gameState}
          session={session}
          clock={clock}
          solo={solo}
          timeTrial={timeTrial}
          shopLocked={shopLocked}
          showVitals={!phone}
          gps={gpsStatus}
          onOpenShop={() => overlays.open({ kind: 'shop' })}
        />

        <div className="player-sheet__prog">
          <Progress
            value={route.reached}
            max={route.total}
            variant="sunset"
            label="Waypoints reached"
            valueText={`${route.reached} of ${route.total} waypoints`}
          />
        </div>

        <div className="player-sheet__scroll">
          <div className="player-sheet__focus">
            {!phone && actions.error && (
              <Notice kind="stop" title="That didn't go through">
                {actions.error}
              </Notice>
            )}

            {gpsBlocks && (
              <Notice kind="stop" title={gpsStatus.label}>
                {gpsStatus.detail}
              </Notice>
            )}

            <ObjectiveCard objective={objective} inFieldBar={phone} />

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
      </Sheet>

      {/* Everything that goes over the top of the console. One at a time. */}
      {overlay?.kind === 'log' && (
        <Dialog open title={solo ? 'Run log' : 'Race log'} onClose={overlays.close}>
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
            const { waypointId, roadId } = overlay;
            overlays.close();
            void actions.veto(waypointId, roadId);
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
            !route.isCurrentWaypointCleared
              ? route.currentWaypoint?.id
              : route.destination?.road.challengeId && route.destination.road.lockState === 'locked'
                ? route.destination.road.id
                : undefined
          }
          onClose={overlays.close}
        />
      )}
    </>
  );
};
