import React from 'react';

/** Route treatment variant for the globe. */
export type RouteGlobeVariant = 'bands' | 'orbit' | 'network' | 'fan';

export interface RouteGlobeProps {
  /** Route treatment variant. Defaults to 'orbit'. */
  variant?: RouteGlobeVariant;
  /** Whether to animate routes and waypoints on mount. */
  animate?: boolean;
  /** Accessible name, or null if purely decorative. */
  label?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

// Generates SVG points for a pointy-top hex finish marker.
const hexPoints = (cx: number, cy: number): string =>
  [
    [cx, cy - 13],
    [cx - 11.3, cy - 6.5],
    [cx - 11.3, cy + 6.5],
    [cx, cy + 13],
    [cx + 11.3, cy + 6.5],
    [cx + 11.3, cy - 6.5],
  ]
    .map(([x, y]) => `${x} ${y}`)
    .join(' ');

// Path definition with length for dash-offset animation.
type Band = { d: string; stroke: string; len: number; cls: string };

const band = (d: string, stroke: string, len: number, cls = ''): Band => ({ d, stroke, len, cls });

// Arcing sunset bands across the globe.
const BANDS: Band[] = [
  band('M26 226 C 92 90, 212 74, 292 128', 'var(--red)', 400),
  band('M24 246 C 92 114, 212 98, 294 150', 'var(--orange)', 400, 'draw--2'),
  band('M24 266 C 92 138, 212 122, 294 172', 'var(--amber)', 400, 'draw--3'),
];

// Waypoint coordinates along the middle bands route.
const BANDS_WAYPOINTS = [
  { cx: 83.3, cy: 168 },
  { cx: 153.8, cy: 129 },
  { cx: 226.8, cy: 124.5 },
];

// Orbit circle tilt angle and x-radius.
const ORBIT_TILT = -22;
const ORBIT_RX = 120;

// Orbit lane configurations with staggered timing, phase offsets, and parked positions.
const ORBIT_RINGS = [
  { cy: 145, ry: 36, stroke: 'var(--red)', cls: '', dur: '17s', phase: -0.12, park: '14%' },
  { cy: 160, ry: 44, stroke: 'var(--orange)', cls: 'draw--2', dur: '23s', phase: -0.58, park: '38%' },
  { cy: 175, ry: 52, stroke: 'var(--amber)', cls: 'draw--3', dur: '13s', phase: -0.81, park: '26%' },
];

// Meridian phase offsets and resting scale positions.
const MERIDIANS = [
  { phase: 0, rest: 0.95 },
  { phase: -0.125, rest: 0.68 },
  { phase: -0.25, rest: 0.18 },
  { phase: -0.375, rest: -0.6 },
];

// Generates the front-facing arc path for an orbit ring.
const orbitNear = (cy: number, ry: number): string =>
  `M${160 - ORBIT_RX} ${cy} A ${ORBIT_RX} ${ry} 0 0 0 ${160 + ORBIT_RX} ${cy}`;

// Generates the full elliptical path for an orbit lap.
const orbitFull = (cy: number, ry: number): string =>
  `${orbitNear(cy, ry)} A ${ORBIT_RX} ${ry} 0 0 0 ${160 - ORBIT_RX} ${cy}`;

// Network variant waypoint coordinates.
const NET_WAYPOINTS = {
  a: { cx: 60, cy: 208 },
  b: { cx: 104, cy: 170 },
  c: { cx: 148, cy: 198 },
  d: { cx: 194, cy: 148 },
  e: { cx: 232, cy: 178 },
  f: { cx: 266, cy: 124 },
};

// Active multi-segment route for the network variant.
const NET_ROUTE: Band[] = [
  band('M60 208 L104 170', 'var(--red)', 62),
  band('M104 170 L148 198 L194 148', 'var(--orange)', 124, 'draw--2'),
  band('M194 148 L232 178 L266 124', 'var(--amber)', 116, 'draw--3'),
];

// Inactive network link segments.
const NET_LINKS = ['M60 208 L148 198', 'M104 170 L194 148', 'M148 198 L232 178'];

// Departure origin and route configurations for the fan variant.
const FAN_ORIGIN = { cx: 40, cy: 240 };
const FAN_ROUTES: Band[] = [
  band('M40 240 C 110 160, 190 96, 269 109', 'var(--red)', 290),
  band('M40 240 C 120 208, 200 148, 280 150', 'var(--orange)', 280, 'draw--2'),
  band('M40 240 C 124 250, 196 214, 273 201', 'var(--amber)', 260, 'draw--3'),
];
const FAN_ENDS = [
  { cx: 280, cy: 150, stroke: 'var(--orange)' },
  { cx: 273, cy: 201, stroke: 'var(--amber)' },
];

// Static globe wireframe sphere.
const Sphere: React.FC = () => (
  <g className="route-globe__sphere">
    <circle cx={160} cy={160} r={120} />
    <ellipse cx={160} cy={160} rx={120} ry={33} />
    <ellipse cx={160} cy={112} rx={110} ry={29} />
    <ellipse cx={160} cy={208} rx={110} ry={29} />
    <ellipse cx={160} cy={160} rx={48} ry={120} />
  </g>
);

// Rotating globe wireframe for the orbit variant.
const OrbitSphere: React.FC = () => (
  <>
    <circle className="route-globe__limb" cx={160} cy={160} r={120} />
    <g className="route-globe__graticule">
      <ellipse cx={160} cy={160} rx={120} ry={33} />
      <ellipse cx={160} cy={112} rx={110} ry={29} />
      <ellipse cx={160} cy={208} rx={110} ry={29} />
      {MERIDIANS.map((m) => (
        <ellipse
          key={m.phase}
          className="route-globe__meridian"
          cx={160}
          cy={160}
          rx={120}
          ry={120}
          style={{ '--phase': m.phase, '--rest': m.rest } as React.CSSProperties}
        />
      ))}
    </g>
  </>
);

const RoutePath: React.FC<{ band: Band; animate: boolean }> = ({ band: b, animate }) => (
  <path
    className={`route-globe__band ${animate ? `draw ${b.cls}` : ''}`.trim()}
    d={b.d}
    stroke={b.stroke}
    style={{ '--len': b.len } as React.CSSProperties}
  />
);

/** Decorative globe SVG illustration component with route overlays. */
export const RouteGlobe: React.FC<RouteGlobeProps> = ({
  variant = 'orbit',
  animate = true,
  label = null,
  className = '',
  style,
}) => {
  // Sanitize React useId for safe SVG fragment references.
  const uid = `route-globe-${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
  <svg
    className={`route-globe route-globe--${variant} ${className}`.trim()}
    style={style}
    viewBox="0 0 320 320"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...(label ? { role: 'img', 'aria-label': label } : { role: 'presentation', 'aria-hidden': true })}
  >
    {variant !== 'orbit' && <Sphere />}

    {variant === 'bands' && (
      <>
        {BANDS.map((b) => (
          <RoutePath key={b.stroke} band={b} animate={animate} />
        ))}
        {/* Start, waypoints, and finish markers. */}
        <g className={animate ? 'route-globe__waypoints route-globe__waypoints--in' : 'route-globe__waypoints'}>
          <circle className="route-globe__start" cx={24} cy={246} r={7} fill="var(--orange)" />
          {BANDS_WAYPOINTS.map((point) => (
            <circle
              key={point.cx}
              className="route-globe__waypoint"
              cx={point.cx}
              cy={point.cy}
              r={7}
              stroke="var(--orange)"
            />
          ))}
          <polygon className="route-globe__finish" points={hexPoints(294, 150)} fill="var(--red)" />
        </g>
      </>
    )}

    {variant === 'orbit' && (
      <>
        <defs>
          {/* Opacity gradient along the ring's major axis for smooth limb transitions. */}
          {ORBIT_RINGS.map((ring, i) => (
            <linearGradient
              key={ring.stroke}
              id={`${uid}-limb-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={160 - ORBIT_RX}
              y1={ring.cy}
              x2={160 + ORBIT_RX}
              y2={ring.cy}
            >
              <stop offset="0" stopColor={ring.stroke} stopOpacity="0" />
              <stop offset="0.12" stopColor={ring.stroke} stopOpacity="1" />
              <stop offset="0.88" stopColor={ring.stroke} stopOpacity="1" />
              <stop offset="1" stopColor={ring.stroke} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        <OrbitSphere />

        {ORBIT_RINGS.map((ring, i) => (
          <g key={ring.stroke} transform={`rotate(${ORBIT_TILT} 160 ${ring.cy})`}>
            {/* Back half of orbit ring. */}
            <ellipse
              className="route-globe__orbit-far"
              cx={160}
              cy={ring.cy}
              rx={ORBIT_RX}
              ry={ring.ry}
              stroke={ring.stroke}
            />
            <path
              className={`route-globe__band ${animate ? `draw ${ring.cls}` : ''}`.trim()}
              d={orbitNear(ring.cy, ring.ry)}
              stroke={`url(#${uid}-limb-${i})`}
              style={{ '--len': 290 } as React.CSSProperties}
            />
            {/* Lane racer indicator with depth dimming. */}
            {animate && (
              <g className="route-globe__racers">
                <g
                  className="route-globe__racer"
                  style={
                    {
                      offsetPath: `path("${orbitFull(ring.cy, ring.ry)}")`,
                      '--dur': ring.dur,
                      '--phase': ring.phase,
                      '--park': ring.park,
                    } as React.CSSProperties
                  }
                >
                  <circle className="route-globe__racer-glow" r={16} fill={ring.stroke} />
                  <circle className="route-globe__waypoint" r={7} stroke={ring.stroke} />
                </g>
              </g>
            )}
          </g>
        ))}
      </>
    )}

    {variant === 'network' && (
      <>
        <g className="route-globe__links">
          {NET_LINKS.map((d) => (
            <path key={d} className="route-globe__link" d={d} />
          ))}
        </g>
        {NET_ROUTE.map((b) => (
          <RoutePath key={b.stroke} band={b} animate={animate} />
        ))}
        <g className={animate ? 'route-globe__waypoints route-globe__waypoints--in' : 'route-globe__waypoints'}>
          <circle className="route-globe__start" {...NET_WAYPOINTS.a} r={7} fill="var(--orange)" />
          {[NET_WAYPOINTS.b, NET_WAYPOINTS.c, NET_WAYPOINTS.d, NET_WAYPOINTS.e].map((point) => (
            <circle
              key={point.cx}
              className="route-globe__waypoint"
              cx={point.cx}
              cy={point.cy}
              r={7}
              stroke="var(--orange)"
            />
          ))}
          <polygon
            className="route-globe__finish"
            points={hexPoints(NET_WAYPOINTS.f.cx, NET_WAYPOINTS.f.cy)}
            fill="var(--red)"
          />
        </g>
      </>
    )}

    {variant === 'fan' && (
      <>
        {FAN_ROUTES.map((b) => (
          <RoutePath key={b.stroke} band={b} animate={animate} />
        ))}
        <g className={animate ? 'route-globe__waypoints route-globe__waypoints--in' : 'route-globe__waypoints'}>
          <circle className="route-globe__start" {...FAN_ORIGIN} r={7} fill="var(--orange)" />
          {FAN_ENDS.map((point) => (
            <circle
              key={point.cx}
              className="route-globe__waypoint"
              cx={point.cx}
              cy={point.cy}
              r={7}
              stroke={point.stroke}
            />
          ))}
          <polygon className="route-globe__finish" points={hexPoints(269, 109)} fill="var(--red)" />
        </g>
      </>
    )}
  </svg>
  );
};
