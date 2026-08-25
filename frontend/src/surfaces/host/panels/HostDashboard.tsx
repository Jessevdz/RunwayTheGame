import React, { useEffect, useMemo, useState } from 'react';
import { isCoinRush, type GameState } from '../../../core/projection/projectionStore';
import { watchPlayerLocation, type GPSPosition } from '../../../core/player/locationService';
import { MapCore } from '../../../core/map/MapCore';
import { endGame } from '../../../core/api/client';
import { slotColor, getNeutralColor } from '../../../core/team/palette';
import { Board, type BoardColumn, Card, Chip, Callout, Button, Dialog, Badge, IconCoin } from '@ds';
import type { ToastMessage } from '../HostToolsPanel';

interface HostDashboardProps {
  gameId: string;
  hostToken: string;
  gameState: GameState;
  onToast: (text: string, tone?: ToastMessage['tone']) => void;
  onOpenDisputes: () => void;
  /** Callback to open review queue tab for host verification. */
  onOpenReview?: () => void;
}

const isActive = (until?: string) => (until ? new Date(until).getTime() > Date.now() : false);

const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

interface StandingRow {
  teamId: string;
  teamName: string;
  waypointsReached: number;
  distanceToFinishM: number;
  coins: number;
  finished: boolean;
  /** Coin rush only; zero in every other mode, which records no placing but first. */
  finishRank: number;
  finishBonus: number;
}

/** "1st", "2nd", "3rd" — teens excepted (11th, not 11st). */
const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

