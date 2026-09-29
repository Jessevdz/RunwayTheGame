import type { GPSPosition } from './locationService';

/** Everything a phone can say about its own position, from best to worst. */
export type GpsState = 'good' | 'weak' | 'searching' | 'stale' | 'denied' | 'unavailable';

/** Accuracy in metres above which a fix is too fuzzy to trust for arrivals. */
export const WEAK_ACCURACY_M = 30;

/** How long without a new fix before the position counts as lost. */
export const STALE_AFTER_MS = 45_000;

export interface GpsErrorInfo {
  /** Geolocation error code: 1 denied, 2 unavailable, 3 timeout. */
  code: number;
  message: string;
}

export interface GpsStatus {
  state: GpsState;
  /** A few words for a chip. */
  label: string;
  /** A full sentence saying what is wrong and what to do, or empty when nothing is. */
  detail: string;
  tone: 'moss' | 'gold' | 'crimson' | 'neutral';
  /** True when no arrival or challenge can work until this is fixed by the player. */
  blocked: boolean;
}

export interface GpsStatusInput {
  position: GPSPosition | null;
  error: GpsErrorInfo | null;
  /** Epoch ms of the last fix, or null when none has arrived. */
  lastFixAt: number | null;
  now: number;
  /** What the browser reports for the location permission, when it reports anything. */
  permission?: 'granted' | 'denied' | 'prompt' | 'unknown';
}

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;

/** Turns raw geolocation facts into one status a player can read at a glance. */
export function describeGps({ position, error, lastFixAt, now, permission = 'unknown' }: GpsStatusInput): GpsStatus {
  // A fix in hand outranks a permission report, which some browsers get wrong.
  if ((permission === 'denied' && !position) || error?.code === PERMISSION_DENIED) {
    return {
      state: 'denied',
      label: 'Location off',
      detail: 'Location is blocked for Runway. Turn it on in your browser settings, then reload, so we can tell when you arrive.',
      tone: 'crimson',
      blocked: true
    };
  }

  if (!position) {
    if (error?.code === POSITION_UNAVAILABLE) {
      return {
        state: 'unavailable',
        label: 'No GPS',
        detail: 'This phone cannot find its position right now. Step into the open and check that location services are on.',
        tone: 'crimson',
        blocked: true
      };
    }
    return {
      state: 'searching',
      label: 'Finding GPS',
      detail: 'Looking for your position. Step into the open and give it a few seconds.',
      tone: 'gold',
      blocked: true
    };
  }

  if (lastFixAt !== null && now - lastFixAt > STALE_AFTER_MS) {
    return {
      state: 'stale',
      label: 'GPS lost',
      detail: 'No position update for a while. Move into the open and we will pick it back up.',
      tone: 'gold',
      blocked: false
    };
  }

  const metres = Math.round(position.accuracy);
  if (position.accuracy > WEAK_ACCURACY_M) {
    return {
      state: 'weak',
      label: `Weak GPS ±${metres} m`,
      detail: `GPS is only accurate to about ${metres} m, so arriving may take a moment.`,
      tone: 'gold',
      blocked: false
    };
  }

  return { state: 'good', label: `GPS ±${metres} m`, detail: '', tone: 'moss', blocked: false };
}
