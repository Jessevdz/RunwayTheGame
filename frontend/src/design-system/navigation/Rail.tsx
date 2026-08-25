import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../theme/useTheme';
import { Button } from '../primitives/Button';

export interface RailItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}

export interface RailProps {
  title?: string;
  onTitleClick?: () => void;
  items?: RailItem[];
  ctaLabel?: string;
  onCtaClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Rail: React.FC<RailProps> = ({
  title = 'RUNWAY',
  onTitleClick,
  items = [],
  ctaLabel,
  onCtaClick,
  className = '',
  style,
}) => {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleTitleClick = () => {
    if (onTitleClick) {
      onTitleClick();
    } else {
      navigate('/');
    }
  };

  return (
    <aside className={`rail ${className}`.trim()} style={style}>
      <div className="rail__header">
        <button
          type="button"
          className="rail__brand-btn"
          onClick={handleTitleClick}
          aria-label="Go to landing page"
        >
          <h2 className="t-announce fs-7">{title}</h2>
        </button>
      </div>
      <nav className="rail__nav">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rail__item ${item.active ? 'active' : ''}`}
            onClick={item.onClick}
          >
            {item.icon && <span>{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="rail__footer">
        {ctaLabel && (
          <Button variant="primary" size="md" onClick={onCtaClick}>
            {ctaLabel}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={toggleTheme}>
          Theme: {theme === 'night' ? 'Night Flight' : 'Terminal'}
        </Button>
      </div>
    </aside>
  );
};
