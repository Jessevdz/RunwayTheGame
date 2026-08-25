import React, { useEffect, useState } from 'react';
import type { GameState } from '../../core/projection/projectionStore';
import type { TeamSession } from '../../core/game/teamSession';
import { postLeaderboardTime, getBoardLeaderboard, type LeaderboardEntry } from '../../core/api/client';
import { formatClock } from '../../core/format/clock';
import { Button, Notice, Stat, Badge } from '@ds';

interface SoloFinishProps {
  session: TeamSession;
  gameState: GameState;
  /** The run's time as the projection reports it, penalties included. */
  elapsedSeconds: number;
  timeTrial: boolean;
}

/** Post-race summary and leaderboard submission card for solo runs. */
export const SoloFinish: React.FC<SoloFinishProps> = ({ session, gameState, elapsedSeconds, timeTrial }) => {
  const [decision, setDecision] = useState<'undecided' | 'posted' | 'declined'>('undecided');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [myRunId, setMyRunId] = useState<string | null>(null);

  const { vetoCount, timePenaltySeconds } = gameState.clock;
  const walkingSeconds = Math.max(0, elapsedSeconds - timePenaltySeconds);
  const boardId = gameState.boardId;

  // A casual walk has no board to appear on, so it never asks and never fetches.
  const showBoard = timeTrial && !!boardId && decision !== 'undecided';

  useEffect(() => {
    if (!showBoard || !boardId) return;
    let cancelled = false;
    getBoardLeaderboard(boardId, 25)
      .then((res) => {
        if (!cancelled) setEntries(res.entries);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showBoard, boardId, decision]);

  const handlePost = async () => {
    if (!gameState.gameId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postLeaderboardTime(gameState.gameId, session.teamToken);
      setMyRunId(res.run.run_id);
      setDecision('posted');
    } catch (err: any) {
      setError(err?.message || 'Could not post your time');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="player-more__sec">
      <h3 className="player-more__title">{timeTrial ? 'Your time' : 'Your walk'}</h3>

      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
        <Stat label={timeTrial ? 'Final time' : 'On the route'} value={formatClock(elapsedSeconds)} tone="bright" />
        {timeTrial && timePenaltySeconds > 0 && (
          <>
            <Stat label="Walking" value={formatClock(walkingSeconds)} />
            <Stat
              label="Penalties"
              value={`+${formatClock(timePenaltySeconds)}`}
              hint={`${vetoCount} ${vetoCount === 1 ? 'veto' : 'vetoes'}`}
            />
          </>
        )}
        {(!timeTrial || timePenaltySeconds === 0) && vetoCount > 0 && (
          <Stat label="Skipped" value={vetoCount} hint={vetoCount === 1 ? 'challenge' : 'challenges'} />
        )}
      </div>

      {error && (
        <Notice kind="stop" title="That didn't go through" style={{ marginBottom: 'var(--sp-3)' }}>
          {error}
        </Notice>
      )}

      {timeTrial && decision === 'undecided' && (
        <>
          <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--sp-3)' }}>
            Put this on {gameState.boardName || 'the board'}'s leaderboard as{' '}
            <b>{gameState.teams[session.teamId]?.name || session.teamName}</b>? It stays there after the run
            is gone.
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <Button variant="primary" size="sm" icon="🏆" disabled={busy} onClick={handlePost}>
              {busy ? 'Posting…' : 'Post to the leaderboard'}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDecision('declined')}>
              Don't post
            </Button>
          </div>
        </>
      )}

      {timeTrial && decision === 'posted' && (
        <Notice kind="info" title="Posted" style={{ marginBottom: 'var(--sp-3)' }}>
          Your time is on the board.
        </Notice>
      )}

      {timeTrial && decision === 'declined' && (
        <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--sp-3)' }}>
          Not posted. Here is how the board stands anyway.
        </p>
      )}

      {showBoard && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <h4 className="t-label fs-label" style={{ marginBottom: 'var(--sp-2)' }}>
            BOARD LEADERBOARD
          </h4>
          {entries === null ? (
            <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: 0 }}>
              Loading times…
            </p>
          ) : entries.length === 0 ? (
            <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: 0 }}>
              No times recorded on this board yet.
            </p>
          ) : (
            <ol className="player-standings">
              {entries.map((entry) => (
                <li
                  key={entry.run_id}
                  className={`player-standing${entry.run_id === myRunId ? ' player-standing--mine' : ''}`}
                >
                  <span className="player-standing__rank">{entry.rank}</span>
                  <span className="player-standing__name">
                    {entry.runner_name}
                    {/* A run whose photos nothing checked is a real walk and
                        belongs on the board — but it is not the same claim as a
                        graded one, and a table that rendered them identically
                        would be asserting that it was. */}
                    {entry.verification === 'trust' && (
                      <span
                        className="t-data fs-2"
                        style={{ marginLeft: 'var(--sp-2)', color: 'var(--ink-muted)' }}
                        title="Honour system — no photo on this run was checked."
                      >
                        UNTESTED
                      </span>
                    )}
                  </span>
                  <span className="player-standing__meta">
                    {formatClock(entry.elapsed_seconds)}
                    {entry.veto_count > 0 && ` · ${entry.veto_count} skipped`}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {/* A board that has been re-published is still the same walk, so times
              from every version are ranked together — but a route that changed
              under a time is worth saying out loud. */}
          {entries && entries.length > 0 && (
            <p className="fs-5" style={{ color: 'var(--ink-muted)', marginTop: 'var(--sp-2)' }}>
              <Badge tone="gold">NOTE</Badge> Times are ranked across every version of this map.
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default SoloFinish;
