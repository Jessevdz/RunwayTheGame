import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { analytics } from './analyticsClient';
import { currentViewport } from './events';

/** Maps pathnames to coarse surface labels, returning null for unrecognized paths. */
function surfaceFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const [first, , third] = segments;

  if (path === '/') return 'landing';

  switch (first) {
    case 'gallery':
      return 'gallery';
    // Handle admin subroutes under roadmap.
    case 'roadmap':
      return segments[1] === 'admin' ? 'admin' : 'roadmap';
    case 'admin':
      return 'admin';
    case 'design':
      return 'design';
    case 'races':
      return 'races';
    // Map host, join, and live subroutes to surface categories.
    case 'host':
      if (segments.length === 1) return 'host';
      return third === 'live' ? null : 'lobby';
    case 'join':
      return 'lobby';
    case 'solo':
      return 'solo';
    case 'race':
      return third === 'report' ? 'report' : 'race';
    default:
      return null;
  }
}

/** Hook emitting surface view events on route changes. */
export function useSurfaceAnalytics(): void {
  const { pathname } = useLocation();
  const lastSurface = useRef<string | null>(null);

  useEffect(() => {
    const surface = surfaceFor(pathname);
    if (!surface || surface === lastSurface.current) return;
    lastSurface.current = surface;
    analytics.track('app.surface_opened', { surface, viewport: currentViewport() });
  }, [pathname]);
}
