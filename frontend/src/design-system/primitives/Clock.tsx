import React from 'react';
import { Flap } from './Flap';
import { formatClockFace, spokenClock } from './clockFormat';

export interface ClockProps {
  /** Whole seconds to show; negatives clamp to zero and fractions floor. */
  seconds: number;
  /** Renders on split-flap tiles instead of plain tabular digits. */
  flap?: boolean;
  /** Glance sizes for the outdoor readout. */
  size?: 'md' | 'lg' | 'xl';
  /** Small caption under the time, such as "Time left". */
  caption?: string;
  /** Overrides the spoken text when the plain time is not the whole story. */
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** Glance-size tabular clock for countdowns and run timers. */
export const Clock: React.FC<ClockProps> = ({
  seconds,
  flap = false,
  size = 'lg',
  caption,
  ariaLabel,
  className = '',
  style,
}) => {
  const text = formatClockFace(seconds);
  return (
    <div
      className={`clock clock--${size}${flap ? ' clock--flap' : ''} ${className}`.trim()}
      style={style}
      role="timer"
      aria-label={ariaLabel ?? spokenClock(seconds)}
    >
      {flap ? (
        <span className="clock__face" aria-hidden="true">
          <Flap value={text} />
        </span>
      ) : (
        <span className="clock__face t-data" aria-hidden="true">
          {text}
        </span>
      )}
      {caption && <span className="clock__caption">{caption}</span>}
    </div>
  );
};
