import React from 'react';

export interface HexProps {
  size?: 'sm' | 'md' | 'lg';
  /** `player` is the orange→red gradient, `seek` the amber→orange one. */
  variant?: 'player' | 'seek';
  /** Large figure inside the hex. */
  num?: React.ReactNode;
  /** Tracked caption under the figure. */
  kicker?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Pointy-top hexagonal marker for player and status indicators. */
export const Hex: React.FC<HexProps> = ({
  size = 'md',
  variant,
  num,
  kicker,
  children,
  className = '',
  style,
}) => {
  const sizeClass = size === 'sm' ? 'hex--sm' : size === 'lg' ? 'hex--lg' : '';
  const variantClass = variant ? `hex--${variant}` : '';

  return (
    <div
      className={`hex ${sizeClass} ${variantClass} ${className}`.replace(/\s+/g, ' ').trim()}
      style={style}
    >
      {num !== undefined && <span className="hex__num">{num}</span>}
      {kicker !== undefined && <span className="hex__kicker">{kicker}</span>}
      {children}
    </div>
  );
};
