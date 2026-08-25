import React from 'react';

export interface GridProps {
  /** Column count at >=1024px. Collapses to 1 below 768px, and 2 between. */
  cols?: 1 | 2 | 3;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Marketing grid on the standardized 768 / 1024 breakpoints. */
export const Grid: React.FC<GridProps> = ({ cols = 2, children, className = '', style }) => {
  const colsClass = cols === 3 ? 'g-3' : cols === 2 ? 'g-2' : '';

  return (
    <div className={`grid ${colsClass} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};
