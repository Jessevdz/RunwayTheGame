import React from 'react';

export interface TooltipProps {
  label: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Tooltip: React.FC<TooltipProps> = ({
  label,
  children,
  className = '',
  style,
}) => {
  return (
    <div className={`tooltip ${className}`.trim()} style={style}>
      {children}
      <span className="tooltip__bubble" role="tooltip">
        {label}
      </span>
    </div>
  );
};