export const HostDashboard: React.FC<HostDashboardProps> = ({ gameId, hostToken, gameState, onToast, onOpenDisputes, onOpenReview }) => {
  const [hostLocation, setHostLocation] = useState<GPSPosition | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const unsubscribe = watchPlayerLocation(setHostLocation, () => {});
    return unsubscribe;
  }, []);

  const totalWaypoints = gameState.waypoints.length;

  const pendingDisputes = useMemo(
    () => Object.values(gameState.disputes).filter((d) => d.status === 'pending'),
    [gameState.disputes]
  );

  const flaggedArrivals = useMemo(
    () => gameState.logs.filter((l) => l.includes('flagged for review')).slice(-5),
    [gameState.logs]
  );

  const pendingSubmissions = useMemo(
    () => Object.values(gameState.submissions).filter((s) => s.status === 'pending'),
    [gameState.submissions]
  );
  const oldestPendingMs = useMemo(() => {
    if (pendingSubmissions.length === 0) return 0;
    const oldest = pendingSubmissions.reduce((min, s) => Math.min(min, new Date(s.createdAt).getTime()), Date.now());
    return Date.now() - oldest;
  }, [pendingSubmissions]);

  const stuckTeams = useMemo(() => {
    const now = Date.now();
    return Object.entries(gameState.teams).filter(([teamId]) => {
      const pos = gameState.positions[teamId];
      if (!pos) return false;
      return now - new Date(pos.reportedAt).getTime() > STUCK_THRESHOLD_MS;
    });
  }, [gameState.teams, gameState.positions]);

  const coinRush = isCoinRush(gameState.mode);
  const countdownDeadline = coinRush ? gameState.coinRush?.deadline ?? null : null;

  const columns: BoardColumn<StandingRow>[] = [
    {
      key: 'team',
      header: 'Team',
      who: true,
      render: (row) => {
        const info = gameState.teams[row.teamId];
        const color = info ? slotColor(info.slotIndex).color : getNeutralColor().color;
        const effects = gameState.effects[row.teamId] || { curses: [] };
        return (
          <button
            type="button"
            className="host-dashboard__team-cell"
            title={`Open ${row.teamName}`}
            onClick={() => setSelectedTeamId(row.teamId)}
          >
            {/* The swatch and the name share a line. .board .who is itself a flex
                row, so leaving them as bare siblings of this column-flex button
                stacked the dot above the name. */}
            <span className="host-dashboard__team-id">
              <span className="game-pane__dot" style={{ backgroundColor: color }} />
              <span>{row.teamName}</span>
            </span>
            <div className="host-dashboard__team-tags">
              {isActive(effects.frozenUntil) && <Chip kind="curse">❄️ Frozen</Chip>}
              {isActive(effects.vetoPenaltyUntil) && <Chip kind="veto">⏳ Veto</Chip>}
              {isActive(effects.trackerOffUntil) && <Chip kind="power">👁️ Off-grid</Chip>}
              {effects.curses.length > 0 && <Chip kind="curse">💀 Cursed</Chip>}
              {row.finished && <Chip kind="power">🏁 {row.finishRank ? ordinal(row.finishRank) : 'Home'}</Chip>}
            </div>
          </button>
        );
      }
    },
    // Renders coins column in Coin Rush mode.
    ...(coinRush
      ? [
          {
            key: 'coins',
            header: 'Coins',
            numeric: true,
            render: (row: StandingRow) => (
              <>
                <div className="fs-5" style={{ fontWeight: 600 }}>
                  <IconCoin /> {row.coins}
                </div>
                {!!row.finishBonus && (
                  <div className="fs-2" style={{ color: 'var(--ink-muted)' }}>
                    incl. +{row.finishBonus} finish
                  </div>
                )}
              </>
            )
          } as BoardColumn<StandingRow>
        ]
      : []),
    {
      key: 'progress',
      header: 'Progress',
      numeric: true,
      render: (row) => (
        <>
          <div className="fs-5" style={{ fontWeight: 600 }}>
            {row.waypointsReached} / {totalWaypoints}
          </div>
          <div className="fs-2" style={{ color: 'var(--ink-muted)' }}>
            {coinRush ? '' : <><IconCoin /> {row.coins} · </>}
            {(row.distanceToFinishM / 1000).toFixed(1)} km
          </div>
        </>
      )
    }
  ];

  const rows: StandingRow[] = gameState.standings.map((s) => ({
    teamId: s.teamId,
    teamName: s.teamName,
    waypointsReached: s.waypointsReached,
    distanceToFinishM: s.distanceToFinishM,
    coins: s.coins,
    finished: s.finished,
    finishRank: s.finishRank,
    finishBonus: s.finishBonus
  }));

  const handleEndGame = async () => {
    setEnding(true);
    try {
      await endGame(gameId, hostToken);
      onToast('Race ended.', 'gold');
      setConfirmEnd(false);
    } catch (err: any) {
      onToast(err.message || 'Failed to end the race', 'crimson');
    } finally {
      setEnding(false);
    }
  };

  /** A waypoint id is a uuid to the host too. Name it where there is a name. */
  const waypointName = (id: string): string =>
    gameState.waypoints.find((w) => w.id === id)?.name || id;

  const selectedTeam = selectedTeamId ? gameState.teams[selectedTeamId] : null;
  const selectedInfo = selectedTeamId
    ? {
        progress: gameState.progress[selectedTeamId],
        effects: gameState.effects[selectedTeamId],
        inventory: gameState.inventory[selectedTeamId] || [],
        coins: gameState.coins[selectedTeamId] || 0,
        recentSubmissions: Object.values(gameState.submissions)
          .filter((s) => s.teamId === selectedTeamId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 3)
      }
    : null;

  const nothingPending =
    pendingDisputes.length === 0 &&
    flaggedArrivals.length === 0 &&
    pendingSubmissions.length === 0 &&
    stuckTeams.length === 0;

  return (
    <div className="host-dashboard">
      {/* What is waiting on the host comes before what the field is doing: this
          card is the job, the standings are the view. On a phone that ordering
          is the difference between seeing a dispute and scrolling past it. */}
      <section className="host-dashboard__primary">
        <Card className="card--pad">
          <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>
            NEEDS YOU
          </h2>
          {nothingPending ? (
            <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: 0 }}>All clear — nothing needs attention.</p>
          ) : (
            <div className="host-dashboard__alerts-list">
              {pendingDisputes.length > 0 && (
                <Callout kind="veto">
                  <div className="host-dashboard__alert">
                    <span>{pendingDisputes.length} dispute{pendingDisputes.length === 1 ? '' : 's'} awaiting a ruling</span>
                    <Button variant="secondary" size="sm" onClick={onOpenDisputes}>Rule on them</Button>
                  </div>
                </Callout>
              )}
              {pendingSubmissions.length > 0 && (
                <Callout kind="power">
                  <div className="host-dashboard__alert">
                    <span>
                      {pendingSubmissions.length} photo{pendingSubmissions.length === 1 ? '' : 's'} awaiting a verdict
                      {oldestPendingMs > 60000 && ` — oldest ${Math.round(oldestPendingMs / 60000)} min ago`}
                    </span>
                    {/* Only a host who is the referee can act on this; under the
                        AI referee it is a progress report, not a queue. */}
                    {onOpenReview && (
                      <Button variant="secondary" size="sm" onClick={onOpenReview}>Grade them</Button>
                    )}
                  </div>
                </Callout>
              )}
              {stuckTeams.length > 0 && (
                <Callout kind="curse">
                  No position in the last 10 minutes from{' '}
                  <strong>{stuckTeams.map(([, info]) => info.name).join(', ')}</strong>
                </Callout>
              )}
              {flaggedArrivals.map((line, i) => (
                <Callout key={i} kind="rule">{line}</Callout>
              ))}
            </div>
          )}
        </Card>

        <Card className="card--pad">
          <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>
            STANDINGS
          </h2>
          {/* Once a coin rush countdown is running the host's job changes: the
              race now ends on a clock nobody in it controls, and this is the
              only surface that can say when. */}
          {coinRush && countdownDeadline && gameState.state !== 'ended' && (
            <Callout kind="veto" style={{ marginBottom: 'var(--sp-3)' }}>
              Countdown running — the race is called at{' '}
              <strong>{new Date(countdownDeadline).toLocaleTimeString()}</strong>, and the most coins wins.
            </Callout>
          )}
          {rows.length > 0 ? (
            <div className="host-dashboard__standings">
              <Board columns={columns} rows={rows} rowKey={(row) => row.teamId} isLeader={(_, i) => i === 0} />
            </div>
          ) : (
            <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: 0 }}>No standings yet.</p>
          )}
          {rows.length > 0 && (
            <p className="fs-3" style={{ color: 'var(--ink-muted)', margin: 'var(--sp-3) 0 0' }}>
              Tap a team for its coins, effects, inventory and last submissions.
            </p>
          )}
        </Card>
      </section>

      <section className="host-dashboard__map">
        <MapCore interactive playerLocation={hostLocation} />
      </section>

      <section className="host-dashboard__control">
        <p className="fs-4">
          {gameState.state === 'ended'
            ? 'This race is over — the Recap tab has the result.'
            : 'Ending the race locks the standings for everyone and cannot be undone.'}
        </p>
        <Button variant="secondary" icon="🏁" onClick={() => setConfirmEnd(true)} disabled={gameState.state === 'ended'}>
          {gameState.state === 'ended' ? 'Race ended' : 'End the race'}
        </Button>
      </section>

      <Dialog open={confirmEnd} title="End the race?" onClose={() => setConfirmEnd(false)}>
        <p className="fs-5" style={{ color: 'var(--ink-muted)' }}>This cannot be undone. Standings will lock and the Recap tab will open.</p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end', marginTop: 'var(--sp-4)' }}>
          <Button variant="secondary" onClick={() => setConfirmEnd(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleEndGame} disabled={ending}>{ending ? 'Ending…' : 'End Game'}</Button>
        </div>
      </Dialog>

      <Dialog open={!!selectedTeamId} title={selectedTeam?.name || 'Team'} onClose={() => setSelectedTeamId(null)}>
        {selectedTeam && selectedInfo && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <div className="fs-5">
              <IconCoin /> {selectedInfo.coins} coins · currently at{' '}
              {selectedInfo.progress?.currentWaypointId ? waypointName(selectedInfo.progress.currentWaypointId) : 'unknown'}
            </div>
            <div>
              <div className="t-label fs-label" style={{ marginBottom: 'var(--sp-1)' }}>ACTIVE EFFECTS</div>
              <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                {isActive(selectedInfo.effects?.frozenUntil) && <Chip kind="curse">❄️ Frozen</Chip>}
                {isActive(selectedInfo.effects?.vetoPenaltyUntil) && <Chip kind="veto">⏳ Veto</Chip>}
                {isActive(selectedInfo.effects?.trackerOffUntil) && <Chip kind="power">👁️ Off-grid</Chip>}
                {(selectedInfo.effects?.curses.length || 0) > 0 && <Chip kind="curse">💀 Cursed</Chip>}
                {!isActive(selectedInfo.effects?.frozenUntil) &&
                  !isActive(selectedInfo.effects?.vetoPenaltyUntil) &&
                  !isActive(selectedInfo.effects?.trackerOffUntil) &&
                  (selectedInfo.effects?.curses.length || 0) === 0 && <span className="fs-4" style={{ color: 'var(--ink-muted)' }}>None</span>}
              </div>
            </div>
            <div>
              <div className="t-label fs-label" style={{ marginBottom: 'var(--sp-1)' }}>INVENTORY</div>
              <div className="fs-4">{selectedInfo.inventory.length > 0 ? selectedInfo.inventory.join(', ') : 'Empty'}</div>
            </div>
            <div>
              <div className="t-label fs-label" style={{ marginBottom: 'var(--sp-1)' }}>RECENT SUBMISSIONS</div>
              {selectedInfo.recentSubmissions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  {selectedInfo.recentSubmissions.map((s) => (
                    <div key={s.submissionId} className="fs-4" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', alignItems: 'center' }}>
                      <span>{waypointName(s.waypointId)}</span>
                      <Badge tone={s.status === 'pass' ? 'moss' : s.status === 'fail' ? 'crimson' : 'gold'}>{s.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="fs-4" style={{ color: 'var(--ink-muted)' }}>None yet</span>
              )}
            </div>
            <p className="fs-3" style={{ color: 'var(--ink-muted)', margin: 0 }}>
              To adjust coins, clear a challenge, or clear an effect for this team, use the Overrides tab.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
};
export default HostDashboard;
