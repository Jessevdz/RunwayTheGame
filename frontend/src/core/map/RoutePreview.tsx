import React, { useMemo } from 'react';
import type { BoardPreview } from '../api/client';

export interface RoutePreviewProps {
  preview?: BoardPreview;
  /** Announced to screen readers in place of the geometry. */
  label?: string;
}

// ViewBox dimensions for fluid SVG card thumbnails.
const VIEW_W = 320;
const VIEW_H = 132;
const PAD = 16;

interface Projected {
  points: Array<{ x: number; y: number; isStart: boolean; isFinish: boolean }>;
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

/** Projects latitude/longitude coordinates into SVG viewBox dimensions. */
function project(preview: BoardPreview): Projected | null {
  const waypoints = preview.waypoints;
  if (waypoints.length === 0) return null;

  const midLat = waypoints.reduce((sum, w) => sum + w.lat, 0) / waypoints.length;
  const lonScale = Math.cos((midLat * Math.PI) / 180);

  // y is negated: latitude grows north, SVG grows down.
  const raw = waypoints.map((w) => ({ x: w.lon * lonScale, y: -w.lat, isStart: w.is_start, isFinish: w.is_finish }));

  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const boxW = VIEW_W - PAD * 2;
  const boxH = VIEW_H - PAD * 2;

  const scale = spanX <= 0 && spanY <= 0 ? 0 : Math.min(spanX > 0 ? boxW / spanX : Infinity, spanY > 0 ? boxH / spanY : Infinity);

  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offsetX = PAD + (boxW - drawnW) / 2;
  const offsetY = PAD + (boxH - drawnH) / 2;

  const points = raw.map((p) => ({
    x: spanX > 0 ? offsetX + (p.x - minX) * scale : VIEW_W / 2,
    y: spanY > 0 ? offsetY + (p.y - minY) * scale : VIEW_H / 2,
    isStart: p.isStart,
    isFinish: p.isFinish,
  }));

  const lines = preview.roads
    .filter(([a, b]) => points[a] && points[b])
    .map(([a, b]) => ({ x1: points[a].x, y1: points[a].y, x2: points[b].x, y2: points[b].y }));

  return { points, lines };
}

/** Renders a lightweight SVG thumbnail sketch of a board's route for cards. */
export const RoutePreview: React.FC<RoutePreviewProps> = ({ preview, label }) => {
  const projected = useMemo(() => (preview ? project(preview) : null), [preview]);

  if (!projected) {
    return (
      <div className="route-preview route-preview--blank">
        <span className="t-data fs-2">NO ROUTE PLOTTED</span>
      </div>
    );
  }

  return (
    <div className="route-preview">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label || 'Route map preview'}
      >
        <defs>
          <pattern id="route-preview-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle className="route-preview__grid" cx="0" cy="0" r="0.6" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#route-preview-grid)" />

        {projected.lines.map((l, i) => (
          <line key={i} className="route-preview__seg" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}

        {projected.points.map((p, i) => {
          const kind = p.isStart ? 'start' : p.isFinish ? 'finish' : 'mid';
          return (
            <React.Fragment key={i}>
              {kind !== 'mid' && <circle className="route-preview__halo" cx={p.x} cy={p.y} r={7} />}
              <circle className={`route-preview__waypoint route-preview__waypoint--${kind}`} cx={p.x} cy={p.y} r={kind === 'mid' ? 3 : 4.5} />
            </React.Fragment>
          );
        })}
      </svg>
    </div>
  );
};
