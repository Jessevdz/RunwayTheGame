import React from 'react';

export interface ChipProps {
  kind?: 'curse' | 'power' | 'challenge' | 'veto' | 'live' | string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Chip: React.FC<ChipProps> = ({ kind, children, className = '', style }) => {
  const kindClass = kind ? `chip--${kind}` : '';
  return (
    <span className={`chip ${kindClass} ${className}`.trim()} style={style}>
      {children}
    </span>
  );
};
