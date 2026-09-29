export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Wraps any angle into the range 0 (inclusive) to 360 (exclusive). */
export const normalizeDegrees = (deg: number): number => ((deg % 360) + 360) % 360;

/** Signed shortest turn from one heading to another, in the range -180 to 180. */
export const shortestTurn = (from: number, to: number): number => normalizeDegrees(to - from + 180) - 180;

/** Initial compass bearing from one point to another, in degrees clockwise from north. */
export function bearingDegrees(from: LatLon, to: LatLon): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

/** Angle an arrow should be drawn at: the bearing to the target, turned back by which way the phone faces. */
export const arrowRotation = (bearing: number, heading: number | null): number =>
  normalizeDegrees(bearing - (heading ?? 0));

/** Picks the angle equivalent to the target that sits closest to the previous one, so a CSS transition never spins the long way round. */
export const nearestAngle = (previous: number, target: number): number => previous + shortestTurn(previous, target);

const COMPASS_POINTS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west'
] as const;

/** Spoken name of the eight-point compass direction nearest a bearing. */
export const compassName = (bearing: number): string =>
  COMPASS_POINTS[Math.round(normalizeDegrees(bearing) / 45) % COMPASS_POINTS.length];

/** Compass heading of the direction a phone held upright is facing, from its absolute orientation angles. */
export function compassHeading(alpha: number, beta: number, gamma: number): number {
  const a = toRad(alpha);
  const b = toRad(beta);
  const g = toRad(gamma);
  const x = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g);
  const y = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g);
  return normalizeDegrees(toDeg(Math.atan2(x, y)));
}
