import { describe, expect, it } from 'vitest';
import { resolveDestinationId, type RouteChoice } from './destination';

const routes = (a: number | null, b: number | null): RouteChoice[] => [
  { waypointId: 'A', distance: a },
  { waypointId: 'B', distance: b }
];

describe('resolveDestinationId', () => {
  it('returns null when there is nowhere to go', () => {
    expect(resolveDestinationId([], null, null)).toBeNull();
  });

  it('starts on the nearest route', () => {
    expect(resolveDestinationId(routes(300, 120), null, null)).toBe('B');
  });

  it('starts on the first route while there is no GPS fix', () => {
    expect(resolveDestinationId(routes(null, null), null, null)).toBe('A');
  });

  it('lets an explicit choice beat the nearest route', () => {
    expect(resolveDestinationId(routes(300, 120), 'A', 'B')).toBe('A');
  });

  it('ignores an explicit choice that is no longer a route', () => {
    expect(resolveDestinationId(routes(300, 120), 'Z', null)).toBe('B');
  });

  it('keeps the previous pick when GPS drift makes another route slightly nearer', () => {
    expect(resolveDestinationId(routes(200, 190), null, 'A')).toBe('A');
    expect(resolveDestinationId(routes(200, 150), null, 'A')).toBe('A');
  });

  it('keeps the previous pick when the gain is a large fraction of a short distance', () => {
    expect(resolveDestinationId(routes(40, 15), null, 'A')).toBe('A');
  });

  it('switches once another route is clearly and substantially nearer', () => {
    expect(resolveDestinationId(routes(400, 100), null, 'A')).toBe('B');
  });

  it('keeps the previous pick when its distance is unknown', () => {
    expect(resolveDestinationId(routes(null, 50), null, 'A')).toBe('A');
  });

  it('does not flip back and forth as the two distances cross', () => {
    let pick: string | null = null;
    const walk: Array<[number, number]> = [
      [210, 200],
      [200, 205],
      [195, 210],
      [205, 198],
      [190, 215]
    ];
    const picks = walk.map(([a, b]) => {
      pick = resolveDestinationId(routes(a, b), null, pick);
      return pick;
    });
    expect(new Set(picks).size).toBe(1);
  });
});
