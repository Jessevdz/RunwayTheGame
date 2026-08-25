export interface GPSPosition {
  lat: number;
  lon: number;
  accuracy: number; // in meters
}

// Geodesic distance in meters using Haversine formula
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Watch geolocation wrapper
export function watchPlayerLocation(
  onSuccess: (pos: GPSPosition) => void,
  onError: (err: GeolocationPositionError) => void
): () => void {
  if (!navigator.geolocation) {
    const error = {
      code: 1,
      message: 'Geolocation not supported by this browser',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3
    } as GeolocationPositionError;
    onError(error);
    return () => {};
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      onSuccess({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy
      });
    },
    (err) => {
      onError(err);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );

  return () => {
    navigator.geolocation.clearWatch(watchId);
  };
}
