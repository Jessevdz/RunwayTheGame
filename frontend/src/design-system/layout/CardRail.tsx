import React from 'react';

export interface CardRailProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const CardRail: React.FC<CardRailProps> = ({ children, className = '', style }) => {
  return (
    <div className={`card-rail no-scrollbar ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};
