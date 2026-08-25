import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGame, publishBoard, getServerConfig, ApiError } from '../../core/api/client';
import { listRaceableBoards } from '../../core/game/boardCatalog';
import type { BoardSummary, HostedMode, VerificationMode } from '../../core/api/client';
import { saveHostSession } from '../../core/game/hostSession';
import { rememberRace } from '../../core/game/raceSession';
import { getEditToken } from '../../core/game/mapSession';
import { HostMapCard } from './components/HostMapCard';
import { BoardFilterBar } from '../shared/BoardFilterBar';
import { useBoardFilters } from '../shared/boardFilters';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { ChoiceCards } from '../shared/ChoiceCards';
import { AlphaNotice } from '../shared/AlphaNotice';
import { Button, Empty, BrandLines } from '@ds';

const GAME_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours

// Default hosted race mode selection ('team' mode).
const HOSTED_MODE: HostedMode = 'team';

// Verification modes available for photo grading.
const GRADING: Array<{ id: VerificationMode; title: string; blurb: string }> = [
  {
    id: 'trust',
    title: 'Honour system',
    blurb:
      'Photos are accepted straight away and nothing grades them. They are still saved, so you can all look back at them afterwards.'
  },
  {
    id: 'host',
    title: 'You referee',
    blurb:
      'Every photo comes to you to approve or reject, with the criteria beside it. Nothing leaves this server. You will be grading rather than racing.'
  },
  {
    id: 'llm',
    title: 'AI referee',
    blurb:
      'Photos are sent to a third-party AI service and graded against each challenge’s criteria. Fastest, and nobody has to referee — but the photos leave this server.'
  }
];

export const PlayLauncher: React.FC = () => {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [hostingId, setHostingId] = useState<string | null>(null);
  // The honour system is the default: it is the only mode that asks nothing of
  // anyone outside the game, and it is the one every deployment can honour. The
  // cards say what the other two cost and a host picks knowingly.
  const [verification, setVerification] = useState<VerificationMode>('trust');
  // Off until the server says otherwise. A referee that was never configured
  // would leave every photo pending until the race timed out, so the card is
  // withheld rather than offered hopefully — including when the call fails.
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
    setError(null);
    try {
      // The gallery plus this device's own unpublished maps: a route you saved
      // for tonight is raceable whether or not you put it in front of strangers.
      const list = await listRaceableBoards();
      setBoards(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load maps');
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
    // The server returns the host token once and keeps only its hash, so it has
    // to be persisted here — before anything else can fail — or this browser
    // loses the ability to start or end the race it just created.
    saveHostSession({ gameId: game.id, hostToken: game.host_token });
    // Indexes the created race locally with board metadata for quick lookup and routing.
    rememberRace({
      gameId: game.id,
      raceCode: game.race_code,
      boardName: board.name,
      status: 'draft',
      mode: HOSTED_MODE
    });
    return game;
  };

  const handleHost = async (boardId: string) => {
    const board = boards.find((b) => b.id === boardId);
    if (!board) return;
    setHostingId(boardId);
    setError(null);
    try {
      let game;
      try {
        game = await createGameFromBoard(board);
      } catch (err) {
        if (err instanceof ApiError && err.status === 400 && /published/i.test(err.message)) {
          // Only the device that made the map holds its edit token, so only
          // that device can publish it on the way into a race.
          const editToken = getEditToken(boardId);
          if (!editToken) {
            throw new Error("This map hasn't been published yet, and only the device that made it can publish it.");
          }
          try {
            await publishBoard(boardId, editToken);
          } catch (pubErr: any) {
            throw new Error(
              `This map can't be raced yet — it failed to publish: ${pubErr.message || 'validation error'}`
            );
          }
          game = await createGameFromBoard(board);
        } else {
          throw err;
        }
      }
      navigate(`/host/${game.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to start a race for this map');
      setHostingId(null);
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
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
          <div>
            <p className="t-label fs-label" style={{ marginBottom: 'var(--sp-1)' }}>
              HOST A RACE
            </p>
            <h1 className="t-announce fs-d-md" style={{ color: 'var(--ink-strong)' }}>
              PICK A MAP TO RACE
            </h1>
          </div>
          {boards.length > 0 && (
            <span className="t-data fs-2" style={{ letterSpacing: '.12em', color: 'var(--ink-muted)' }}>
              {boards.length} RACEABLE
            </span>
          )}
        </div>

        <p className="fs-5" style={{ color: 'var(--ink-muted)', maxWidth: 'var(--measure)', marginBottom: 'var(--sp-5)' }}>
          First team to the finish line wins, and coins buy power-ups to slow everyone else down.
          Hosting opens a lobby with an invite link to share with the other teams. Start the race once
          everyone has joined.
        </p>

        <AlphaNotice />

        {/* Who referees is the decision that cannot change once teams are
            walking — and the one every player is told about before they take a
            photo — so it is made before a map rather than buried in a card. */}
        <ChoiceCards legend="WHO REFEREES" options={grading} value={verification} onChange={setVerification} />

        {boards.length === 0 ? (
          <Empty
            icon="🏁"
            title="No maps ready to race"
            description="A race needs a published map. Design a route of your own, or fork one from the public gallery to get going."
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
                description="Nothing raceable fits that search and length. Widen the band or clear the search to see every map you can host."
                action={
                  <Button variant="secondary" onClick={reset}>
                    Reset Filters
                  </Button>
                }
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))', gap: 'var(--sp-5)' }}>
                {visible.map((board) => (
                  <HostMapCard
                    key={board.id}
                    board={board}
                    onView={(id) => navigate(`/design/${id}`)}
                    onHost={handleHost}
                    isHosting={hostingId === board.id}
                    disabled={hostingId !== null}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <PageFooter />
    </PageShell>
  );
};
