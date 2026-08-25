import React from 'react';

export interface CalloutProps {
  kind?: 'rule' | 'curse' | 'power' | 'veto' | string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Callout: React.FC<CalloutProps> = ({ kind, children, className = '', style }) => {
  const kindClass = kind ? `callout--${kind}` : '';
  return (
    <div className={`callout ${kindClass} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};
