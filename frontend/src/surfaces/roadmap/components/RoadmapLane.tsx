import React from 'react';
import { Badge, Button, Empty } from '@ds';
import { RoadmapCard } from './RoadmapCard';
import type { ApiRoadmapItem } from '../../../core/api/client';

export interface RoadmapLaneProps {
  title: string;
  laneKey: ApiRoadmapItem['status'];
  badgeTone: 'neutral' | 'gold' | 'rust' | 'moss';
  items: ApiRoadmapItem[];
  onVote: (id: string, currentlyVoted: boolean) => void;
  onFlag: (id: string) => void;
  onOpenSubmit?: () => void;
  isAdmin?: boolean;
  onMoveStatus?: (id: string, newStatus: ApiRoadmapItem['status']) => void;
  onEdit?: (item: ApiRoadmapItem) => void;
  onDelete?: (id: string) => void;
}

export const RoadmapLane: React.FC<RoadmapLaneProps> = ({
  title,
  laneKey,
  badgeTone,
  items,
  onVote,
  onFlag,
  onOpenSubmit,
  isAdmin,
  onMoveStatus,
  onEdit,
  onDelete
}) => {
  const isProposedLane = laneKey === 'PROPOSED';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-4)',
        background: 'var(--surface-2)',
        padding: 'var(--sp-4)',
        borderRadius: 'var(--r-lg)',
        border: 'thin solid var(--line)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="t-announce fs-5" style={{ color: 'var(--ink-strong)' }}>
          {title}
        </h2>
        <Badge tone={badgeTone}>{items.length}</Badge>
      </div>

      {items.length === 0 ? (
        <Empty
          description={`No ${title.toLowerCase()} items`}
          action={
            isProposedLane && onOpenSubmit ? (
              <Button variant="ghost" size="sm" onClick={onOpenSubmit}>
                Submit an Idea
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {items.map((item) => (
            <RoadmapCard
              key={item.id}
              item={item}
              onVote={onVote}
              onFlag={onFlag}
              /* The lane heading already states the status. */
              hideStatus
              isAdmin={isAdmin}
              onMoveStatus={onMoveStatus}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
};
