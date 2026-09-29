import React from 'react';
import { BrandLines } from './BrandLines';

export interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
  /** Hides the RUNWAY wordmark and keeps only the three-line motif. */
  iconOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const ICON_SIZE = { sm: 20, md: 24, lg: 32 } as const;

/** The three-line motif plus the RUNWAY wordmark, non-interactive so a parent can wrap it in a link or button. */
export const BrandMark: React.FC<BrandMarkProps> = ({ size = 'md', iconOnly = false, className = '', style }) => (
  <span className={`brand-mark brand-mark--${size} ${className}`.trim()} style={style}>
    <span className="brand-mark__icon" aria-hidden="true">
      <BrandLines size={ICON_SIZE[size]} />
    </span>
    {iconOnly ? (
      <span className="u-visually-hidden">Runway</span>
    ) : (
      <span className="brand-mark__text t-announce">RUNWAY</span>
    )}
  </span>
);
