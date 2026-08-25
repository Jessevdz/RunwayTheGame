import React, { useState } from 'react';
import { Card, Badge, Button, IconButton } from '@ds';
import type { ApiRoadmapItem } from '../../../core/api/client';

export interface RoadmapCardProps {
  item: ApiRoadmapItem;
  onVote: (id: string, currentlyVoted: boolean) => void;
  onFlag: (id: string) => void;
  isAdmin?: boolean;
  onMoveStatus?: (id: string, newStatus: ApiRoadmapItem['status']) => void;
  onEdit?: (item: ApiRoadmapItem) => void;
  onDelete?: (id: string) => void;
  /** Suppresses the status badge when the column already states the status. Defaults to true. */
  hideStatus?: boolean;
}

const BADGE_CONFIG: Record<ApiRoadmapItem['status'], { tone: 'neutral' | 'gold' | 'rust' | 'moss'; label: string }> = {
  PROPOSED: { tone: 'neutral', label: 'Proposed' },
  PLANNED: { tone: 'gold', label: 'Planned' },
  IN_PROGRESS: { tone: 'rust', label: 'In Progress' },
  SHIPPED: { tone: 'moss', label: 'Shipped' },
};

const LANE_ORDER: ApiRoadmapItem['status'][] = ['PROPOSED', 'PLANNED', 'IN_PROGRESS', 'SHIPPED'];

export const RoadmapCard: React.FC<RoadmapCardProps> = ({
  item,
  onVote,
  onFlag,
  isAdmin,
  onMoveStatus,
  onEdit,
  onDelete,
  hideStatus = true
}) => {
  const [confirmFlag, setConfirmFlag] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const badgeInfo = BADGE_CONFIG[item.status] || { tone: 'neutral', label: item.status };

  const handleFlagClick = () => {
    if (confirmFlag) {
      onFlag(item.id);
      setConfirmFlag(false);
    } else {
      setConfirmFlag(true);
      setTimeout(() => setConfirmFlag(false), 4000);
    }
  };

  const handleDeleteClick = () => {
    if (confirmDelete) {
      if (onDelete) onDelete(item.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
    }
  };

  const currentLaneIdx = LANE_ORDER.indexOf(item.status);
  const prevStatus = currentLaneIdx > 0 ? LANE_ORDER[currentLaneIdx - 1] : null;
  const nextStatus = currentLaneIdx >= 0 && currentLaneIdx < LANE_ORDER.length - 1 ? LANE_ORDER[currentLaneIdx + 1] : null;

  return (
    <Card
      interactive
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-4)',
        border: item.is_hidden ? 'thin dashed var(--orange)' : 'thin solid var(--line)',
        borderRadius: 'var(--r-md)',
        background: item.is_hidden ? 'var(--surface-2)' : 'var(--surface)',
        opacity: item.is_hidden ? 0.75 : 1
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          {!hideStatus && <Badge tone={badgeInfo.tone}>{badgeInfo.label}</Badge>}
          {item.is_hidden && <Badge tone="rust">Hidden</Badge>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 'var(--sp-1)', marginLeft: 'auto' }}>
          {isAdmin ? (
            <>
              {onEdit && (
                <Button variant="ghost" size="sm" onClick={() => onEdit(item)} title="Edit feature">
                  ✏️ Edit
                </Button>
              )}
              {onDelete && (
                <Button
                  variant={confirmDelete ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={handleDeleteClick}
                  title="Remove feature"
                >
                  {confirmDelete ? 'Confirm Delete?' : '🗑️'}
                </Button>
              )}
            </>
          ) : (
            <>
              {confirmFlag ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleFlagClick}
                >
                  Confirm Report
                </Button>
              ) : (
                <IconButton
                  icon="🚩"
                  label="Report item"
                  variant="ghost"
                  size="sm"
                  onClick={handleFlagClick}
                />
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <h3 className="fs-6" style={{ fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 'var(--sp-1)' }}>
          {item.title}
        </h3>
        {item.description && (
          <p className="fs-5" style={{ color: 'var(--ink-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
            {item.description}
          </p>
        )}
      </div>

      {isAdmin && onMoveStatus && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            /* A lane is only ~16rem wide, so the pills cannot all share a line. */
            flexWrap: 'wrap',
            gap: 'var(--sp-2)',
            paddingTop: 'var(--sp-2)',
            borderTop: 'thin solid var(--line)'
          }}
        >
          <span className="fs-2 t-announce" style={{ color: 'var(--ink-muted)', flexShrink: 0 }}>
            Move Lane:
          </span>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              gap: 'var(--sp-1)',
              flex: '1 1 auto',
              minWidth: 0
            }}
          >
            {prevStatus && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onMoveStatus(item.id, prevStatus)}
                title={`Move to ${prevStatus}`}
                style={{ maxWidth: '100%' }}
              >
                ← {BADGE_CONFIG[prevStatus].label}
              </Button>
            )}
            {nextStatus && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onMoveStatus(item.id, nextStatus)}
                title={`Move to ${nextStatus}`}
                style={{ maxWidth: '100%' }}
              >
                {BADGE_CONFIG[nextStatus].label} →
              </Button>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 'var(--sp-2)' }}>
        <Button
          variant={item.voted ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => onVote(item.id, item.voted)}
        >
          ▲ <span className="t-data" style={{ marginLeft: 'var(--sp-1)' }}>{item.vote_count}</span>
        </Button>
        <span className="t-data fs-2" style={{ color: 'var(--ink-muted)' }}>
          {new Date(item.created_at).toLocaleDateString()}
        </span>
      </div>
    </Card>
  );
};
