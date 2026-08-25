import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import { MapCore } from '../../core/map/MapCore';
import { PlayerConsole } from '../player/PlayerConsole';
import { CaptureFlow } from '../player/CaptureFlow';
import { HostToolsPanel, type ToastMessage } from '../host/HostToolsPanel';
import { projectionStore, isSoloMode, type GameState } from '../../core/projection/projectionStore';
import { websocketClient } from '../../core/projection/websocketClient';
import { watchPlayerLocation, type GPSPosition } from '../../core/player/locationService';
import { syncEngine } from '../../core/projection/syncEngine';
import { updateManager } from '../../core/pwa/updateManager';
import { loadTeamSession, clearTeamSession, type TeamSession } from '../../core/game/teamSession';
import { loadHostSession, clearHostSession, type HostSession } from '../../core/game/hostSession';
import { resolveFeedToken, rememberRace, getRaceMode, isSoloRaceMode, lobbyPathForDevice, touchRace } from '../../core/game/raceSession';
import { useRaceIndexSync } from '../../core/game/useRaceIndexSync';
import { reportPosition, endGame } from '../../core/api/client';
import { TopBar } from '../shared/TopBar';
import { Tabs, BottomNav, Toast, Button, Badge, Empty, BrandLines } from '@ds';

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
  const [searchParams, setSearchParams] = useSearchParams();

  const [gameState, setGameState] = useState<GameState>(projectionStore.getState());
  const [session, setSession] = useState<TeamSession | null>(() => (gameId ? loadTeamSession(gameId) : null));
  const [hostSession, setHostSession] = useState<HostSession | null>(() => (gameId ? loadHostSession(gameId) : null));
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [syncState, setSyncState] = useState<'online' | 'offline' | 'syncing'>('online');
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);

  const [playerLocation, setPlayerLocation] = useState<GPSPosition | null>(null);
  const latestLocationRef = useRef<GPSPosition | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<{ mode?: 'challenge' | 'roadblock'; waypointId: string; challengeId?: string; prompt: string; rubric: any } | null>(null);

  const [watchedSubmission, setWatchedSubmission] = useState<string | null>(null);

  const solo = isSoloMode(gameState.mode) || (gameId ? isSoloRaceMode(getRaceMode(gameId)) : false);

  const destinations = useMemo(() => {
    const items: Array<{ id: RaceView; label: string; icon: string }> = [];
    if (session) items.push({ id: 'play', label: 'Play', icon: '📱' });
    if (hostSession && !solo) items.push({ id: 'host', label: 'Host tools', icon: '🛠️' });
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

  // Continuous player GPS location watcher
  useEffect(() => {
    if (view !== 'play') return;
    const unsubscribeLocation = watchPlayerLocation(
      (pos) => {
        const prev = latestLocationRef.current;
        latestLocationRef.current = pos;
        // A repeated fix carries no new information, so it should not re-render the shell.
        if (prev && prev.lat === pos.lat && prev.lon === pos.lon && prev.accuracy === pos.accuracy) return;
        setPlayerLocation(pos);
      },
      (err) => console.warn('[GPS] Geolocation watch error:', err.message)
    );
    return () => unsubscribeLocation();
  }, [view]);

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
  }, [view, session]);

  const pushToast = (text: string, tone: ToastMessage['tone'] = 'moss') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, tone, text }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  };

  // Listens for submission verdict updates.
  useEffect(() => {
    if (!watchedSubmission) return;

    const announce = (state: GameState): boolean => {
      const sub = state.submissions?.[watchedSubmission];
      if (!sub || (sub.status !== 'pass' && sub.status !== 'fail')) return false;
      const passed = sub.status === 'pass';
      const id = Date.now() + Math.random();
      setToasts((prev) => [
        ...prev,
        {
          id,
          tone: passed ? 'moss' : 'crimson',
          text: passed ? 'Verdict: approved — waypoint cleared.' : 'Verdict: rejected — take another photo.'
        }
      ]);
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
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

  const handleEndRun = async () => {
    if (!gameId || !hostSession) return;
    await endGame(gameId, hostSession.hostToken);
  };

  if (!gameId) {
    return (
      <div className="app-shell">
        <Empty
          icon="🧭"
          title="No race to show"
          description="This link is missing its race id. Find your race in My Races, or join with a code."
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
        📶 Disconnected — Playing offline. {queuedCount > 0 ? `${queuedCount} submission${queuedCount === 1 ? '' : 's'} pending sync.` : 'Actions will be queued locally until signal returns.'}
      </Toast>
    );
  }

  if (updateAvailable && !activeChallenge) {
    banners.push(
      <Toast key="update" tone="gold">
        <span>⬇️ A new version is ready.</span>
        <Button variant="primary" size="sm" onClick={() => updateManager.applyUpdate()}>
          Reload now
        </Button>
      </Toast>
    );
  }

  if (syncState === 'syncing') {
    banners.push(
      <Toast key="syncing" tone="moss">
        ⚡ Network Restored — Syncing queued offline actions to the server...
      </Toast>
    );
  }

  const fullBleed = view === 'host';

  return (
    <div className={`app-shell${showSwitcher ? ' app-shell--navved' : ''}`}>
      <TopBar
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <BrandLines size={24} />
            <span className="t-announce fs-7" style={{ letterSpacing: '0.04em', color: 'var(--ink-strong)' }}>
              RUNWAY
            </span>
          </div>
        }
        subtitle={gameState.boardName || undefined}
        actions={
          <>
            {/* Desktop switcher. Below 768px it hides and the BottomNav below
                takes over. */}
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
            <MapCore interactive={true} playerLocation={playerLocation} activeTeamId={session?.teamId} />
            {banners.length > 0 && <div className="toast-stack">{banners}</div>}
          </div>
        )}

        {view === 'host' && hostSession && (
          <HostToolsPanel gameId={gameId} hostToken={hostSession.hostToken} gameState={gameState} onToast={pushToast} />
        )}

        {view === 'play' && session && (
          activeChallenge ? (
            <CaptureFlow
              mode={activeChallenge.mode}
              waypointId={activeChallenge.waypointId}
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
              session={session}
              onLeave={handleLeaveTeam}
              onEndRun={solo && hostSession ? handleEndRun : undefined}
              onStartChallenge={(waypointId, prompt, rubric, challengeId) => setActiveChallenge({ waypointId, challengeId, prompt, rubric })}
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

      {toasts.length > 0 && (
        <div className="host-console__toasts">
          {toasts.map((t) => (
            <Toast key={t.id} tone={t.tone}>
              {t.text}
            </Toast>
          ))}
        </div>
      )}

      {/* Mobile switcher — hidden at 768px and up, where the Tabs take over,
          and absent entirely when there is nothing to switch between. */}
      {showSwitcher && (
        <BottomNav
          slots={destinations.map((d) => ({
            ...d,
            active: view === d.id,
            onClick: () => setView(d.id),
          }))}
        />
      )}
    </div>
  );
};

export default RaceShell;
