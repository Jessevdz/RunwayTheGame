import React from 'react';

export interface BottomNavSlot {
  id: string;
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

export interface BottomNavProps {
  slots: BottomNavSlot[];
  className?: string;
  style?: React.CSSProperties;
}

/** Mobile primary navigation bar with active indicator pill. */
export const BottomNav: React.FC<BottomNavProps> = ({ slots, className = '', style }) => (
  <nav className={`bottomnav ${className}`.trim()} aria-label="Primary" style={style}>
    {slots.map((slot) => (
      <button
        key={slot.id}
        type="button"
        className={`bottomnav__slot ${slot.active ? 'active' : ''}`.trim()}
        aria-current={slot.active ? 'page' : undefined}
        onClick={slot.onClick}
      >
        {slot.icon && (
          <span className="bottomnav__icon" aria-hidden="true">
            {slot.icon}
          </span>
        )}
        <span className="bottomnav__label">{slot.label}</span>
      </button>
    ))}
  </nav>
);
