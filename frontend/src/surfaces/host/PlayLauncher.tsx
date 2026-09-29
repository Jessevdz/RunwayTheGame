import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGame, publishBoard, getServerConfig, ApiError } from '../../core/api/client';
import { analytics } from '../../core/analytics/analyticsClient';
import { listRaceableBoards } from '../../core/game/boardCatalog';
import type { BoardSummary, HostedMode, VerificationMode } from '../../core/api/client';
import { saveHostSession } from '../../core/game/hostSession';
import { rememberRace } from '../../core/game/raceSession';
import { getEditToken } from '../../core/game/mapSession';
import { useIsDesktop } from '../../core/ui/useIsDesktop';
import { plainError } from '../../core/ui/plainError';
import { HostMapCard } from './components/HostMapCard';
import { BoardFilterBar } from '../shared/BoardFilterBar';
import { useBoardFilters, boardTitle } from '../shared/boardFilters';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { ChoiceCards } from '../shared/ChoiceCards';
import { AlphaNotice } from '../shared/AlphaNotice';
import { Button, Empty, Notice, PageHeader, Icon } from '@ds';
import './host-console.css';

const GAME_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours

// Default hosted race mode selection ('team' mode).
const HOSTED_MODE: HostedMode = 'team';

// Verification modes available for photo grading.
const GRADING: Array<{ id: VerificationMode; title: string; blurb: string }> = [
  {
    id: 'trust',
    title: 'Honour system',
    blurb: 'Photos are accepted instantly and saved for later.'
  },
  {
    id: 'host',
    title: 'You referee',
    blurb: 'You approve or reject every photo, so you will not be racing.'
  },
  {
    id: 'llm',
    title: 'AI referee',
    blurb: 'A third-party AI grades each photo. Fastest, but photos leave this server.'
  }
];

export const PlayLauncher: React.FC = () => {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hostError, setHostError] = useState<{ boardId: string; message: string } | null>(null);
  const [hostingId, setHostingId] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(isDesktop);
  // The honour system is the default because it is the only mode that asks nothing of anyone outside the game.
  const [verification, setVerification] = useState<VerificationMode>('trust');
  // Off until the server says an AI referee is configured, including when that call fails.
  const [aiReferee, setAiReferee] = useState(false);
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
    } catch (err) {
      setLoadError(plainError(err, "The maps didn't load."));
    } finally {
      setLoading(false);
    }
  };

  const createGameFromBoard = async (board: BoardSummary) => {
    const now = new Date();
    const game = await createGame({
      board_id: board.id,
      board_version: 1,
      starts_at: now.toISOString(),
      ends_at: new Date(now.getTime() + GAME_DURATION_MS).toISOString(),
      mode: HOSTED_MODE,
      ruleset: { verification }
    });
    // The host token is returned once, so it is saved before anything else can fail.
    saveHostSession({ gameId: game.id, hostToken: game.host_token });
    // Indexes the created race locally with board metadata for quick lookup and routing.
    rememberRace({
      gameId: game.id,
      raceCode: game.race_code,
      boardName: board.name,
      status: 'draft',
      mode: HOSTED_MODE
    });
    analytics.track('board.race_launched', { mode: HOSTED_MODE });
    return game;
  };

  const handleHost = async (boardId: string) => {
    const board = boards.find((b) => b.id === boardId);
    if (!board) return;
    setHostingId(boardId);
    setHostError(null);
    try {
      let game;
      try {
        game = await createGameFromBoard(board);
      } catch (err) {
        if (err instanceof ApiError && err.status === 400 && /published/i.test(err.message)) {
          // Only the device that made the map holds its edit token.
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
          game = await createGameFromBoard(board);
        } else {
          throw err;
        }
      }
      navigate(`/host/${game.id}`);
    } catch (err) {
      setHostError({ boardId, message: plainError(err, 'Something went wrong starting the race.') });
      setHostingId(null);
    }
  };

  const failedBoard = hostError ? boards.find((b) => b.id === hostError.boardId) : undefined;

  return (
    <PageShell navPlacement="topbar" topBarProps={{}} loading={loading}>
      <section className="launcher-section">
        <PageHeader title="PICK A MAP TO RACE" />

        <p className="fs-5 launcher-intro">
          First team to the finish wins. Coins buy power-ups to slow the others.
          You get an invite link to share once you pick a map.
        </p>

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

        {hostError && (
          <Notice
            kind="stop"
            title={failedBoard ? `Couldn't start a race on ${boardTitle(failedBoard)}` : "Couldn't start the race"}
            className="launcher-error"
          >
            {hostError.message}
            <div className="launcher-error__actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={hostingId !== null}
                onClick={() => handleHost(hostError.boardId)}
              >
                Try again
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHostError(null)}>
                Dismiss
              </Button>
            </div>
          </Notice>
        )}

        {/* Who referees cannot change once teams are walking, so it is chosen before a race starts. */}
        <details
          className="launcher-options"
          open={optionsOpen}
          onToggle={(e) => setOptionsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <span className="fs-5">
              <strong>Who referees:</strong> {grading.find((option) => option.id === verification)?.title}
            </span>
            <span className="t-label fs-label">{optionsOpen ? 'HIDE' : 'CHANGE'}</span>
          </summary>
          <div className="launcher-options__body">
            <ChoiceCards legend="WHO REFEREES" options={grading} value={verification} onChange={setVerification} />
          </div>
        </details>

        {boards.length === 0 ? (
          !loadError && (
            <Empty
              icon={<Icon name="flag" />}
              title="No maps ready to race"
              description={isDesktop ? 'Design a map or fork one from the gallery.' : 'Pick a map from the gallery to race on.'}
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
                {visible.map((board) => (
                  <HostMapCard
                    key={board.id}
                    board={board}
                    onView={isDesktop ? (id) => navigate(`/design/${id}`) : undefined}
                    onHost={handleHost}
                    isHosting={hostingId === board.id}
                    disabled={hostingId !== null}
                    actionLabel={isDesktop ? 'Host' : 'Race this map'}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <AlphaNotice />
      </section>

      <PageFooter />
    </PageShell>
  );
};
