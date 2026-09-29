import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryFieldPermissions } from './fieldPermissions';

const setPermissions = (value: unknown) =>
  Object.defineProperty(navigator, 'permissions', { configurable: true, value });

afterEach(() => {
  setPermissions(undefined);
});

describe('queryFieldPermissions', () => {
  it('reads location and camera state without prompting', async () => {
    const query = vi.fn(async ({ name }: { name: string }) => ({ state: name === 'geolocation' ? 'denied' : 'granted' }));
    setPermissions({ query });

    await expect(queryFieldPermissions()).resolves.toEqual({ geolocation: 'denied', camera: 'granted' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reports unknown where the browser cannot say', async () => {
    setPermissions(undefined);
    await expect(queryFieldPermissions()).resolves.toEqual({ geolocation: 'unknown', camera: 'unknown' });
  });

  it('reports unknown for a permission the browser refuses to describe', async () => {
    setPermissions({
      query: async ({ name }: { name: string }) => {
        if (name === 'camera') throw new TypeError('unsupported');
        return { state: 'prompt' };
      }
    });

    await expect(queryFieldPermissions()).resolves.toEqual({ geolocation: 'prompt', camera: 'unknown' });
  });
});
