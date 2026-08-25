import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createSoloRun,
  getBoardLeaderboard,
  publishBoard,
  getServerConfig,
  ApiError,
  type BoardSummary,
  type SoloMode,
  type SoloVerificationMode
} from '../../core/api/client';
import { listRaceableBoards } from '../../core/game/boardCatalog';
import { saveHostSession } from '../../core/game/hostSession';
import { saveTeamSession } from '../../core/game/teamSession';
import { loadPlayerName, savePlayerName } from '../../core/game/playerIdentity';
import { rememberRace } from '../../core/game/raceSession';
import { getEditToken } from '../../core/game/mapSession';
import { formatClock } from '../../core/format/clock';
import { HostMapCard } from '../host/components/HostMapCard';
import { BoardFilterBar } from '../shared/BoardFilterBar';
import { useBoardFilters } from '../shared/boardFilters';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { ChoiceCards } from '../shared/ChoiceCards';
import { Button, Empty, Input, BrandLines, ArcMark } from '@ds';

const MODES: Array<{ id: SoloMode; title: string; blurb: string }> = [
  {
    id: 'solo_time_trial',
    title: 'Time trial',
    blurb: 'Your time is measured from the start line, veto’ing a challenge costs time, and a finished run can go on the board’s leaderboard.'
  },
  {
    id: 'solo_casual',
    title: 'Casual',
    blurb: 'Just enjoy the walk. Skip whatever you feel like skipping. Nothing is timed and nothing is ranked.'
  }
];

// Solo run verification modes ('trust' or 'llm').
const GRADING: Array<{ id: SoloVerificationMode; title: string; blurb: string }> = [
  {
    id: 'trust',
    title: 'Honour system',
    blurb:
      'Photos are accepted straight away and nothing grades them. They are still saved to look back at. A time set this way is marked as untested on the leaderboard.'
  },
  {
    id: 'llm',
    title: 'AI referee',
    blurb:
      'Your photos are sent to a third-party AI service and graded against each challenge’s criteria. Nobody has to be waiting at home to referee.'
  }
];

