import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listBoards, forkBoard } from '../../core/api/client';
import type { BoardSummary } from '../../core/api/client';
import { saveMyMap } from '../../core/game/mapSession';
import { GalleryCard } from './components/GalleryCard';
import { BoardFilterBar } from '../shared/BoardFilterBar';
import { useBoardFilters } from '../shared/boardFilters';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { Button, Empty, PageHeader, showToast, Icon } from '@ds';
import { useIsDesktop } from '../../core/ui/useIsDesktop';
import { plainError } from '../../core/ui/plainError';
import { hostBoardRace } from './hostBoard';

export const GalleryPage: React.FC = () => {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [forkingId, setForkingId] = useState<string | null>(null);
  const [hostingId, setHostingId] = useState<string | null>(null);
  const { filters, setFilters, reset, counts, visible, narrowed } = useBoardFilters(boards);

  useEffect(() => {
    fetchBoards();
  }, []);

  const fetchBoards = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listBoards();
      setBoards(list);
    } catch (err: any) {
      setError(plainError(err, "We couldn't load the gallery. Try again in a moment."));
    } finally {
      setLoading(false);
    }
  };

  const handleView = (id: string) => {
    navigate(`/design/${id}`);
  };

  const handleFork = async (id: string) => {
    setForkingId(id);
    try {
      const res = await forkBoard(id);
      saveMyMap({ mapId: res.id, editToken: res.edit_token, name: res.name });
      navigate(`/design/${res.id}`);
    } catch (err: any) {
      showToast(plainError(err, "Couldn't copy that map. Try again."), { tone: 'crimson' });
    } finally {
      setForkingId(null);
    }
  };

  const handleRace = async (id: string) => {
    const board = boards.find((b) => b.id === id);
    if (!board) return;
    setHostingId(id);
    try {
      navigate(`/host/${await hostBoardRace(board)}`);
    } catch (err) {
      showToast(plainError(err, "Couldn't start a race on that map. Try again."), { tone: 'crimson' });
      setHostingId(null);
    }
  };

  return (
    <PageShell
      navPlacement="topbar"
      loading={loading}
      error={error}
      onRetry={fetchBoards}
    >
      <section style={{ maxWidth: '62.5rem', margin: '0 auto var(--sp-7)' }}>
        <PageHeader title="GALLERY" />

        {boards.length === 0 ? (
          <Empty
            icon={<Icon name="target" />}
            title="No public maps yet"
            description="Design a map and publish it to be the first."
            action={
              <Button variant="primary" icon={<Icon name="map" />} onClick={() => navigate('/design')}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(18rem, 100%), 1fr))', gap: 'var(--sp-5)' }}>
                {visible.map((board) => (
                  <GalleryCard
                    key={board.id}
                    board={board}
                    onView={handleView}
                    onFork={handleFork}
                    onRace={handleRace}
                    phone={!isDesktop}
                    isForking={forkingId === board.id}
                    isHosting={hostingId === board.id}
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
