import './anim.css';
import './OpenForWhom.css';

/**
 * OpenForWhom — the asymmetry between the two ways past a gating challenge.
 * Completing it opens the road for the whole field; a bypass opens it for
 * one team. Both panels run the same 10s loop so they can be read against each
 * other at a glance.
 */

type Variant = 'all' | 'you';

function Panel({ variant }: { variant: Variant }) {
  const openToAll = variant === 'all';

  return (
    <svg
      viewBox="0 0 320 190"
      className={`rw-stage of of--${variant}`}
      role="img"
      aria-label={
        openToAll
          ? 'Purple completes the challenge; the road opens and both teams walk through it.'
          : 'Orange vetoes the challenge; the road opens for Orange alone, and Purple is still stopped by it.'
      }
    >
      <line x1={60} y1={100} x2={250} y2={100} className="rw-road" />
      <line
        x1={60}
        y1={100}
        x2={250}
        y2={100}
        className={`rw-road of-open of-open--${variant}`}
      />

      {/* What was played. */}
      <g className="of-card">
        <rect x={92} y={16} width={136} height={32} rx={8} className="rw-card" />
        <text x={160} y={36} className="rw-card-text of-card-text">
          {openToAll ? 'Challenge passed' : 'Veto played'}
        </text>
      </g>

      {/* The gate. */}
      <g className="of-gate">
        <line x1={155} y1={76} x2={155} y2={124} className="of-gate-bar" />
        <path d="M 149 92 v -5 a 6 6 0 0 1 12 0 v 5" className="rw-lock" />
        <rect x={146} y={92} width={18} height={14} rx={3} className="rw-lock-body" />
      </g>

      {/* Waypoints. */}
      <g>
        <circle cx={60} cy={100} r={12} className="rw-waypoint-ring" />
        <circle cx={60} cy={100} r={8} className="rw-waypoint-dot" />
      </g>
      <g>
        <circle cx={250} cy={100} r={12} className="rw-waypoint-ring" />
        <circle cx={250} cy={100} r={8} className="rw-waypoint-dot" />
      </g>

      {/* Runners. */}
      <g className="of-purple">
        <circle cx={40} cy={82} r={9} className="rw-runner-dot rw-runner-dot--purple" />
        <text x={40} y={85} className="rw-runner-label">
          P
        </text>
      </g>
      <g className="of-orange">
        <circle cx={40} cy={118} r={9} className="rw-runner-dot rw-runner-dot--orange" />
        <text x={40} y={121} className="rw-runner-label">
          O
        </text>
      </g>

      <text
        x={160}
        y={162}
        className={`rw-status of-status ${openToAll ? 'rw-status--moss' : 'rw-status--orange'
          }`}
      >
        {openToAll ? 'Open to the whole field' : 'Open to Orange alone'}
      </text>
      {!openToAll && (
        <text x={160} y={180} className="rw-status rw-status--muted of-status-2">
          Purple still has to clear it
        </text>
      )}
    </svg>
  );
}

export default function OpenForWhom() {
  return (
    <figure className="rw-fig">
      <div className="rw-fig-head">
        <h3 className="rw-fig-title">Passing challenges</h3>
        <div className="rw-legend">
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--purple" />
            Purple
          </span>
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--orange" />
            Orange
          </span>
        </div>
      </div>

      <div className="rw-split">
        <div>
          <p className="rw-panel-title">Purple completes it</p>
          <Panel variant="all" />
        </div>
        <div>
          <p className="rw-panel-title">Orange vetoes it</p>
          <Panel variant="you" />
        </div>
      </div>
    </figure>
  );
}
