import React from 'react';

export interface BadgeProps {
  tone?: 'gold' | 'rust' | 'moss' | 'crimson' | 'neutral';
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  children,
  className = '',
  style,
}) => {
  return (
    <span
      className={`badge badge--${tone} ${className}`.trim()}
      style={style}
    >
      {children}
    </span>
  );
};
