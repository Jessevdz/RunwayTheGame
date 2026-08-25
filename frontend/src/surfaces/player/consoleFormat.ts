/** Formatting utilities for console numbers, ordinals, and units. */

/** Returns seconds until specified ISO timestamp, floored at zero. */
export const secondsUntil = (iso: string | undefined | null, now: number): number =>
  iso ? Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000)) : 0;

/** Formats ordinal number string (e.g. 1st, 2nd, 3rd, 4th). */
export const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

/** Converts full unit strings to compact unit symbols. */
export const peekUnit = (unit: string): string =>
  unit.startsWith('metres') ? 'm' : unit.startsWith('km') ? 'km' : '';

export const formatDistance = (metres: number): { value: string; unit: string } =>
  metres < 1000
    ? { value: String(Math.round(metres)), unit: 'metres away' }
    : { value: (metres / 1000).toFixed(1), unit: 'km away' };
