import './anim.css';
import './ChartingPath.css';

/**
 * ChartingPath — a board is a graph, not a route. From where you stand, the
 * legal moves are exactly the waypoints a road connects you to; the way
 * round is yours to pick. 10s loop.
 *
 * The runner uses animateMotion rather than CSS keyframes because the route is
 * a polyline with pauses at each waypoint — the same technique RaceAnimation
 * uses. SMIL ignores prefers-reduced-motion, so the runner is hidden there and
 * the route is left drawn as a still diagram.
 */

const WAYPOINTS = {
  a: { x: 80, y: 120 },
  b: { x: 200, y: 60 },
  c: { x: 200, y: 180 },
  d: { x: 330, y: 110 },
  e: { x: 330, y: 200 },
  f: { x: 460, y: 60 },
  g: { x: 460, y: 160 },
  h: { x: 580, y: 120 },
} as const;

type WaypointId = keyof typeof WAYPOINTS;

const ROADS: Array<[WaypointId, WaypointId]> = [
  ['a', 'b'], ['a', 'c'],
  ['b', 'd'], ['b', 'f'],
  ['c', 'd'], ['c', 'e'],
  ['d', 'f'], ['d', 'g'],
  ['e', 'g'],
  ['f', 'h'], ['g', 'h'],
];

/** One way round of several. */
const ROUTE: WaypointId[] = ['a', 'b', 'd', 'g', 'h'];

const ROUTE_D = ROUTE.map(
  (id, i) => `${i === 0 ? 'M' : 'L'} ${WAYPOINTS[id].x},${WAYPOINTS[id].y}`,
).join(' ');

export default function ChartingPath() {
  return (
    <figure className="rw-fig cp">
      <div className="rw-fig-head">
        <h3 className="rw-fig-title">Creating a route</h3>
        <div className="rw-legend">
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--moss" />
            Where you may step
          </span>
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--red" />
            No road, no move
          </span>
        </div>
      </div>

      <svg
        viewBox="0 0 640 244"
        className="rw-stage"
        role="img"
        aria-label="From the waypoint it stands on, a team may step only to the waypoints joined to it by a road. Waypoints further off are not moves, however close they are. The route through the board is the team's own to choose."
      >
        {ROADS.map(([from, to]) => (
          <line
            key={`${from}${to}`}
            x1={WAYPOINTS[from].x}
            y1={WAYPOINTS[from].y}
            x2={WAYPOINTS[to].x}
            y2={WAYPOINTS[to].y}
            className="rw-road"
          />
        ))}

        {/* The way this team went. */}
        <path d={ROUTE_D} className="cp-route" />

        {/* The two waypoints a road actually connects you to. */}
        <circle cx={WAYPOINTS.b.x} cy={WAYPOINTS.b.y} r={21} className="cp-adjacent" />
        <circle cx={WAYPOINTS.c.x} cy={WAYPOINTS.c.y} r={21} className="cp-adjacent" />

        {/* The one two steps off — near, and still not a move. */}
        <g className="cp-illegal">
          <line
            x1={WAYPOINTS.a.x}
            y1={WAYPOINTS.a.y}
            x2={WAYPOINTS.d.x}
            y2={WAYPOINTS.d.y}
            className="cp-illegal-line"
          />
          <line x1={198} y1={107} x2={214} y2={123} className="cp-cross" />
          <line x1={214} y1={107} x2={198} y2={123} className="cp-cross" />
        </g>

        {(Object.keys(WAYPOINTS) as WaypointId[]).map((id) => (
          <g key={id} className={id === 'a' ? 'cp-here' : undefined}>
            <circle cx={WAYPOINTS[id].x} cy={WAYPOINTS[id].y} r={13} className="rw-waypoint-ring" />
            <circle cx={WAYPOINTS[id].x} cy={WAYPOINTS[id].y} r={8} className="rw-waypoint-dot" />
          </g>
        ))}

        <text x={WAYPOINTS.a.x} y={WAYPOINTS.a.y - 24} className="rw-waypoint-label">
          START
        </text>
        <text x={WAYPOINTS.h.x} y={WAYPOINTS.h.y - 24} className="rw-waypoint-label">
          FINISH
        </text>

        <text x={320} y={234} className="rw-status rw-status--moss cp-say-1">
          Adjacent waypoints only
        </text>
        <text x={320} y={234} className="rw-status rw-status--red cp-say-2">
          Two steps away is not a step
        </text>
        <text x={320} y={234} className="rw-status rw-status--muted cp-say-3">
          Which way round is yours to decide
        </text>

        <g className="cp-runner">
          <circle r={9} className="rw-runner-dot rw-runner-dot--purple" />
          <text y={3} className="rw-runner-label">
            P
          </text>
          <animateMotion
            path={ROUTE_D}
            dur="10s"
            repeatCount="indefinite"
            calcMode="linear"
            keyTimes="0; 0.40; 0.495; 0.535; 0.63; 0.67; 0.765; 0.805; 0.90; 1"
            keyPoints="0; 0; 0.24881; 0.24881; 0.50711; 0.50711; 0.76542; 0.76542; 1; 1"
          />
        </g>
      </svg>
    </figure>
  );
}
