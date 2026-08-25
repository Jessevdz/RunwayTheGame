import React from 'react';

export interface CardProps {
  interactive?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export const Card: React.FC<CardProps> = ({
  interactive = false,
  children,
  style,
  className = '',
}) => {
  return (
    <div
      className={`card ${interactive ? 'card--interactive' : ''} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
};
