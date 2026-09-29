import React, { useEffect, useRef, useState } from 'react';
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
import { analytics } from '../../core/analytics/analyticsClient';
import { listRaceableBoards } from '../../core/game/boardCatalog';
import { saveHostSession } from '../../core/game/hostSession';
import { saveTeamSession } from '../../core/game/teamSession';
import { loadPlayerName, savePlayerName } from '../../core/game/playerIdentity';
import { rememberRace } from '../../core/game/raceSession';
import { getEditToken } from '../../core/game/mapSession';
import { generateUUID } from '../../core/util/uuid';
import { formatClock } from '../../core/format/clock';
import { HostMapCard } from '../host/components/HostMapCard';
import { BoardFilterBar } from '../shared/BoardFilterBar';
import { useBoardFilters, boardTitle } from '../shared/boardFilters';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { ChoiceCards } from '../shared/ChoiceCards';
import { useIsDesktop } from '../../core/ui/useIsDesktop';
import { plainError } from '../../core/ui/plainError';
import { Button, Empty, Input, Notice, PageHeader, Icon } from '@ds';
import '../host/host-console.css';

const MODES: Array<{ id: SoloMode; title: string; blurb: string }> = [
  {
    id: 'solo_time_trial',
    title: 'Time trial',
    blurb: 'Timed from the start. Skipping a challenge adds time. Finished runs can join the leaderboard.'
  },
  {
    id: 'solo_casual',
    title: 'Casual',
    blurb: 'Untimed and unranked. Skip anything you like.'
  }
];

// Solo run verification modes ('trust' or 'llm').
const GRADING: Array<{ id: SoloVerificationMode; title: string; blurb: string }> = [
  {
    id: 'trust',
    title: 'Honour system',
    blurb: 'Photos are accepted instantly and saved. Leaderboard times are marked untested.'
  },
  {
    id: 'llm',
    title: 'AI referee',
    blurb: 'A third-party AI grades each photo, so photos leave this server.'
  }
];

