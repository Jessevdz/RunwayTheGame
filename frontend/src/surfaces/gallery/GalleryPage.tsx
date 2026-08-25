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
import { Button, Empty, BrandLines } from '@ds';

export const GalleryPage: React.FC = () => {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [forkingId, setForkingId] = useState<string | null>(null);
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
      setError(err.message || 'Failed to load public gallery maps');
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
      alert(`Failed to fork map: ${err.message || 'Unknown error'}`);
    } finally {
      setForkingId(null);
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
              PUBLIC MAPS
            </p>
            <h1 className="t-announce fs-d-md" style={{ color: 'var(--ink-strong)' }}>
              GALLERY
            </h1>
          </div>
          {boards.length > 0 && (
            <span className="t-data fs-2" style={{ letterSpacing: '.12em', color: 'var(--ink-muted)' }}>
              {boards.length} PUBLISHED
            </span>
          )}
        </div>

        {boards.length === 0 ? (
          <Empty
            icon="🎯"
            title="No public maps yet"
            description="Nothing has been published to the gallery so far. Design a route race and share it to be the first."
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
                description="Nothing in the gallery fits that search and length. Widen the band or clear the search to see the rest."
                action={
                  <Button variant="secondary" onClick={reset}>
                    Reset Filters
                  </Button>
                }
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))', gap: 'var(--sp-5)' }}>
                {visible.map((board) => (
                  <GalleryCard
                    key={board.id}
                    board={board}
                    onView={handleView}
                    onFork={handleFork}
                    isForking={forkingId === board.id}
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
