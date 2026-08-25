import './anim.css';
import './CaptureLoop.css';

/**
 * CaptureLoop — the five steps a team repeats at every waypoint: walk there,
 * let GPS confirm it, read the prompt, photograph the answer, move on.
 *
 * The loop is 10s split into five equal phases, so the chips under the stage
 * can be driven by one keyframe set and a per-chip delay.
 */

const STEPS = [
  'Walk there',
  'GPS confirms',
  'Read the prompt',
  'Photograph it',
  'Move on',
];

export default function CaptureLoop() {
  return (
    <figure className="rw-fig cl">
      <div className="rw-fig-head">
        <h3 className="rw-fig-title">Clearing a waypoint, step by step</h3>
        <div className="rw-legend">
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--purple" />
            Your team
          </span>
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--moss" />
            Cleared
          </span>
        </div>
      </div>

      <svg
        viewBox="0 0 640 210"
        className="rw-stage"
        role="img"
        aria-label="A team walks to a waypoint, GPS confirms the arrival, the waypoint hands over a photo challenge, the photo clears it, and the team walks on to the next waypoint."
      >
        {/* The road on: shut while the challenge stands, open once it falls. */}
        <line x1={170} y1={130} x2={500} y2={130} className="rw-road cl-road-locked" />
        <line x1={170} y1={130} x2={500} y2={130} className="rw-road cl-road-open" />

        {/* Padlock sitting on the road. */}
        <g className="cl-lock">
          <path d="M 328 122 v -6 a 7 7 0 0 1 14 0 v 6" className="rw-lock" />
          <rect x={324} y={122} width={22} height={16} rx={3} className="rw-lock-body" />
        </g>

        {/* GPS catchment closing in on the waypoint. */}
        <circle cx={170} cy={130} r={22} className="cl-gps" />

        {/* Where you stand. */}
        <g className="cl-waypoint-a">
          <circle cx={170} cy={130} r={14} className="rw-waypoint-ring" />
          <circle cx={170} cy={130} r={9} className="rw-waypoint-dot cl-waypoint-dot" />
          <text x={170} y={106} className="rw-waypoint-label">
            06
          </text>
          <text x={170} y={158} className="rw-waypoint-name">
            Times Sq
          </text>
        </g>

        {/* Where you are going. */}
        <g>
          <circle cx={500} cy={130} r={14} className="rw-waypoint-ring" />
          <circle cx={500} cy={130} r={9} className="rw-waypoint-dot" />
          <text x={500} y={106} className="rw-waypoint-label">
            10
          </text>
          <text x={500} y={158} className="rw-waypoint-name">
            Roosevelt
          </text>
        </g>

        {/* The prompt the waypoint hands over, and the verdict it gets back. */}
        <g className="cl-card">
          <rect x={236} y={14} width={268} height={62} rx={10} className="rw-card" />
          <text x={252} y={34} className="rw-card-kicker">
            Challenge · 06
          </text>
          <text x={252} y={56} className="rw-card-text">
            Photograph the oldest date you can find.
          </text>
          <rect
            x={236}
            y={14}
            width={268}
            height={62}
            rx={10}
            className="cl-flash"
          />
          <text x={370} y={92} className="rw-status rw-status--moss cl-stamp">
            Cleared · +40 coins
          </text>
        </g>

        {/* You. */}
        <g className="cl-runner">
          <circle cx={170} cy={130} r={9} className="rw-runner-dot rw-runner-dot--purple" />
          <text x={170} y={133} className="rw-runner-label">
            P
          </text>
        </g>
      </svg>

      <ol className="rw-steps">
        {STEPS.map((step, i) => (
          <li key={step} className={`rw-step cl-step cl-step--${i + 1}`}>
            {i + 1}. {step}
          </li>
        ))}
      </ol>
    </figure>
  );
}
