import React from 'react';

export interface ToastProps {
  tone?: 'gold' | 'rust' | 'moss' | 'crimson' | 'neutral';
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Toast: React.FC<ToastProps> = ({
  tone = 'neutral',
  children,
  className = '',
  style,
}) => {
  return (
    <div className={`toast toast--${tone} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};
