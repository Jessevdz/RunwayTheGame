import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme, IconButton, LinkButton, IconBook } from '@ds';
import { docsUrl } from '../../core/docs';

export interface TopBarNavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

export interface TopBarProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Optional click handler for title/wordmark. Defaults to navigating to '/'. */
  onTitleClick?: () => void;
  /** Primary destinations, shown inline beside the wordmark on desktop. Surfaces
      that carry their nav here render no Rail — one header, one nav. */
  navItems?: TopBarNavItem[];
  actions?: React.ReactNode;
  showDocsLink?: boolean;
  showThemeToggle?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  subtitle,
  onTitleClick,
  navItems,
  actions,
  showDocsLink = true,
  showThemeToggle = true,
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
    <header className={`topbar ${className}`.trim()} style={style}>
      <div className="topbar__lead">
        {title ? (
          <button
            type="button"
            className="topbar__brand-btn"
            onClick={handleTitleClick}
            aria-label="Go to landing page"
          >
            {typeof title === 'string' ? (
              <span className="t-announce fs-7">{title}</span>
            ) : (
              title
            )}
          </button>
        ) : null}
        {subtitle && <div className="t-label fs-label">{subtitle}</div>}
      </div>

      {navItems && navItems.length > 0 && (
        <nav className="topbar__nav" aria-label="Primary">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`topbar__link ${item.active ? 'active' : ''}`.trim()}
              aria-current={item.active ? 'page' : undefined}
              onClick={item.onClick}
            >
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="topbar__actions no-scrollbar">
        {showDocsLink && (
          <LinkButton
            href={docsUrl()}
            variant="ghost"
            size="sm"
            className="btn--icon"
            title="Documentation"
            aria-label="Documentation"
          >
            <IconBook />
          </LinkButton>
        )}
        {actions}
        {showThemeToggle && (
          <IconButton
            icon={theme === 'night' ? '🌙' : '☀️'}
            label="Toggle theme"
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            style={{ minWidth: '2.25rem', paddingInline: 'var(--sp-2)' }}
          />
        )}
      </div>
    </header>
  );
};
