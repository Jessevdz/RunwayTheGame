import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TopBar, type TopBarProps } from './TopBar';
import { Rail, BottomNav, Button, type RailItem, type BottomNavSlot } from '@ds';

export interface PageShellProps {
  topBarProps?: TopBarProps;
  railItems?: RailItem[];
  railCtaLabel?: string;
  onRailCtaClick?: () => void;
  bottomNavSlots?: BottomNavSlot[];
  /** Set false to opt out of the app-wide Rail / BottomNav (e.g. the DS gallery). */
  nav?: boolean;
  /** Where the primary destinations live on desktop. `topbar` folds them into the
      TopBar and renders no Rail, so the two never state the same thing twice. */
  navPlacement?: 'rail' | 'topbar';
  /** Set true for the shell-level atmospheric mesh behind a hero (marketing surfaces). */
  heroBackdrop?: boolean;
  documentScroll?: boolean;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

interface NavDestination {
  id: string;
  label: string;
  icon: string;
  path: string;
}

/** Top-level navigation destinations for primary application routes. */
const DESTINATIONS: NavDestination[] = [
  { id: 'home', label: 'Home', icon: '🏠', path: '/' },
  { id: 'design', label: 'Design', icon: '🗺️', path: '/design' },
  { id: 'races', label: 'Races', icon: '🏁', path: '/races' },
  { id: 'gallery', label: 'Gallery', icon: '🎯', path: '/gallery' },
  { id: 'roadmap', label: 'Roadmap', icon: '🧭', path: '/roadmap' },
];

function isActive(pathname: string, path: string): boolean {
  return path === '/' ? pathname === '/' : pathname.startsWith(path);
}

export const PageShell: React.FC<PageShellProps> = ({
  topBarProps,
  railItems,
  railCtaLabel = 'Host a Race',
  onRailCtaClick,
  bottomNavSlots,
  nav = true,
  navPlacement = 'rail',
  heroBackdrop = false,
  documentScroll = true,
  loading = false,
  error = null,
  empty = false,
  emptyMessage = 'No data available',
  onRetry,
  children,
  className = '',
  style,
}) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const destinations = nav
    ? DESTINATIONS.map((d) => ({
      id: d.id,
      label: d.label,
      icon: d.icon,
      active: isActive(pathname, d.path),
      onClick: () => navigate(d.path),
    }))
    : undefined;

  const inTopBar = navPlacement === 'topbar';
  const resolvedRailItems = inTopBar ? undefined : railItems ?? destinations;
  const resolvedTopBarNav = inTopBar ? destinations : undefined;
  const resolvedNavSlots = bottomNavSlots ?? destinations;

  const handleRailCta = onRailCtaClick ?? (() => navigate('/host'));

  const shellClass = [
    'page-shell',
    documentScroll && 'page-shell--doc',
    heroBackdrop && 'page-shell--hero',
    resolvedRailItems && 'page-shell--railed',
    resolvedNavSlots && 'page-shell--navved',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="app-shell">
      {resolvedRailItems && (
        <Rail items={resolvedRailItems} ctaLabel={railCtaLabel} onCtaClick={handleRailCta} />
      )}

      <div className={shellClass} style={style}>
        {heroBackdrop && <div className="page-shell__mesh" aria-hidden="true" />}

        {topBarProps && <TopBar navItems={resolvedTopBarNav} {...topBarProps} />}

        <main className="page-shell__main">
          {loading ? (
            <div className="page-shell__state">
              <span className="t-data fs-5" style={{ color: 'var(--ink-muted)' }}>Loading…</span>
            </div>
          ) : error ? (
            <div className="alert-critical" style={{ margin: 'var(--sp-7) auto', maxWidth: '37.5rem' }}>
              <h3 className="alert-critical-title">Error Encountered</h3>
              <p className="fs-5">{error}</p>
              {onRetry && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              )}
            </div>
          ) : empty ? (
            <div className="page-shell__state" style={{ flexDirection: 'column', gap: 'var(--sp-4)' }}>
              <p className="fs-6" style={{ color: 'var(--ink-muted)' }}>{emptyMessage}</p>
              {onRetry && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Refresh
                </Button>
              )}
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {resolvedNavSlots && <BottomNav slots={resolvedNavSlots} />}
    </div>
  );
};
