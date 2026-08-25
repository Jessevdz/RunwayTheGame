import React from 'react';

export interface HeroProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Hero: React.FC<HeroProps> = ({ children, className = '', style }) => {
  return (
    <div className={`hero ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};
