import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { watchPlayerLocation, type GPSPosition } from './locationService';
import { describeGps, type GpsErrorInfo, type GpsStatus } from './gpsStatus';
import { useFieldPermissions } from './fieldPermissions';

/** How often a repeated fix is allowed to refresh the last-seen time, so a stationary phone does not re-render constantly. */
const FIX_STAMP_INTERVAL_MS = 10_000;

/** How often the status is re-read so a silent GPS eventually reads as lost. */
const STATUS_TICK_MS = 5_000;

export interface GpsWatch {
  position: GPSPosition | null;
  error: GpsErrorInfo | null;
  /** Epoch ms of the last fix, refreshed at most every ten seconds. */
  lastFixAt: number | null;
  /** The freshest fix, readable from timers without re-rendering. */
  latestRef: MutableRefObject<GPSPosition | null>;
}

/** Watches the phone's position while enabled; nothing here leaves the device. */
export function useGpsWatch(enabled: boolean): GpsWatch {
  const [position, setPosition] = useState<GPSPosition | null>(null);
  const [error, setError] = useState<GpsErrorInfo | null>(null);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const latestRef = useRef<GPSPosition | null>(null);
  const stampRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    return watchPlayerLocation(
      (pos) => {
        const prev = latestRef.current;
        latestRef.current = pos;
        setError(null);
        const now = Date.now();
        if (now - stampRef.current >= FIX_STAMP_INTERVAL_MS) {
          stampRef.current = now;
          setLastFixAt(now);
        }
        // A repeated fix carries no new information, so it should not re-render the shell.
        if (prev && prev.lat === pos.lat && prev.lon === pos.lon && prev.accuracy === pos.accuracy) return;
        setPosition(pos);
      },
      (err) => setError({ code: err.code, message: err.message })
    );
  }, [enabled]);

  return { position, error, lastFixAt, latestRef };
}

/** Reads a GPS watch as one plain status, re-checking on a slow tick so a dead signal shows up. */
export function useGpsStatus(watch: Pick<GpsWatch, 'position' | 'error' | 'lastFixAt'>): GpsStatus {
  const { geolocation } = useFieldPermissions();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (watch.lastFixAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    return () => clearInterval(timer);
  }, [watch.lastFixAt]);

  return describeGps({
    position: watch.position,
    error: watch.error,
    lastFixAt: watch.lastFixAt,
    now: Math.max(now, watch.lastFixAt ?? 0),
    permission: geolocation
  });
}
