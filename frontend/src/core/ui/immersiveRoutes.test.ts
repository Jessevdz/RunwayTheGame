import { describe, expect, it } from 'vitest';
import { isImmersiveRoute } from './immersiveRoutes';

describe('isImmersiveRoute', () => {
  it.each(['/host/abc', '/join/abc', '/race/abc', '/race/abc/'])('hides chrome on %s', (path) => {
    expect(isImmersiveRoute(path)).toBe(true);
  });

  it.each(['/', '/host', '/races', '/gallery', '/race/abc/report', '/solo'])('keeps chrome on %s', (path) => {
    expect(isImmersiveRoute(path)).toBe(false);
  });
});
