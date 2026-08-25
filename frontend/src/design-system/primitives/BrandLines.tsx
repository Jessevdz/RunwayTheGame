import React from 'react';

export interface BrandLinesProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Three straight lines in the brand motif (red, orange, amber).
 */
export const BrandLines: React.FC<BrandLinesProps> = ({
  size = 24,
  className = '',
  style,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`brand-lines ${className}`.trim()}
    style={style}
    role="img"
    aria-label="Brand motif"
  >
    <line x1="3" y1="6" x2="21" y2="6" stroke="var(--red)" strokeWidth="3" strokeLinecap="round" />
    <line x1="3" y1="12" x2="21" y2="12" stroke="var(--orange)" strokeWidth="3" strokeLinecap="round" />
    <line x1="3" y1="18" x2="21" y2="18" stroke="var(--amber)" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
