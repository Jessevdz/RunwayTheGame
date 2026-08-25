import './RaceAnimation.css';

interface Waypoint {
  id: string;
  code: string;
  name: string;
  x: number;
  y: number;
  isStart?: boolean;
  isFinish?: boolean;
}

const WAYPOINTS: Waypoint[] = [
  { id: 'w01', code: 'START', name: 'Penn Sta', x: 60, y: 150, isStart: true },
  { id: 'w02', code: '02', name: 'Columbus', x: 160, y: 65 },
  { id: 'w03', code: '03', name: 'Bryant Park', x: 170, y: 150 },
  { id: 'w04', code: '04', name: 'Chelsea', x: 160, y: 235 },
  { id: 'w05', code: '05', name: 'Riverside', x: 290, y: 50 },
  { id: 'w06', code: '06', name: 'Times Sq', x: 300, y: 120 },
  { id: 'w07', code: '07', name: 'Union Sq', x: 300, y: 180 },
  { id: 'w08', code: '08', name: 'The Bowery', x: 290, y: 250 },
  { id: 'w09', code: '09', name: 'Harlem', x: 440, y: 50 },
  { id: 'w10', code: '10', name: 'Roosevelt', x: 450, y: 120 },
  { id: 'w11', code: '11', name: 'Kips Bay', x: 450, y: 180 },
  { id: 'w12', code: '12', name: 'Battery', x: 440, y: 250 },
  { id: 'w13', code: '13', name: 'Astoria', x: 590, y: 95 },
  { id: 'w14', code: '14', name: 'Bushwick', x: 590, y: 205 },
  { id: 'w15', code: 'FINISH', name: 'JFK', x: 730, y: 150, isFinish: true },
];

const waypointsById = new Map(WAYPOINTS.map((w) => [w.id, w]));

const ROADS: Array<[string, string]> = [
  ['w01', 'w02'], ['w01', 'w03'], ['w01', 'w04'],
  ['w02', 'w05'], ['w02', 'w06'], ['w02', 'w03'],
  ['w03', 'w06'], ['w03', 'w07'], ['w03', 'w04'],
  ['w04', 'w07'], ['w04', 'w08'],
  ['w05', 'w09'], ['w05', 'w06'],
  ['w06', 'w09'], ['w06', 'w10'], ['w06', 'w07'],
  ['w07', 'w10'], ['w07', 'w11'], ['w07', 'w08'],
  ['w08', 'w11'], ['w08', 'w12'],
  ['w09', 'w13'], ['w09', 'w10'],
  ['w10', 'w13'], ['w10', 'w14'], ['w10', 'w11'],
  ['w11', 'w14'], ['w11', 'w12'],
  ['w12', 'w14'],
  ['w13', 'w15'], ['w13', 'w14'],
  ['w14', 'w15'],
];

const PURPLE_ROUTE = ['w01', 'w02', 'w05', 'w09', 'w13', 'w15'];
const ORANGE_ROUTE = ['w01', 'w03', 'w07', 'w10', 'w14', 'w15'];

function getPathD(routeIds: string[]): string {
  const points = routeIds.map((id) => waypointsById.get(id)!);
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
}

function getKeyPoints(routeIds: string[]): string {
  const points = routeIds.map((id) => waypointsById.get(id)!);
  const distances: number[] = [0];
  let totalLength = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const segLen = Math.hypot(dx, dy);
    totalLength += segLen;
    distances.push(totalLength);
  }

  const fracs = distances.map((d) => (d / totalLength).toFixed(5));

  const keyPointsSeq: string[] = [];
  keyPointsSeq.push(fracs[0]);
  for (let i = 1; i < fracs.length - 1; i++) {
    keyPointsSeq.push(fracs[i]);
    keyPointsSeq.push(fracs[i]);
  }
  keyPointsSeq.push(fracs[fracs.length - 1]);
  keyPointsSeq.push(fracs[fracs.length - 1]);

  return keyPointsSeq.join('; ');
}

const PURPLE_PATH_D = getPathD(PURPLE_ROUTE);
const ORANGE_PATH_D = getPathD(ORANGE_ROUTE);

const PURPLE_KEY_POINTS = getKeyPoints(PURPLE_ROUTE);
const ORANGE_KEY_POINTS = getKeyPoints(ORANGE_ROUTE);

export default function RaceAnimation() {
  return (
    <div className="ra-container">
      <div className="ra-header">
        <div className="ra-title-group">
          <h3 className="ra-title">Runway Match Simulation</h3>
        </div>
      </div>

      <div className="ra-teams">
        <div className="ra-team-card">
          <span className="ra-team-dot ra-team-dot--purple" />
          <span>Team Purple</span>
        </div>

        <div className="ra-team-card">
          <span className="ra-team-dot ra-team-dot--orange" />
          <span>Team Orange</span>
        </div>
      </div>

      <svg viewBox="0 0 800 300" className="ra-stage" aria-label="Animated Race Board">
        {/* Static Roads */}
        {ROADS.map(([aId, bId]) => {
          const a = waypointsById.get(aId)!;
          const b = waypointsById.get(bId)!;
          const segKey = `${aId}-${bId}`;

          return (
            <line
              key={segKey}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="ra-road"
            />
          );
        })}

        {/* Animated Active Route Trails */}
        <path
          d={PURPLE_PATH_D}
          className="ra-trail-active ra-trail-active--purple"
        />
        <path
          d={ORANGE_PATH_D}
          className="ra-trail-active ra-trail-active--orange"
        />

        {/* Waypoint Waypoints */}
        {WAYPOINTS.map((w) => (
          <g
            key={w.id}
            className={`ra-waypoint ${w.isStart ? 'is-start' : ''} ${w.isFinish ? 'is-finish' : ''}`}
          >
            <circle cx={w.x} cy={w.y} r={14} className="ra-waypoint-ring" />
            <circle cx={w.x} cy={w.y} r={9} className="ra-waypoint-dot" />

            <text x={w.x} y={w.y - 20} className="ra-waypoint-label">
              {w.code}
            </text>
            <text x={w.x} y={w.y + 26} className="ra-waypoint-name">
              {w.name}
            </text>
          </g>
        ))}

        {/* Moving Purple Dot */}
        <g className="ra-runner-group">
          <circle r={14} className="ra-runner-glow ra-runner-glow--purple" />
          <circle r={8} className="ra-runner-dot ra-runner-dot--purple" />
          <text y={3} className="ra-runner-label">P</text>
          <animateMotion
            path={PURPLE_PATH_D}
            dur="10s"
            repeatCount="indefinite"
            keyTimes="0; 0.15; 0.20; 0.35; 0.40; 0.55; 0.60; 0.75; 0.80; 0.92; 1"
            keyPoints={PURPLE_KEY_POINTS}
            calcMode="linear"
          />
        </g>

        {/* Moving Orange Dot */}
        <g className="ra-runner-group">
          <circle r={14} className="ra-runner-glow ra-runner-glow--orange" />
          <circle r={8} className="ra-runner-dot ra-runner-dot--orange" />
          <text y={3} className="ra-runner-label">O</text>
          <animateMotion
            path={ORANGE_PATH_D}
            dur="10s"
            repeatCount="indefinite"
            keyTimes="0; 0.10; 0.16; 0.32; 0.38; 0.52; 0.58; 0.76; 0.82; 0.95; 1"
            keyPoints={ORANGE_KEY_POINTS}
            calcMode="linear"
          />
        </g>
      </svg>
    </div>
  );
}
