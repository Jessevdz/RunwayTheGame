import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme, IconButton, LinkButton, Icon, BrandMark, Dialog } from '@ds';
import { docsUrl } from '../../core/docs';
import { isImmersiveRoute } from '../../core/ui/immersiveRoutes';

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
  /** Secondary destinations shown behind a menu button on phones. */
  menuItems?: TopBarNavItem[];
  actions?: React.ReactNode;
  /** The docs and theme buttons are always hidden on lobby and race routes. */
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
  menuItems,
  actions,
  showDocsLink = true,
  showThemeToggle = true,
  className = '',
  style,
}) => {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const immersive = isImmersiveRoute(pathname);
  const docsVisible = showDocsLink && !immersive;
  const themeVisible = showThemeToggle && !immersive;

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
        {title === undefined ? (
          <button
            type="button"
            className="topbar__brand-btn"
            onClick={handleTitleClick}
            aria-label="Go to landing page"
          >
            <BrandMark />
          </button>
        ) : title ? (
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
        {docsVisible && (
          <LinkButton
            href={docsUrl()}
            variant="ghost"
            size="sm"
            className="btn--icon"
            title="Documentation"
            aria-label="Documentation"
          >
            <Icon name="book" />
          </LinkButton>
        )}
        {actions}
        {themeVisible && (
          <IconButton
            icon={<Icon name={theme === 'night' ? 'moon' : 'sun'} />}
            label="Toggle theme"
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
          />
        )}
        {menuItems && menuItems.length > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--icon topbar__menu-btn"
            aria-label="Menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {menuItems && menuItems.length > 0 && (
        <Dialog open={menuOpen} presentation="sheet" title="Menu" onClose={() => setMenuOpen(false)}>
          <nav className="topbar-menu" aria-label="More destinations">
            {menuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`topbar-menu__item ${item.active ? 'active' : ''}`.trim()}
                aria-current={item.active ? 'page' : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  item.onClick?.();
                }}
              >
                {item.icon && <span aria-hidden="true">{item.icon}</span>}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </Dialog>
      )}
    </header>
  );
};
