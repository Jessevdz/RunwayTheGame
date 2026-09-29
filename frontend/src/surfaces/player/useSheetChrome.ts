import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SheetSnap } from '@ds';

const STORE_KEY = 'runway:player:sheet:v2';

/** DESIGN.md sanctions exactly two breakpoints; this is the md one. */
const PHONE_QUERY = '(max-width: 47.9375rem)';

/** The three rest positions the panel can hold. */
const SNAPS: readonly SheetSnap[] = ['collapsed', 'peek', 'expanded'];

const isSnap = (value: unknown): value is SheetSnap => SNAPS.includes(value as SheetSnap);

const readSnap = (): SheetSnap => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return isSnap(raw) ? raw : 'collapsed';
  } catch {
    return 'collapsed';
  }
};

const subscribePhone = (onChange: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
};

const readPhone = () => (typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY).matches : false);

/** True below the md breakpoint, where the console is a bottom sheet rather than a side pane. */
export const useIsPhone = (): boolean => useSyncExternalStore(subscribePhone, readPhone, () => false);

/** Which snap the race panel rests at, remembered between sessions; the drag itself lives in the design-system Sheet. */
export const usePlayerSheet = () => {
  const [snap, setSnapState] = useState<SheetSnap>(readSnap);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, snap);
    } catch {
      /* private mode — the sheet still works, it just forgets */
    }
  }, [snap]);

  const setSnap = useCallback((next: SheetSnap) => setSnapState(next), []);

  /** Opens a collapsed panel to its peek height and leaves an already open one alone. */
  const openToPeek = useCallback(() => {
    if (snapRef.current === 'collapsed') setSnapState('peek');
  }, []);

  return { snap, setSnap, openToPeek };
};

/**
 * Opens a collapsed panel and restarts the action pulse each time the alert
 * key moves to a new value; a key already present at mount does not fire.
 */
export const useSheetAttention = (alertKey: string | null, openToPeek: () => void): number => {
  const [pulseKey, setPulseKey] = useState(0);
  const seenRef = useRef<string | null>(alertKey);

  useEffect(() => {
    if (alertKey === seenRef.current) return;
    seenRef.current = alertKey;
    if (!alertKey) return;
    setPulseKey((k) => k + 1);
    openToPeek();
  }, [alertKey, openToPeek]);

  return pulseKey;
};
