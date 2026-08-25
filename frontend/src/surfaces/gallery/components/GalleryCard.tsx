import React from 'react';
import type { BoardSummary } from '../../../core/api/client';
import { RoutePreview } from '../../../core/map/RoutePreview';
import { boardTitle } from '../../shared/boardFilters';
import { Card, Badge, Button } from '@ds';

interface GalleryCardProps {
  board: BoardSummary;
  onView: (id: string) => void;
  onFork: (id: string) => void;
  isForking?: boolean;
}

/* The dashed START···FINISH rule is the map-card motif shared with "My Maps" on
   the landing page; the gallery threads the waypoint count through its middle. */
const DASH = 'repeating-linear-gradient(90deg, var(--line-strong) 0 var(--sp-1), transparent var(--sp-1) var(--sp-2))';

export const GalleryCard: React.FC<GalleryCardProps> = ({ board, onView, onFork, isForking }) => {
  /* Shared with the gallery's search so the text you read on the card is the
     text you can type to find it again. */
  const title = boardTitle(board);

  return (
    <Card interactive className="card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Badge tone="moss">PUBLIC</Badge>
        <span className="t-data fs-2" style={{ color: 'var(--ink-muted)' }}>
          {new Date(board.updated_at).toLocaleDateString()}
        </span>
      </div>

      <h3 className="t-announce fs-7" style={{ margin: 0, color: 'var(--ink-strong)' }}>
        {title}
      </h3>

      <RoutePreview preview={board.preview} label={`Route map for ${title}`} />

      <div className="t-data fs-2" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', color: 'var(--ink-muted)' }}>
        <span>START</span>
        <i style={{ flex: 1, height: '0.0625rem', background: DASH }} />
        <span>{board.waypoint_count} CP</span>
        <i style={{ flex: 1, height: '0.0625rem', background: DASH }} />
        <span>FINISH</span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
        <Button variant="secondary" size="sm" onClick={() => onView(board.id)} style={{ flex: 1 }}>
          View
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon="🍴"
          disabled={isForking}
          onClick={() => onFork(board.id)}
          style={{ flex: 1 }}
        >
          {isForking ? 'Forking…' : 'Fork'}
        </Button>
      </div>
    </Card>
  );
};
