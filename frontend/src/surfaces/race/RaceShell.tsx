import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import { MapCore } from '../../core/map/MapCore';
import { PlayerConsole } from '../player/PlayerConsole';
import { CaptureFlow } from '../player/CaptureFlow';
import { HostToolsPanel } from '../host/HostToolsPanel';
import { projectionStore, isSoloMode, type GameState } from '../../core/projection/projectionStore';
import { websocketClient } from '../../core/projection/websocketClient';
import { useGpsWatch } from '../../core/player/useGpsWatch';
import { syncEngine } from '../../core/projection/syncEngine';
import { updateManager } from '../../core/pwa/updateManager';
import { loadTeamSession, clearTeamSession, type TeamSession } from '../../core/game/teamSession';
import { loadHostSession, clearHostSession, type HostSession } from '../../core/game/hostSession';
import { resolveFeedToken, rememberRace, getRaceMode, isSoloRaceMode, lobbyPathForDevice, touchRace } from '../../core/game/raceSession';
import { useRaceIndexSync } from '../../core/game/useRaceIndexSync';
import { reportPosition, endGame } from '../../core/api/client';
import { TopBar } from '../shared/TopBar';
import { Tabs, Toast, Button, Badge, Empty, showToast, useConfirm, Icon } from '@ds';
import { CelebrationOverlay } from '../player/CelebrationOverlay';
import { useRaceMoments } from '../../core/game/useRaceMoments';
import { useWakeLock } from '../../core/hooks/useWakeLock';
import './race-shell.css';

type RaceView = 'play' | 'host';

const CONNECTION_LABEL = {
  connected: { tone: 'moss', label: 'Online' },
  connecting: { tone: 'gold', label: 'Connecting' },
  catching_up: { tone: 'gold', label: 'Catching up' },
  disconnected: { tone: 'crimson', label: 'Offline' }
} as const;

