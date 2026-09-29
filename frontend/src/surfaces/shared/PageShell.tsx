import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TopBar, type TopBarProps } from './TopBar';
import { Rail, BottomNav, Button, Notice, Skeleton, type RailItem, type BottomNavSlot, Icon, type IconName } from '@ds';
import { isImmersiveRoute } from '../../core/ui/immersiveRoutes';

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
  icon: IconName;
  path: string;
}

/** Top-level navigation destinations for primary application routes. */
const DESTINATIONS: NavDestination[] = [
  { id: 'home', label: 'Home', icon: 'home', path: '/' },
  { id: 'design', label: 'Design', icon: 'map', path: '/design' },
  { id: 'races', label: 'Races', icon: 'flag', path: '/races' },
  { id: 'gallery', label: 'Gallery', icon: 'target', path: '/gallery' },
  { id: 'roadmap', label: 'Roadmap', icon: 'compass', path: '/roadmap' },
];

/** Phone bottom navigation; the other destinations live in the header menu. */
const BOTTOM_DESTINATIONS: NavDestination[] = [
  { id: 'home', label: 'Home', icon: 'home', path: '/' },
  { id: 'join', label: 'Join', icon: 'ticket', path: '/#join' },
  { id: 'races', label: 'Races', icon: 'flag', path: '/races' },
  { id: 'host', label: 'Host', icon: 'pin', path: '/host' },
];

/** Destinations reachable from the phone header menu. */
const MENU_DESTINATIONS: NavDestination[] = [
  { id: 'gallery', label: 'Gallery', icon: 'target', path: '/gallery' },
  { id: 'design', label: 'Design a map (desktop)', icon: 'map', path: '/design' },
  { id: 'roadmap', label: 'Roadmap', icon: 'compass', path: '/roadmap' },
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
  const { pathname, hash } = useLocation();
  const immersive = isImmersiveRoute(pathname);

  const destinations = nav
    ? DESTINATIONS.map((d) => ({
      id: d.id,
      label: d.label,
      icon: <Icon name={d.icon} />,
      active: isActive(pathname, d.path),
      onClick: () => navigate(d.path),
    }))
    : undefined;

  const bottomDestinations = nav
    ? BOTTOM_DESTINATIONS.map((d) => ({
      id: d.id,
      label: d.label,
      icon: <Icon name={d.icon} />,
      active:
        d.id === 'join'
          ? pathname === '/' && hash === '#join'
          : d.id === 'home'
            ? pathname === '/' && hash !== '#join'
            : isActive(pathname, d.path),
      onClick: () => navigate(d.path),
    }))
    : undefined;

  const menuItems = nav
    ? MENU_DESTINATIONS.map((d) => ({
      id: d.id,
      label: d.label,
      icon: <Icon name={d.icon} />,
      active: isActive(pathname, d.path),
      onClick: () => navigate(d.path),
    }))
    : undefined;

  const inTopBar = navPlacement === 'topbar';
  const resolvedRailItems = inTopBar ? undefined : railItems ?? destinations;
  const resolvedTopBarNav = inTopBar ? destinations : undefined;
  const resolvedNavSlots = immersive ? undefined : bottomNavSlots ?? bottomDestinations;

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

        {topBarProps && <TopBar navItems={resolvedTopBarNav} menuItems={immersive ? undefined : menuItems} {...topBarProps} />}

        <main className="page-shell__main">
          {loading ? (
            <div className="page-shell__loading" role="status" aria-label="Loading">
              <Skeleton variant="block" height="var(--sp-8)" />
              <Skeleton variant="text" lines={3} />
              <Skeleton variant="block" height="var(--sp-8)" />
            </div>
          ) : error ? (
            <Notice kind="stop" title="That didn't load" className="page-shell__error">
              <p className="fs-5">{error}</p>
              {onRetry && (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </Notice>
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
