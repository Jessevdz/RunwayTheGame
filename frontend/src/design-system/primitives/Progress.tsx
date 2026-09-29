import React from 'react';
import { ArcMark } from './ArcMark';

export interface ProgressProps {
  value: number;
  max?: number;
  /** Accessible name, since a bar alone says nothing. */
  label: string;
  /** Spoken value, such as "3 of 8 waypoints"; defaults to a percentage. */
  valueText?: string;
  /** Plain bar, Sunset three-band bar, or the Sunset arc drawn in as progress advances. */
  variant?: 'bar' | 'sunset' | 'arc';
  className?: string;
  style?: React.CSSProperties;
}

/** Determinate progress meter, optionally in the Sunset motif. */
export const Progress: React.FC<ProgressProps> = ({
  value,
  max = 100,
  label,
  valueText,
  variant = 'bar',
  className = '',
  style,
}) => {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const percent = Math.round(ratio * 100);

  return (
    <div
      className={`progress progress--${variant} ${className}`.trim()}
      style={{ ...style, '--progress': ratio } as React.CSSProperties}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.min(safeMax, Math.max(0, value))}
      aria-valuetext={valueText ?? `${percent}%`}
    >
      {variant === 'arc' ? (
        <ArcMark animate={false} className="progress__arc" />
      ) : (
        <span className="progress__track">
          <span className="progress__fill" />
        </span>
      )}
    </div>
  );
};
