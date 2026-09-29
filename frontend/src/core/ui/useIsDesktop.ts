import { useEffect, useState } from 'react';

/** Desktop breakpoint: 48rem, the same value every stylesheet uses. */
export const DESKTOP_BREAKPOINT_REM = 48;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_BREAKPOINT_REM}rem)`;

/** Exact complement of the desktop query, so exactly one of the two matches at any width. */
export const MOBILE_QUERY = `(width < ${DESKTOP_BREAKPOINT_REM}rem)`;

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
