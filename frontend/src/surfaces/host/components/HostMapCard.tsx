import React from 'react';
import type { BoardSummary } from '../../../core/api/client';
import { RoutePreview } from '../../../core/map/RoutePreview';
import { boardTitle } from '../../shared/boardFilters';
import { Card, Badge, Button } from '@ds';

interface HostMapCardProps {
  board: BoardSummary;
  onView: (id: string) => void;
  onHost: (id: string) => void;
  isHosting?: boolean;
  /** True while any card on the page is starting a race. */
  disabled?: boolean;
  /** Overrides the primary action's wording. The solo launcher runs, it does not host. */
  actionLabel?: string;
  busyLabel?: string;
  /** An extra line under the route rule — the solo launcher puts the board record there. */
  meta?: React.ReactNode;
}

/* Same dashed START···FINISH rule the gallery and "My Maps" cards carry — the
   map-card motif is shared, so the host list must not invent its own. */
const DASH = 'repeating-linear-gradient(90deg, var(--line-strong) 0 var(--sp-1), transparent var(--sp-1) var(--sp-2))';

/* The layout lives in `.map-card` rather than inline styles: a phone reflows this
   into a thumbnail-beside-name row, and an inline style cannot be overridden by
   a media query. */
export const HostMapCard: React.FC<HostMapCardProps> = ({
  board,
  onView,
  onHost,
  isHosting,
  disabled,
  actionLabel = 'Host',
  busyLabel = 'Starting…',
  meta,
}) => {
  /* Shared with the launcher's search so the text you read on the card is the
     text you can type to find it again. */
  const title = boardTitle(board);

  return (
    <Card interactive className="card--pad map-card">
      <div className="map-card__head">
        {/* The picker now mixes the public gallery with this device's own
            unpublished maps, so the card has to say which one you are looking
            at — otherwise "why can my friend not see this?" has no answer. */}
        {board.is_listed === false ? (
          <Badge tone="rust">YOUR PRIVATE MAP</Badge>
        ) : (
          <Badge tone="moss">READY</Badge>
        )}
        <span className="t-data fs-2 map-card__date">
          {new Date(board.updated_at).toLocaleDateString()}
        </span>
      </div>

      <h3 className="t-announce fs-7 map-card__title">{title}</h3>

      <div className="map-card__thumb">
        <RoutePreview preview={board.preview} label={`Route map for ${title}`} />
      </div>

      <div className="t-data fs-2 map-card__rule">
        <span>START</span>
        <i style={{ flex: 1, height: '0.0625rem', background: DASH }} />
        <span>{board.waypoint_count} CP</span>
        <i style={{ flex: 1, height: '0.0625rem', background: DASH }} />
        <span>FINISH</span>
      </div>

      {meta && <div className="map-card__meta">{meta}</div>}

      <div className="map-card__actions">
        <Button variant="secondary" size="sm" onClick={() => onView(board.id)}>
          View
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon="🏁"
          disabled={disabled}
          onClick={() => onHost(board.id)}
        >
          {isHosting ? busyLabel : actionLabel}
        </Button>
      </div>
    </Card>
  );
};
