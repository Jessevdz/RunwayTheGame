import './anim.css';
import './Roadblock.css';

/**
 * Roadblock — what a power-up bought with coins actually does to a rival: a
 * card dropped on the road ahead of them, cleared per team with a photo, or
 * walked around the long way. 10s loop.
 */

export default function Roadblock() {
  return (
    <figure className="rw-fig rb">
      <div className="rw-fig-head">
        <h3 className="rw-fig-title">A roadblock is a toll</h3>
        <div className="rw-legend">
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--purple" />
            Purple
          </span>
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--red" />
            Orange&rsquo;s card
          </span>
        </div>
      </div>

      <svg
        viewBox="0 0 640 232"
        className="rw-stage"
        role="img"
        aria-label="Orange drops a roadblock on the road ahead of Purple. Purple is stopped, submits a photo to clear it, and walks on — or could have taken the longer route around."
      >
        {/* The long way round: always there, never free. */}
        <path d="M 90 90 L 315 190 L 540 90" className="rw-road rw-road--ghost" />
        <text x={315} y={216} className="rw-waypoint-name rb-detour">
          the long way round
        </text>

        <line x1={90} y1={90} x2={300} y2={90} className="rw-road" />
        <line x1={300} y1={90} x2={540} y2={90} className="rw-road" />
        <line x1={300} y1={90} x2={540} y2={90} className="rw-road rb-blocked" />

        {/* Waypoints. */}
        {[
          { x: 90, code: '04' },
          { x: 300, code: '07' },
          { x: 540, code: '11' },
        ].map((n) => (
          <g key={n.code}>
            <circle cx={n.x} cy={90} r={13} className="rw-waypoint-ring" />
            <circle cx={n.x} cy={90} r={8} className="rw-waypoint-dot" />
            <text x={n.x} y={68} className="rw-waypoint-label">
              {n.code}
            </text>
          </g>
        ))}

        {/* The card Orange bought. */}
        <g className="rb-card">
          <text x={420} y={54} className="rw-card-kicker rb-kicker">
            Placed by Orange
          </text>
          <rect x={372} y={64} width={96} height={30} rx={6} className="rb-card-box" />
          <text x={420} y={84} className="rb-card-text">
            ROADBLOCK
          </text>
        </g>

        {/* Working it off. */}
        <g className="rb-clear">
          <rect x={358} y={122} width={124} height={32} rx={8} className="rw-card" />
          <text x={420} y={142} className="rw-card-text rb-clear-text">
            Photo → cleared
          </text>
          <rect x={358} y={122} width={124} height={32} rx={8} className="rb-flash" />
        </g>

        {/* Purple. */}
        <g className="rb-runner">
          <circle cx={90} cy={90} r={9} className="rw-runner-dot rw-runner-dot--purple" />
          <text x={90} y={93} className="rw-runner-label">
            P
          </text>
        </g>
      </svg>

      <figcaption className="rw-cap">
        The card blocks every team except the one that placed it, and the first
        team to work it off lifts it for everybody behind them. Clearing pays no
        coins and records no progress.
      </figcaption>
    </figure>
  );
}
