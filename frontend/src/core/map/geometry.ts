import type { Feature, Polygon } from 'geojson';

/** Geodesic circle generator for arrival radii and GPS accuracy rings. */
export function makeCirclePolygon(lat: number, lon: number, radiusMeters: number): Feature<Polygon> {
  const coordinates = [];
  const steps = 32;
  const R = 6378137;

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const d = radiusMeters / R;

  for (let i = 0; i <= steps; i++) {
    const theta = (i * 2 * Math.PI) / steps;
    const asinVal = Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(theta);
    const circleLatRad = Math.asin(Math.max(-1, Math.min(1, asinVal)));
    const circleLonRad = lonRad + Math.atan2(
      Math.sin(theta) * Math.sin(d) * Math.cos(latRad),
      Math.cos(d) - Math.sin(latRad) * Math.sin(circleLatRad)
    );
    coordinates.push([
      (circleLonRad * 180) / Math.PI,
      (circleLatRad * 180) / Math.PI
    ]);
  }
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates]
    },
    properties: {}
  };
}
