import React from 'react';

export interface FlapProps {
  /** Rendered one tile per character. Digits, letters and ':' all work. */
  value: string;
  /** Characters rendered between tiles rather than on one, e.g. ':' in a clock. */
  separators?: string;
  /** Replays the flip animation whenever `value` changes. */
  animate?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Split-flap display tiles for countdowns and dynamic data. */
export const Flap: React.FC<FlapProps> = ({
  value,
  separators = ':.',
  animate = false,
  className = '',
  style,
}) => {
  const flipClass = animate ? 'flap--flip' : '';

  return (
    <div className={`flap ${flipClass} ${className}`.trim()} style={style} key={animate ? value : undefined}>
      {Array.from(value).map((char, i) =>
        separators.includes(char) ? (
          <i key={i}>{char}</i>
        ) : (
          <span key={i}>{char}</span>
        )
      )}
    </div>
  );
};
