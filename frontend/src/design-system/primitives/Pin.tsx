import React from 'react';

export interface PinProps {
  tone?: 'accent' | 'gold' | 'moss';
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Pin: React.FC<PinProps> = ({
  tone = 'accent',
  children,
  className = '',
  style,
}) => {
  const toneClass = tone === 'gold' ? 'pin--gold' : tone === 'moss' ? 'pin--moss' : '';
  return (
    <span className={`pin ${toneClass} ${className}`.trim()} style={style}>
      {children}
    </span>
  );
};
