import React, { useEffect, useState, useCallback } from 'react';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { Button, BrandLines, Notice } from '@ds';
import { RoadmapLane } from './components/RoadmapLane';
import { CreateItemDialog } from './components/CreateItemDialog';
import { EditItemDialog } from './components/EditItemDialog';
import {
  listRoadmapItems,
  createRoadmapItem,
  updateRoadmapItem,
  deleteRoadmapItem,
  voteRoadmapItem,
  unvoteRoadmapItem,
  flagRoadmapItem,
  resumeAdminSession
} from '../../core/api/client';
import type { ApiRoadmapItem } from '../../core/api/client';
import { getOrCreateVoterId } from '../../core/game/voterSession';

export const RoadmapPage: React.FC = () => {
  const voterId = getOrCreateVoterId();
  // Curation authority is the admin session this browser holds, established at
  // /admin. It is never a key in this page's URL — see core/api/admin.ts.
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminChecked, setAdminChecked] = useState<boolean>(false);

  const [items, setItems] = useState<ApiRoadmapItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<ApiRoadmapItem | null>(null);

  const fetchRoadmap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listRoadmapItems(voterId, isAdmin);
      setItems(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load roadmap items');
    } finally {
      setLoading(false);
    }
  }, [voterId, isAdmin]);

  // Ask once whether this browser holds an admin session, then load the board
  // as whoever that made us. The list itself differs: curation sees flagged items.
  useEffect(() => {
    let cancelled = false;
    resumeAdminSession()
      .then((live) => {
        if (cancelled) return;
        setIsAdmin(live);
      })
      .finally(() => {
        if (!cancelled) setAdminChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (adminChecked) fetchRoadmap();
  }, [adminChecked, fetchRoadmap]);

  const handleVote = async (id: string, currentlyVoted: boolean) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const delta = currentlyVoted ? -1 : 1;
          return {
            ...item,
            voted: !currentlyVoted,
            vote_count: Math.max(0, item.vote_count + delta)
          };
        }
        return item;
      })
    );

    try {
      if (currentlyVoted) {
        await unvoteRoadmapItem(id, voterId);
      } else {
        await voteRoadmapItem(id, voterId);
      }
    } catch (err: any) {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id === id) {
            const delta = currentlyVoted ? 1 : -1;
            return {
              ...item,
              voted: currentlyVoted,
              vote_count: Math.max(0, item.vote_count + delta)
            };
          }
          return item;
        })
      );
      setActionNotice(`Failed to update vote: ${err.message || 'Unknown error'}`);
    }
  };

  const handleFlag = async (id: string) => {
    try {
      await flagRoadmapItem(id, voterId);
      setActionNotice('Item reported. Thank you for keeping the roadmap community-friendly.');
      fetchRoadmap();
    } catch (err: any) {
      setActionNotice(`Failed to report item: ${err.message || 'Unknown error'}`);
    }
  };

  const handleCreateSubmit = async (data: { title: string; description: string }) => {
    const newItem = await createRoadmapItem(data);
    setItems((prev) => [newItem, ...prev]);
    setActionNotice('Idea submitted successfully!');
  };

  const handleMoveStatus = async (id: string, newStatus: ApiRoadmapItem['status']) => {
    if (!isAdmin) return;
    try {
      const updated = await updateRoadmapItem(id, { status: newStatus });
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setActionNotice(`Moved item to lane "${newStatus.replace('_', ' ')}"`);
    } catch (err: any) {
      setActionNotice(`Failed to move feature: ${err.message || 'Unknown error'}`);
    }
  };

  const handleEditSubmit = async (
    id: string,
    data: { title: string; description: string; status: ApiRoadmapItem['status'] }
  ) => {
    if (!isAdmin) return;
    const updated = await updateRoadmapItem(id, data);
    setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    setActionNotice('Roadmap item updated successfully.');
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    try {
      await deleteRoadmapItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setActionNotice('Roadmap item removed.');
    } catch (err: any) {
      setActionNotice(`Failed to remove feature: ${err.message || 'Unknown error'}`);
    }
  };

  const proposedItems = items.filter((i) => i.status === 'PROPOSED');
  const plannedItems = items.filter((i) => i.status === 'PLANNED');
  const inProgressItems = items.filter((i) => i.status === 'IN_PROGRESS');
  const shippedItems = items.filter((i) => i.status === 'SHIPPED');

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
        )
      }}
      loading={loading}
      error={error}
      onRetry={fetchRoadmap}
    >
      <section style={{ maxWidth: 'var(--wrap)', margin: '0 auto var(--sp-7)', padding: '0 var(--sp-4)' }}>
        <div style={{ marginBottom: 'var(--sp-6)', textAlign: 'center' }}>
          <h1 className="t-announce fs-9" style={{ color: 'var(--ink-strong)', marginTop: 'var(--sp-1)' }}>
            {isAdmin ? 'Roadmap Admin Console' : 'Community Roadmap'}
          </h1>
          {/* The CTA answers the sentence directly above it — "share your own
              suggestions" and the control that does it read as one thought.
              In the TopBar it sat beside the wordmark, detached from the page
              it acted on. */}
          <div style={{ marginTop: 'var(--sp-5)' }}>
            <Button variant="primary" size="lg" onClick={() => setCreateDialogOpen(true)}>
              Submit an Idea
            </Button>
          </div>
        </div>

        {isAdmin && (
          <div style={{ marginBottom: 'var(--sp-4)' }}>
            <Notice kind="info">
              ⚙️ <strong>Roadmap Admin Mode Active</strong> — Move items across lanes, edit feature details, or remove features from the public roadmap.
            </Notice>
          </div>
        )}

        {actionNotice && (
          <div style={{ marginBottom: 'var(--sp-4)' }}>
            <Notice kind="info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{actionNotice}</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ marginLeft: 'var(--sp-2)' }}
                onClick={() => setActionNotice(null)}
              >
                ✕
              </button>
            </Notice>
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'start'
          }}
        >
          <RoadmapLane
            title="Proposed"
            laneKey="PROPOSED"
            badgeTone="neutral"
            items={proposedItems}
            onVote={handleVote}
            onFlag={handleFlag}
            onOpenSubmit={() => setCreateDialogOpen(true)}
            isAdmin={isAdmin}
            onMoveStatus={handleMoveStatus}
            onEdit={(item) => setEditingItem(item)}
            onDelete={handleDelete}
          />
          <RoadmapLane
            title="Planned"
            laneKey="PLANNED"
            badgeTone="gold"
            items={plannedItems}
            onVote={handleVote}
            onFlag={handleFlag}
            isAdmin={isAdmin}
            onMoveStatus={handleMoveStatus}
            onEdit={(item) => setEditingItem(item)}
            onDelete={handleDelete}
          />
          <RoadmapLane
            title="In Progress"
            laneKey="IN_PROGRESS"
            badgeTone="rust"
            items={inProgressItems}
            onVote={handleVote}
            onFlag={handleFlag}
            isAdmin={isAdmin}
            onMoveStatus={handleMoveStatus}
            onEdit={(item) => setEditingItem(item)}
            onDelete={handleDelete}
          />
          <RoadmapLane
            title="Shipped"
            laneKey="SHIPPED"
            badgeTone="moss"
            items={shippedItems}
            onVote={handleVote}
            onFlag={handleFlag}
            isAdmin={isAdmin}
            onMoveStatus={handleMoveStatus}
            onEdit={(item) => setEditingItem(item)}
            onDelete={handleDelete}
          />
        </div>
      </section>

      <CreateItemDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreateSubmit}
      />

      <EditItemDialog
        open={Boolean(editingItem)}
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSubmit={handleEditSubmit}
      />

      <PageFooter />
    </PageShell>
  );
};
