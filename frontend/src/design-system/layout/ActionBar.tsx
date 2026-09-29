import React from 'react';

export interface ActionBarProps {
  /** Sticky sits at the foot of its scroll parent; fixed pins to the viewport. */
  position?: 'sticky' | 'fixed';
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Bottom bar for a screen's primary actions, padded for the home indicator. */
export const ActionBar: React.FC<ActionBarProps> = ({ position = 'sticky', children, className = '', style }) => (
  <div className={`action-bar action-bar--${position} ${className}`.trim()} style={style}>
    {children}
  </div>
);