/** Primary container shell for active race view. */
export const RaceShell: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const [gameState, setGameState] = useState<GameState>(projectionStore.getState());
  const [session, setSession] = useState<TeamSession | null>(() => (gameId ? loadTeamSession(gameId) : null));
  const [hostSession, setHostSession] = useState<HostSession | null>(() => (gameId ? loadHostSession(gameId) : null));
  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [syncState, setSyncState] = useState<'online' | 'offline' | 'syncing'>('online');
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);

  const [chosenDestination, setChosenDestination] = useState<string | null>(null);
  const [targetWaypointId, setTargetWaypointId] = useState<string | null>(null);
  const [sheetInset, setSheetInset] = useState(0);
  const [activeChallenge, setActiveChallenge] = useState<{ mode?: 'challenge' | 'roadblock'; waypointId: string; roadId?: string; challengeId?: string; prompt: string; rubric: any } | null>(null);

  const [watchedSubmission, setWatchedSubmission] = useState<string | null>(null);

  const solo = isSoloMode(gameState.mode) || (gameId ? isSoloRaceMode(getRaceMode(gameId)) : false);

  const destinations = useMemo(() => {
    const items: Array<{ id: RaceView; label: string; icon: React.ReactNode }> = [];
    if (session) items.push({ id: 'play', label: 'Play', icon: <Icon name="flag" /> });
    if (hostSession && !solo) items.push({ id: 'host', label: 'Host tools', icon: <Icon name="sliders" /> });
    return items;
  }, [session, hostSession, solo]);

  const showSwitcher = destinations.length > 1;

  const requestedView = searchParams.get('view') as RaceView | null;
  const view: RaceView = destinations.some((d) => d.id === requestedView)
    ? (requestedView as RaceView)
    : destinations[0]?.id ?? 'play';

  const setView = (next: RaceView) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', next);
    setSearchParams(params, { replace: true });
  };

  const feedToken = useMemo(() => {
    return gameId ? resolveFeedToken(gameId) : '';
  }, [gameId]);

  useEffect(() => {
    if (!gameId) return;
    if (feedToken) {
      websocketClient.init(gameId, feedToken);
    } else {
      console.warn('[RaceShell] No capability for this race — sending to the lobby');
    }
    rememberRace({ gameId });

    const unsubscribe = projectionStore.subscribe((state) => setGameState(state));
    const unsubscribeSync = syncEngine.subscribe((state) => setSyncState(state));
    const unsubscribeQueue = syncEngine.subscribeQueueCount((count) => setQueuedCount(count));
    const unsubscribeUpdate = updateManager.subscribe((available) => setUpdateAvailable(available));

    return () => {
      unsubscribe();
      unsubscribeSync();
      unsubscribeQueue();
      unsubscribeUpdate();
      websocketClient.disconnect();
    };
  }, [gameId, feedToken]);

  useRaceIndexSync(gameId);

  const moments = useRaceMoments(session?.teamId);
  useWakeLock(view === 'play' && !!session && gameState.state === 'live' && !gameState.winner);

  // Continuous player GPS watcher; the position, its error and the last-fix time all reach the console as state.
  const gpsWatch = useGpsWatch(view === 'play');
  const playerLocation = gpsWatch.position;
  const latestLocationRef = gpsWatch.latestRef;

  // Periodic background position reporter (every 10 seconds)
  useEffect(() => {
    if (view !== 'play' || !session) return;
    const interval = setInterval(async () => {
      // Read through the ref so a new fix does not restart the interval.
      const pos = latestLocationRef.current;
      if (!pos) return;
      try {
        await reportPosition(session.gameId, {
          team_token: session.teamToken,
          lat: pos.lat,
          lon: pos.lon,
          accuracy_m: pos.accuracy
        });
      } catch (err) {
        console.warn('[GPS] Failed to report position to server:', err);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [view, session, latestLocationRef]);

  // A new junction wipes the hand-picked destination, so a stale pick cannot follow the team to the next fork.
  const currentWaypointId = session ? gameState.progress[session.teamId]?.currentWaypointId : undefined;
  useEffect(() => {
    setChosenDestination(null);
  }, [currentWaypointId]);

  // Listens for submission verdict updates.
  useEffect(() => {
    if (!watchedSubmission) return;

    const announce = (state: GameState): boolean => {
      const sub = state.submissions?.[watchedSubmission];
      if (!sub || (sub.status !== 'pass' && sub.status !== 'fail')) return false;
      // An approval is celebrated full-screen by useRaceMoments, so only a rejection needs a toast.
      if (sub.status === 'fail') {
        showToast('Rejected. Take another photo.', { tone: 'crimson', duration: 6000 });
      }
      setWatchedSubmission(null);
      return true;
    };

    if (announce(projectionStore.getState())) return;
    return projectionStore.subscribe(announce);
  }, [watchedSubmission]);

  // Stepping back from the team is the only way a session ends here — joining one
  // happens in the lobby. For solo runs, leaving the run also ends the game on the server.
  const handleLeaveTeam = async () => {
    if (gameId) {
      if (solo) {
        if (hostSession && gameState.state !== 'ended') {
          try {
            await endGame(gameId, hostSession.hostToken);
          } catch (err) {
            console.warn('[RaceShell] Failed to end solo game on leave:', err);
          }
        }
        clearHostSession(gameId);
        // State follows storage. Without this the host tools tab stays offered
        // for a capability this device has just thrown away.
        setHostSession(null);
        touchRace(gameId, { status: 'ended' });
      }
      clearTeamSession(gameId);
    }
    setSession(null);
    if (solo) {
      navigate('/', { replace: true });
    }
  };

  const confirmLeave = async () => {
    const runOver = gameState.state === 'ended' || !!gameState.winner;
    const timeTrial = gameState.mode === 'solo_time_trial';
    const ok = solo
      ? runOver
        ? await confirm({
            title: 'Leave this run?',
            message: 'The run is already over. Your result stays in My Races.',
            confirmLabel: 'Leave',
            cancelLabel: 'Stay'
          })
        : await confirm({
            title: 'Leave and end this run?',
            message: `Leaving ends your run for good, and you cannot pick it back up.${timeTrial ? ' No time will be posted.' : ''}`,
            confirmLabel: 'End run and leave',
            cancelLabel: 'Keep going',
            danger: true
          })
      : await confirm({
          title: 'Leave this race?',
          message:
            'This phone stops playing for your team, and the race carries on without it. To get back in you need your team’s invite again.',
          confirmLabel: 'Leave race',
          cancelLabel: 'Stay in the race',
          danger: true
        });
    if (ok) await handleLeaveTeam();
  };

  const handleEndRun = async () => {
    if (!gameId || !hostSession) return;
    await endGame(gameId, hostSession.hostToken);
  };

  if (!gameId) {
    return (
      <div className="app-shell">
        <Empty
          icon={<Icon name="compass" />}
          title="No race to show"
          description="This link is incomplete. Try My Races."
          action={
            <Button variant="primary" onClick={() => navigate('/races')}>
              My Races
            </Button>
          }
        />
      </div>
    );
  }

  if (!session && !hostSession) {
    return <Navigate to={solo ? '/' : lobbyPathForDevice(gameId)} replace />;
  }

  const connection = CONNECTION_LABEL[gameState.connection] ?? CONNECTION_LABEL.disconnected;

  const banners: React.ReactNode[] = [];

  if (syncState === 'offline') {
    banners.push(
      <Toast key="offline" tone="rust">
        <Icon name="wifi-off" /> Offline. {queuedCount > 0 ? `${queuedCount} submission${queuedCount === 1 ? '' : 's'} waiting to sync.` : 'Actions sync when signal returns.'}
      </Toast>
    );
  }

  if (updateAvailable && !activeChallenge) {
    banners.push(
      <Toast key="update" tone="gold">
        <span><Icon name="download" /> A new version is ready.</span>
        <Button variant="primary" size="sm" onClick={() => updateManager.applyUpdate()}>
          Reload now
        </Button>
      </Toast>
    );
  }

  if (syncState === 'syncing') {
    banners.push(
      <Toast key="syncing" tone="moss">
        <Icon name="powerup" /> Back online. Syncing…
      </Toast>
    );
  }

  const fullBleed = view === 'host';

  return (
    <div className="app-shell">
      <TopBar
        subtitle={gameState.boardName || undefined}
        actions={
          <>
            {/* The Play and Host tools switch stays in the header at every width, because a bottom bar would sit under the race panel. */}
            {showSwitcher && (
              <Tabs
                items={destinations.map((d) => ({ ...d }))}
                active={view}
                onChange={(id) => setView(id as RaceView)}
              />
            )}
            <Badge tone={connection.tone}>{connection.label}</Badge>
          </>
        }
      />

      <main className={`app-main${fullBleed ? ' app-main--full' : ''}`}>
        {!fullBleed && (
          <div className="map-stage">
            <MapCore
              interactive={true}
              playerLocation={playerLocation}
              activeTeamId={session?.teamId}
              targetWaypointId={view === 'play' && session ? targetWaypointId : null}
              onPickWaypoint={view === 'play' && session ? setChosenDestination : undefined}
              bottomInset={view === 'play' ? sheetInset : 0}
            />
            {banners.length > 0 && <div className="toast-stack">{banners}</div>}
          </div>
        )}

        {view === 'host' && hostSession && (
          <HostToolsPanel gameId={gameId} hostToken={hostSession.hostToken} gameState={gameState} />
        )}

        {view === 'play' && session && (
          activeChallenge ? (
            <CaptureFlow
              mode={activeChallenge.mode}
              waypointId={activeChallenge.waypointId}
              roadId={activeChallenge.roadId}
              challengeId={activeChallenge.challengeId}
              prompt={activeChallenge.prompt}
              rubric={activeChallenge.rubric}
              session={session}
              verification={gameState.ruleset.verification}
              playerLocation={playerLocation}
              onWatchVerdict={setWatchedSubmission}
              onClose={() => setActiveChallenge(null)}
            />
          ) : (
            <PlayerConsole
              playerLocation={playerLocation}
              gps={{ error: gpsWatch.error, lastFixAt: gpsWatch.lastFixAt }}
              session={session}
              destinationChoice={{ id: chosenDestination, set: setChosenDestination }}
              onDestinationChange={setTargetWaypointId}
              onSheetInset={setSheetInset}
              onLeave={confirmLeave}
              onEndRun={solo && hostSession ? handleEndRun : undefined}
              onStartChallenge={(waypointId, prompt, rubric, challengeId, roadId) => setActiveChallenge({ waypointId, roadId, challengeId, prompt, rubric })}
              onClearRoadblock={(roadId, cardText) =>
                setActiveChallenge({
                  mode: 'roadblock',
                  waypointId: roadId,
                  prompt: cardText,
                  rubric: { must_show: [cardText], fails_if: [], acceptable_ambiguity: '' }
                })
              }
            />
          )
        )}
      </main>

      {view === 'play' && session && moments.current && (
        <CelebrationOverlay
          key={moments.current.moment.key}
          celebration={moments.current}
          onContinue={moments.dismiss}
        />
      )}
    </div>
  );
};

export default RaceShell;
