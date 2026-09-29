import { useEffect, useState } from 'react';
import { compassHeading, shortestTurn } from './bearing';

/** Smallest change in degrees worth a re-render. */
const MIN_TURN_DEG = 5;

/** Fastest the heading state may update. */
const MIN_INTERVAL_MS = 150;

interface OrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

/** Compass heading of the way the phone faces, or null when the device gives none; it is never sent anywhere. */
export function useDeviceHeading(enabled: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let last: number | null = null;
    let lastAt = 0;

    const publish = (next: number) => {
      const now = Date.now();
      if (now - lastAt < MIN_INTERVAL_MS) return;
      if (last !== null && Math.abs(shortestTurn(last, next)) < MIN_TURN_DEG) return;
      last = next;
      lastAt = now;
      setHeading(next);
    };

    const onOrientation = (event: Event) => {
      const e = event as OrientationEvent;
      if (typeof e.webkitCompassHeading === 'number') {
        publish(e.webkitCompassHeading);
        return;
      }
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      if (event.type === 'deviceorientation' && !e.absolute) return;
      publish(compassHeading(e.alpha, e.beta, e.gamma));
    };

    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [enabled]);

  return heading;
}
