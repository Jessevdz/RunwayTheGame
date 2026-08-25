import React from 'react';

export interface PlateProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Plate: React.FC<PlateProps> = ({ children, className = '', style }) => {
  return (
    <div className={`plate ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};
