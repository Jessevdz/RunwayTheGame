import { useEffect, useState } from 'react';

/** Desktop screen width breakpoint (768px). */
export const DESKTOP_BREAKPOINT = 768;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_BREAKPOINT}px)`;

/** Returns true when the current viewport matches the desktop breakpoint. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const handler = () => setIsDesktop(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}