/** Solo run launcher surface component. */
export const SoloLauncher: React.FC = () => {
  const navigate = useNavigate();
  const soloCreateAttempt = useRef<{ signature: string; key: string } | null>(null);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [records, setRecords] = useState<Record<string, { seconds: number; name: string }>>({});
  const [loading, setLoading] = useState(true);
  const isDesktop = useIsDesktop();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startError, setStartError] = useState<{ boardId: string; message: string } | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(isDesktop);
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
    setLoadError(null);
    try {
      // The list is the gallery plus this device's own unpublished maps.
      const list = await listRaceableBoards();
      setBoards(list);
      loadRecords(list);
    } catch (err) {
      setLoadError(plainError(err, "The maps didn't load."));
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
    const payload = {
      board_id: board.id,
      board_version: 1,
      mode,
      runner_name: runnerName.trim() || 'Runner',
      ruleset: { verification: mode === 'solo_casual' ? 'trust' : verification }
    };
    const signature = JSON.stringify(payload);
    if (!soloCreateAttempt.current || soloCreateAttempt.current.signature !== signature) {
      soloCreateAttempt.current = { signature, key: generateUUID() };
    }
    const run = await createSoloRun({
      ...payload,
      idempotency_key: soloCreateAttempt.current.key
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
    analytics.track('board.race_launched', { mode: run.mode });
    soloCreateAttempt.current = null;
    return run;
  };

  const handleStart = async (boardId: string) => {
    const board = boards.find((b) => b.id === boardId);
    if (!board) return;
    setStartingId(boardId);
    setStartError(null);
    try {
      let run;
      try {
        run = await startRun(board);
      } catch (err) {
        // Fallback: publish board if unpublished.
        if (err instanceof ApiError && err.status === 400 && /published/i.test(err.message)) {
          const editToken = getEditToken(boardId);
          if (!editToken) {
            throw new Error("This map isn't published, and only the device that made it can publish it.");
          }
          try {
            await publishBoard(boardId, editToken);
            analytics.track('board.published', { result: 'ok' });
          } catch (pubErr) {
            analytics.track('board.published', { result: 'rejected' });
            throw new Error(`Publishing failed: ${plainError(pubErr, 'the map did not pass validation.')}`);
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
    } catch (err) {
      setStartError({ boardId, message: plainError(err, 'Something went wrong starting the run.') });
      setStartingId(null);
    }
  };

  return (
    <PageShell
      navPlacement="topbar"
      topBarProps={{}}
      loading={loading}
    >
      <section className="launcher-section">
        <PageHeader title="SOLO RACE" />

        {loadError && (
          <Notice kind="stop" title="Couldn't load the maps" className="launcher-error">
            {loadError}
            <div className="launcher-error__actions">
              <Button variant="secondary" size="sm" onClick={fetchBoards}>
                Try again
              </Button>
            </div>
          </Notice>
        )}

        {startError && (
          <Notice
            kind="stop"
            title={
              boards.find((b) => b.id === startError.boardId)
                ? `Couldn't start a run on ${boardTitle(boards.find((b) => b.id === startError.boardId)!)}`
                : "Couldn't start the run"
            }
            className="launcher-error"
          >
            {startError.message}
            <div className="launcher-error__actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={startingId !== null}
                onClick={() => handleStart(startError.boardId)}
              >
                Try again
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStartError(null)}>
                Dismiss
              </Button>
            </div>
          </Notice>
        )}

        {/* Mode, referee and name are one compact row so the maps start straight away. */}
        <details
          className="launcher-options"
          open={optionsOpen}
          onToggle={(e) => setOptionsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <span className="fs-5">
              <strong>Your run:</strong> {MODES.find((option) => option.id === mode)?.title}
              {runnerName.trim() ? ` · ${runnerName.trim()}` : ''}
            </span>
            <span className="t-label fs-label">{optionsOpen ? 'HIDE' : 'CHANGE'}</span>
          </summary>
          <div className="launcher-options__body">
            <ChoiceCards legend="HOW YOU'RE RUNNING IT" options={MODES} value={mode} onChange={setMode} />

            {/* Casual runs have no referee, and a server with no AI backend leaves only the honour system. */}
            {mode !== 'solo_casual' && grading.length > 1 && (
              <ChoiceCards legend="WHO CHECKS YOUR PHOTOS" options={grading} value={verification} onChange={setVerification} />
            )}

            <div className="launcher-name">
              <Input
                label="YOUR NAME"
                placeholder="Runner"
                value={runnerName}
                onChange={(e) => setRunnerName(e.target.value)}
              />
            </div>
          </div>
        </details>

        {boards.length === 0 ? (
          !loadError && (
            <Empty
              icon={<Icon name="route" />}
              title="No maps ready to run"
              description={isDesktop ? 'Design a map or fork one from the gallery.' : 'Pick a map from the gallery to run.'}
              action={
                isDesktop ? (
                  <Button variant="primary" icon={<Icon name="map" />} onClick={() => navigate('/design')}>
                    Design a Map
                  </Button>
                ) : (
                  <Button variant="primary" icon={<Icon name="target" />} onClick={() => navigate('/gallery')}>
                    Browse the Gallery
                  </Button>
                )
              }
            />
          )
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
                icon={<Icon name="search" />}
                title="No maps match"
                description="Try a different search or length."
                action={
                  <Button variant="secondary" onClick={reset}>
                    Reset Filters
                  </Button>
                }
              />
            ) : (
              <div className="launcher-grid">
                {visible.map((board) => {
                  const record = records[board.id];
                  return (
                    <HostMapCard
                      key={board.id}
                      board={board}
                      onView={isDesktop ? (id) => navigate(`/design/${id}`) : undefined}
                      onHost={handleStart}
                      isHosting={startingId === board.id}
                      disabled={startingId !== null}
                      actionLabel={isDesktop ? 'Run it' : 'Run this map'}
                      busyLabel="Starting…"
                      meta={
                        <span className="t-data fs-2" style={{ color: 'var(--ink-muted)' }}>
                          {record
                            ? `RECORD ${formatClock(record.seconds)} · ${record.name}`
                            : 'NO RECORD YET'}
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
