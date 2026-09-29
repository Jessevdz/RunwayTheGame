import React from 'react';

export interface SkeletonProps {
  variant?: 'text' | 'block' | 'circle';
  /** Number of text lines; the last one is shorter. */
  lines?: number;
  /** Any CSS length, e.g. a spacing token via var(). */
  width?: string;
  height?: string;
  /** Announces a loading state to screen readers; omit for purely decorative placeholders. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** Shimmering placeholder shown while content loads. */
export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'block',
  lines = 1,
  width,
  height,
  label,
  className = '',
  style,
}) => {
  const a11y = label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true as const };

  if (variant === 'text') {
    const count = Math.max(1, lines);
    return (
      <div className={`skeleton-lines ${className}`.trim()} style={{ width }} {...a11y}>
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className={`skeleton skeleton--text${count > 1 && i === count - 1 ? ' skeleton--short' : ''}`}
            style={{ height, ...style }}
          />
        ))}
      </div>
    );
  }

  return <span className={`skeleton skeleton--${variant} ${className}`.trim()} style={{ width, height, ...style }} {...a11y} />;
};
