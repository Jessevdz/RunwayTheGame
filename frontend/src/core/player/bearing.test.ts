import { describe, expect, it } from 'vitest';
import {
  arrowRotation,
  bearingDegrees,
  compassHeading,
  compassName,
  nearestAngle,
  normalizeDegrees,
  shortestTurn
} from './bearing';

const origin = { lat: 51.0, lon: 4.0 };

describe('bearingDegrees', () => {
  it('points north for a target straight up', () => {
    expect(bearingDegrees(origin, { lat: 51.01, lon: 4.0 })).toBeCloseTo(0, 3);
  });

  it('points east, south and west for targets in those directions', () => {
    expect(bearingDegrees(origin, { lat: 51.0, lon: 4.01 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(origin, { lat: 50.99, lon: 4.0 })).toBeCloseTo(180, 3);
    expect(bearingDegrees(origin, { lat: 51.0, lon: 3.99 })).toBeCloseTo(270, 0);
  });

  it('points north-east for an equal step up and across at this latitude', () => {
    const bearing = bearingDegrees(origin, { lat: 51.01, lon: 4.0 + 0.01 / Math.cos((51 * Math.PI) / 180) });
    expect(bearing).toBeGreaterThan(44);
    expect(bearing).toBeLessThan(46);
  });
});

describe('angle helpers', () => {
  it('wraps angles into a single turn', () => {
    expect(normalizeDegrees(-10)).toBe(350);
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(360)).toBe(0);
  });

  it('finds the shortest signed turn across north', () => {
    expect(shortestTurn(350, 10)).toBe(20);
    expect(shortestTurn(10, 350)).toBe(-20);
    expect(shortestTurn(0, 180)).toBe(-180);
  });

  it('unwraps a target so it never spins the long way round', () => {
    expect(nearestAngle(350, 10)).toBe(370);
    expect(nearestAngle(370, 355)).toBe(355);
    expect(nearestAngle(-20, 350)).toBe(-10);
  });

  it('draws the arrow relative to the way the phone faces', () => {
    expect(arrowRotation(90, null)).toBe(90);
    expect(arrowRotation(90, 90)).toBe(0);
    expect(arrowRotation(10, 350)).toBe(20);
  });

  it('names the eight compass points', () => {
    expect(compassName(0)).toBe('north');
    expect(compassName(44)).toBe('north-east');
    expect(compassName(181)).toBe('south');
    expect(compassName(359)).toBe('north');
  });
});

describe('compassHeading', () => {
  it('reads north for an upright phone with no rotation', () => {
    expect(compassHeading(0, 90, 0)).toBeCloseTo(0, 3);
  });

  it('reads west when the phone has been turned a quarter counter-clockwise', () => {
    expect(compassHeading(90, 90, 0)).toBeCloseTo(270, 3);
  });

  it('reads east when the phone has been turned a quarter clockwise', () => {
    expect(compassHeading(270, 90, 0)).toBeCloseTo(90, 3);
  });
});
