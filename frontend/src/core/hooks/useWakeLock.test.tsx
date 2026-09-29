import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

const makeSentinel = () => {
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
    addEventListener: vi.fn()
  };
  return sentinel;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useWakeLock', () => {
  let request: ReturnType<typeof vi.fn>;
  let sentinels: ReturnType<typeof makeSentinel>[];

  beforeEach(() => {
    sentinels = [];
    request = vi.fn(async () => {
      const s = makeSentinel();
      sentinels.push(s);
      return s;
    });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  });

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('requests a screen lock while active and releases it on unmount', async () => {
    const { unmount } = renderHook(() => useWakeLock(true));
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    unmount();
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('does nothing while inactive', async () => {
    renderHook(() => useWakeLock(false));
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('releases when the race stops being active', async () => {
    const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } });
    await flush();
    rerender({ on: false });
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('re-acquires after the tab returns and the system dropped the lock', async () => {
    renderHook(() => useWakeLock(true));
    await flush();
    sentinels[0].released = true;
    setVisibility('hidden');
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not request again while the lock is still held', async () => {
    renderHook(() => useWakeLock(true));
    await flush();
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('is a no-op where the API is missing', () => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });

  it('survives a refused request', async () => {
    request.mockRejectedValueOnce(new Error('denied'));
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
    await flush();
  });
});
