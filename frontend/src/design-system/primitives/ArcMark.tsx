import React from 'react';

export interface ArcMarkProps {
  /** Whether to animate band drawing on mount. */
  animate?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/* Path lengths fed to CSS animation offset. */
const BANDS = [
  { d: 'M4 60 C 60 8, 180 8, 236 60', stroke: 'var(--red)', len: 260, cls: '' },
  { d: 'M4 72 C 60 20, 180 20, 236 72', stroke: 'var(--orange)', len: 260, cls: 'draw--2' },
  { d: 'M4 84 C 60 32, 180 32, 236 84', stroke: 'var(--amber)', len: 260, cls: 'draw--3' },
];

/** Decorative triple-banded section divider SVG. */
export const ArcMark: React.FC<ArcMarkProps> = ({ animate = true, className = '', style }) => {
  return (
    <svg
      className={`arc-mark ${className}`.trim()}
      style={style}
      viewBox="0 0 240 92"
      role="presentation"
      aria-hidden="true"
    >
      {BANDS.map((band) => (
        <path
          key={band.stroke}
          className={`arc-band ${animate ? `draw ${band.cls}` : ''}`.trim()}
          d={band.d}
          stroke={band.stroke}
          strokeWidth={6}
          style={{ '--len': band.len } as React.CSSProperties}
        />
      ))}
    </svg>
  );
};
