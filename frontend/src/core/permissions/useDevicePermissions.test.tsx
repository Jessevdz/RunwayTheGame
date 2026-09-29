import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDevicePermissions } from './useDevicePermissions';
import { permissionHint, probeCamera, probeLocation } from './devicePermissions';

type State = 'granted' | 'denied' | 'prompt';

const setNavigator = (props: Record<string, unknown>) => {
  Object.entries(props).forEach(([key, value]) =>
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true })
  );
};

const permissionsStub = (states: Partial<Record<string, State>>) => ({
  query: vi.fn(async ({ name }: { name: string }) => {
    const state = states[name];
    if (!state) throw new TypeError('unsupported');
    return { state, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  })
});

const track = () => ({ stop: vi.fn() });

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

afterEach(() => {
  setNavigator({ permissions: undefined, mediaDevices: undefined, geolocation: undefined });
  vi.restoreAllMocks();
});

describe('probeCamera', () => {
  it('stops every track right after a successful probe', async () => {
    const t = track();
    setNavigator({ mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [t] }) } });
    expect(await probeCamera()).toBe('granted');
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('maps a refusal to denied', async () => {
    setNavigator({
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })) }
    });
    expect(await probeCamera()).toBe('denied');
  });

  it('retries without facing mode when the camera is over-constrained', async () => {
    const t = track();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OverconstrainedError' }))
      .mockResolvedValueOnce({ getTracks: () => [t] });
    setNavigator({ mediaDevices: { getUserMedia } });
    expect(await probeCamera()).toBe('granted');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(t.stop).toHaveBeenCalled();
  });

  it('reports unsupported when there is no media API', async () => {
    setNavigator({ mediaDevices: undefined });
    expect(await probeCamera()).toBe('unsupported');
  });

  it('reports unsupported when no camera exists', async () => {
    setNavigator({
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' })) }
    });
    expect(await probeCamera()).toBe('unsupported');
  });
});

describe('probeLocation', () => {
  it('grants on a fix without exposing the position', async () => {
    setNavigator({
      geolocation: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 1, longitude: 2 } }) }
    });
    expect(await probeLocation()).toBe('granted');
  });

  it('separates a denial from a missing fix', async () => {
    setNavigator({ geolocation: { getCurrentPosition: (_: unknown, err: (e: unknown) => void) => err({ code: 1 }) } });
    expect(await probeLocation()).toBe('denied');
    setNavigator({ geolocation: { getCurrentPosition: (_: unknown, err: (e: unknown) => void) => err({ code: 3 }) } });
    expect(await probeLocation()).toBe('error');
  });

  it('reports unsupported without geolocation', async () => {
    setNavigator({ geolocation: undefined });
    expect(await probeLocation()).toBe('unsupported');
  });
});

describe('permissionHint', () => {
  it('gives a next step for denied and nothing for granted', () => {
    expect(permissionHint('location', 'denied')).toMatch(/Allow|Location Services/);
    expect(permissionHint('camera', 'granted')).toBeNull();
  });
});

describe('useDevicePermissions', () => {
  it('reads current state without prompting', async () => {
    const getUserMedia = vi.fn();
    const getCurrentPosition = vi.fn();
    setNavigator({
      permissions: permissionsStub({ geolocation: 'granted', camera: 'prompt' }),
      mediaDevices: { getUserMedia },
      geolocation: { getCurrentPosition }
    });
    const { result } = renderHook(() => useDevicePermissions());
    await waitFor(() => expect(result.current.location).toBe('granted'));
    expect(result.current.camera).toBe('prompt');
    expect(result.current.ready).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('falls back to unknown when the Permissions API cannot answer', async () => {
    setNavigator({
      permissions: permissionsStub({}),
      mediaDevices: { getUserMedia: vi.fn() },
      geolocation: { getCurrentPosition: vi.fn() }
    });
    const { result } = renderHook(() => useDevicePermissions());
    await waitFor(() => expect(result.current.location).toBe('unknown'));
    expect(result.current.camera).toBe('unknown');
  });

  it('becomes ready once both requests succeed', async () => {
    const t = track();
    setNavigator({
      permissions: permissionsStub({}),
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [t] }) },
      geolocation: { getCurrentPosition: (ok: (p: unknown) => void) => ok({}) }
    });
    const { result } = renderHook(() => useDevicePermissions());
    await act(async () => {
      await result.current.request('location');
      await result.current.request('camera');
    });
    expect(result.current.ready).toBe(true);
    expect(t.stop).toHaveBeenCalled();
  });

  it('marks unsupported when the APIs are missing', async () => {
    setNavigator({ permissions: undefined, mediaDevices: undefined, geolocation: undefined });
    const { result } = renderHook(() => useDevicePermissions());
    await waitFor(() => expect(result.current.camera).toBe('unsupported'));
    expect(result.current.location).toBe('unsupported');
  });
});
