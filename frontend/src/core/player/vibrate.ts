export type VibrationKind = 'arrived' | 'cleared' | 'finished' | 'won';

/** Buzz pattern per moment, in milliseconds on and off. */
const VIBRATION: Record<VibrationKind, number[]> = {
  arrived: [60],
  cleared: [80, 60, 80],
  finished: [120, 80, 120, 80, 240],
  won: [120, 80, 120, 80, 240]
};

/** Buzzes the phone where it can; a no-op elsewhere. */
export const vibrateFor = (kind: VibrationKind): void => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(VIBRATION[kind]);
  } catch {
    // Some browsers refuse vibration without a recent tap.
  }
};
