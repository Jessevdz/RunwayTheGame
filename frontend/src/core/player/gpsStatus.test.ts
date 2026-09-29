import { describe, expect, it } from 'vitest';
import { describeGps, STALE_AFTER_MS, WEAK_ACCURACY_M } from './gpsStatus';

const fix = (accuracy: number) => ({ lat: 51, lon: 4, accuracy });
const NOW = 1_000_000;

describe('describeGps', () => {
  it('reports a searching state before the first fix', () => {
    const status = describeGps({ position: null, error: null, lastFixAt: null, now: NOW });
    expect(status.state).toBe('searching');
    expect(status.blocked).toBe(true);
  });

  it('reports a denied permission from the watch error', () => {
    const status = describeGps({
      position: null,
      error: { code: 1, message: 'User denied Geolocation' },
      lastFixAt: null,
      now: NOW
    });
    expect(status.state).toBe('denied');
    expect(status.detail).toMatch(/settings/i);
    expect(status.blocked).toBe(true);
  });

  it('reports a denied permission from the permission state alone', () => {
    const status = describeGps({ position: null, error: null, lastFixAt: null, now: NOW, permission: 'denied' });
    expect(status.state).toBe('denied');
  });

  it('trusts a live fix over a permission report that says denied', () => {
    const status = describeGps({ position: fix(5), error: null, lastFixAt: NOW, now: NOW, permission: 'denied' });
    expect(status.state).toBe('good');
  });

  it('reports unavailable when the phone cannot locate itself', () => {
    const status = describeGps({ position: null, error: { code: 2, message: 'x' }, lastFixAt: null, now: NOW });
    expect(status.state).toBe('unavailable');
  });

  it('ignores a timeout once a fix exists', () => {
    const status = describeGps({ position: fix(8), error: { code: 3, message: 'timeout' }, lastFixAt: NOW, now: NOW });
    expect(status.state).toBe('good');
    expect(status.label).toBe('GPS ±8 m');
  });

  it('flags a fuzzy fix as weak and shows the accuracy', () => {
    const status = describeGps({ position: fix(WEAK_ACCURACY_M + 15), error: null, lastFixAt: NOW, now: NOW });
    expect(status.state).toBe('weak');
    expect(status.label).toContain('45');
    expect(status.blocked).toBe(false);
  });

  it('calls a fix lost once it is older than the stale window', () => {
    const status = describeGps({
      position: fix(5),
      error: null,
      lastFixAt: NOW - STALE_AFTER_MS - 1,
      now: NOW
    });
    expect(status.state).toBe('stale');
  });
});
