const pad = (n: number) => String(n).padStart(2, '0');

const split = (seconds: number) => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
};

/** Formats seconds as mm:ss, or h:mm:ss from one hour up. */
export const formatClockFace = (seconds: number): string => {
  const { h, m, s } = split(seconds);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Formats seconds the way a screen reader should say them, for example "4 minutes 21 seconds". */
export const spokenClock = (seconds: number): string => {
  const { h, m, s } = split(seconds);
  const parts = [h > 0 ? unit(h, 'hour') : '', h > 0 || m > 0 ? unit(m, 'minute') : '', unit(s, 'second')];
  return parts.filter(Boolean).join(' ');
};