/** Solo run launcher surface component. */
export const SoloLauncher: React.FC = () => {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [records, setRecords] = useState<Record<string, { seconds: number; name: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [mode, setMode] = useState<SoloMode>('solo_time_trial');
  // The honour system is the default here for the same reason as the hosted
  // launcher: nothing outside the run has to exist for it to work.
  const [verification, setVerification] = useState<SoloVerificationMode>('trust');
  // Withheld until the server says an AI backend is configured — see PlayLauncher.
  const [aiReferee, setAiReferee] = useState(false);
  // The same name a team race puts in the lobby roster — asked for once, on
  // whichever surface gets there first. See core/game/playerIdentity.
  const [runnerName, setRunnerName] = useState<string>(() => loadPlayerName());
  const { filters, setFilters, reset, counts, visible, narrowed } = useBoardFilters(boards);
  const grading = GRADING.filter((option) => option.id !== 'llm' || aiReferee);

  useEffect(() => {
    fetchBoards();
    getServerConfig()
      .then((config) => setAiReferee(config.ai_referee))
      .catch(() => setAiReferee(false));
  }, []);

  const fetchBoards = async () => {
    setLoading(true);
    setError(null);
    try {
      // The gallery plus this device's own unpublished maps — see PlayLauncher.
      const list = await listRaceableBoards();
      setBoards(list);
      loadRecords(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load maps');
    } finally {
      setLoading(false);
    }
  };

  const loadRecords = async (list: BoardSummary[]) => {
    const results = await Promise.allSettled(list.map((b) => getBoardLeaderboard(b.id, 1)));
    const next: Record<string, { seconds: number; name: string }> = {};
    results.forEach((result, i) => {
      if (result.status !== 'fulfilled') return;
      const best = result.value.entries[0];
      if (best) next[list[i].id] = { seconds: best.elapsed_seconds, name: best.runner_name };
    });
    setRecords(next);
  };

  const startRun = async (board: BoardSummary) => {
    const run = await createSoloRun({
      board_id: board.id,
      board_version: 1,
      mode,
      runner_name: runnerName.trim() || 'Runner',
      ruleset: { verification: mode === 'solo_casual' ? 'trust' : verification }
    });

    saveHostSession({ gameId: run.game_id, hostToken: run.host_token });
    saveTeamSession({
      gameId: run.game_id,
      teamId: run.team_id,
      teamToken: run.join_token,
      teamName: run.team_name,
      slotIndex: 0,
      homeWaypointId: null,
      joinCode: run.join_code
    });
    rememberRace({
      gameId: run.game_id,
      raceCode: run.race_code,
      boardName: board.name,
      status: 'live',
      mode: run.mode
    });
    return run;
  };

  const handleStart = async (boardId: string) => {
    const board = boards.find((b) => b.id === boardId);
    if (!board) return;
    setStartingId(boardId);
    setError(null);
    try {
      let run;
      try {
        run = await startRun(board);
      } catch (err) {
        // Fallback: publish board if unpublished.
        if (err instanceof ApiError && err.status === 400 && /published/i.test(err.message)) {
          const editToken = getEditToken(boardId);
          if (!editToken) {
            throw new Error("This map hasn't been published yet, and only the device that made it can publish it.");
          }
          try {
            await publishBoard(boardId, editToken);
          } catch (pubErr: any) {
            throw new Error(
              `This map can't be run yet — it failed to publish: ${pubErr.message || 'validation error'}`
            );
          }
          run = await startRun(board);
        } else {
          throw err;
        }
      }
      savePlayerName(runnerName);
      // No lobby. The clock is already running, so the console is the next thing
      // this device should be looking at.
      navigate(`/race/${run.game_id}?view=play`);
    } catch (err: any) {
      setError(err.message || 'Failed to start a run on this map');
      setStartingId(null);
    }
  };

  return (
    <PageShell
      navPlacement="topbar"
      topBarProps={{
        title: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <BrandLines size={24} />
            <span className="t-announce fs-7" style={{ letterSpacing: '0.04em', color: 'var(--ink-strong)' }}>
              RUNWAY
            </span>
          </div>
        ),
      }}
      loading={loading}
      error={error}
      onRetry={fetchBoards}
    >
      <section style={{ maxWidth: '62.5rem', margin: '0 auto var(--sp-7)' }}>
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <h1 className="t-announce fs-d-md" style={{ color: 'var(--ink-strong)' }}>
            SOLO RACE
          </h1>
        </div>
        {/* The mode decides what a veto costs, so it is chosen before a map and
            not buried in a card. */}
        <ChoiceCards legend="HOW YOU'RE RUNNING IT" options={MODES} value={mode} onChange={setMode} />

        {/* And who — or what — looks at the photos, which is the decision a
            runner is entitled to make before the first waypoint rather than
            discover at it. Casual runs have no referee, and a server with no AI
            backend leaves only the honour system — a row of one card is not a
            choice, so the notice below carries that on its own. */}
        {mode !== 'solo_casual' && grading.length > 1 && (
          <ChoiceCards legend="WHO CHECKS YOUR PHOTOS" options={grading} value={verification} onChange={setVerification} />
        )}

        <div style={{ maxWidth: 'var(--wrap-narrow)', marginBottom: 'var(--sp-5)' }}>
          <Input
            label="YOUR NAME"
            placeholder="Runner"
            value={runnerName}
            onChange={(e) => setRunnerName(e.target.value)}
          />
        </div>

        {/* Everything above is how the run is set up; everything below is which
            run it is. The Sunset Arc is the design system's divider for exactly
            that kind of section break, and on a phone — where the two halves
            arrive one after the other with no side-by-side context — it is the
            only thing saying the configuring is done. */}
        <div className="section-break">
          <ArcMark animate={false} />
          <div className="section-break__head">
            <h2 className="t-announce fs-6" style={{ color: 'var(--ink-strong)' }}>
              CHOOSE A MAP
            </h2>
          </div>
        </div>

        {boards.length === 0 ? (
          <Empty
            icon="🥾"
            title="No maps ready to run"
            description="A run needs a published map. Design a route of your own, or fork one from the public gallery to get going."
            action={
              <Button variant="primary" icon="🗺️" onClick={() => navigate('/design')}>
                Design a Map
              </Button>
            }
          />
        ) : (
          <>
            <BoardFilterBar
              filters={filters}
              onChange={setFilters}
              counts={counts}
              shown={visible.length}
              total={boards.length}
              narrowed={narrowed}
            />

            {visible.length === 0 ? (
              <Empty
                icon="🔍"
                title="No maps match"
                description="Nothing fits that search and length. Widen the band or clear the search to see every map you can run."
                action={
                  <Button variant="secondary" onClick={reset}>
                    Reset Filters
                  </Button>
                }
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))', gap: 'var(--sp-5)' }}>
                {visible.map((board) => {
                  const record = records[board.id];
                  return (
                    <HostMapCard
                      key={board.id}
                      board={board}
                      onView={(id) => navigate(`/design/${id}`)}
                      onHost={handleStart}
                      isHosting={startingId === board.id}
                      disabled={startingId !== null}
                      actionLabel="Run it"
                      busyLabel="Starting…"
                      meta={
                        <span className="t-data fs-2" style={{ color: 'var(--ink-muted)' }}>
                          {record
                            ? `RECORD ${formatClock(record.seconds)} · ${record.name}`
                            : 'NO RECORDED TIME YET'}
                        </span>
                      }
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <PageFooter />
    </PageShell>
  );
};

export default SoloLauncher;
