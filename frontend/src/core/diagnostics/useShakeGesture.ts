/**
 * Shake-to-report. This game is played outdoors, walking, one-handed, often
 * with the phone half out of a pocket — a gesture is the difference between a
 * bug that gets reported and one the tester means to mention later and forgets.
 */
import { useEffect, useRef } from 'react';

/** Acceleration delta, in m/s², that counts as a deliberate shake. */
const SHAKE_THRESHOLD = 22;

/** Quiet period after a shake fires, so one wobble is not three reports. */
const COOLDOWN_MS = 2000;

/**
 * Calls onShake when the device is shaken.
 *
 * iOS 13+ gates DeviceMotion behind a permission prompt that only a user
 * gesture may request, so this listens without asking: on browsers that supply
 * motion freely it works, and on the others the button and hotkey still do.
 */
export function useShakeGesture(enabled: boolean, onShake: () => void): void {
  const onShakeRef = useRef(onShake);
  useEffect(() => {
    onShakeRef.current = onShake;
  }, [onShake]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return;

    let last = { x: 0, y: 0, z: 0 };
    let lastFired = 0;
    let primed = false;

    const handle = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;

      const current = { x: a.x, y: a.y, z: a.z };
      if (!primed) {
        last = current;
        primed = true;
        return;
      }

      const delta =
        Math.abs(current.x - last.x) +
        Math.abs(current.y - last.y) +
        Math.abs(current.z - last.z);
      last = current;

      const now = Date.now();
      if (delta > SHAKE_THRESHOLD && now - lastFired > COOLDOWN_MS) {
        lastFired = now;
        onShakeRef.current();
      }
    };

    window.addEventListener('devicemotion', handle);
    return () => window.removeEventListener('devicemotion', handle);
  }, [enabled]);
}
