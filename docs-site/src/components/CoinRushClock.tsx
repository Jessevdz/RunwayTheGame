import './anim.css';
import './CoinRushClock.css';

/**
 * CoinRushClock — why crossing the line first is not the same as winning a coin
 * rush. The axis here is the race clock, not the board: Orange banks a
 * placement bonus and stops earning; Purple keeps working the countdown.
 */

export default function CoinRushClock() {
  return (
    <figure className="rw-fig cr">
      <div className="rw-fig-head">
        <h3 className="rw-fig-title">Coin rush: the line is a scoring event</h3>
        <div className="rw-legend">
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--purple" />
            Purple&rsquo;s coins
          </span>
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--orange" />
            Orange&rsquo;s coins
          </span>
          <span className="rw-key">
            <span className="rw-swatch rw-swatch--amber" />
            Countdown
          </span>
        </div>
      </div>

      <svg
        viewBox="0 0 640 236"
        className="rw-stage"
        role="img"
        aria-label="Orange crosses the finish line first, takes a placement bonus, and stops earning. Purple keeps clearing challenges during the countdown and holds more coins when the race is called."
      >
        {/* Purple's pile. */}
        <text x={96} y={66} className="cr-row-label">
          PURPLE
        </text>
        <rect x={110} y={48} width={440} height={26} rx={6} className="cr-track" />
        <rect x={110} y={48} height={26} rx={6} className="cr-bar cr-bar--purple" />

        {/* Orange's pile. */}
        <text x={96} y={122} className="cr-row-label">
          ORANGE
        </text>
        <rect x={110} y={104} width={440} height={26} rx={6} className="cr-track" />
        <rect x={110} y={104} height={26} rx={6} className="cr-bar cr-bar--orange" />

        <text x={378} y={122} className="rw-status rw-status--orange cr-locked">
          finished · earns nothing further
        </text>
        <text x={140} y={94} className="rw-status rw-status--moss cr-winner">
          most coins when the race is called
        </text>

        {/* The race clock. */}
        <line x1={110} y1={180} x2={550} y2={180} className="rw-road" />
        <rect x={308} y={174} height={12} rx={4} className="cr-countdown" />
        <line x1={308} y1={166} x2={308} y2={194} className="cr-tick" />
        <line x1={550} y1={166} x2={550} y2={194} className="cr-tick" />

        <text x={308} y={212} className="cr-axis">
          Orange crosses
        </text>
        <text x={550} y={212} className="cr-axis cr-axis--end">
          race called
        </text>
        <text x={110} y={212} className="cr-axis cr-axis--start">
          start
        </text>

        <g className="cr-playhead">
          <circle cx={110} cy={180} r={5} />
        </g>
      </svg>

      <figcaption className="rw-cap">
        Crossing pays a placement bonus and locks you out of the economy; the rest
        of the field then has a countdown to finish. A detour to a high-paying
        challenge stops being a mistake and becomes a bet.
      </figcaption>
    </figure>
  );
}
