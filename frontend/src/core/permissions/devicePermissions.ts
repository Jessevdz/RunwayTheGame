export type DeviceKind = 'location' | 'camera';

export type PermissionStatus = 'unknown' | 'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported' | 'error';

/** How long a location probe may wait for a fix before it is reported as an error. */
const LOCATION_PROBE_TIMEOUT_MS = 10000;

/** A cached fix this old is good enough, since the probe only asks whether access works. */
const LOCATION_PROBE_MAX_AGE_MS = 60000;

const PERMISSION_NAME: Record<DeviceKind, string> = { location: 'geolocation', camera: 'camera' };

/** True when the browser exposes the API this permission needs. */
export const isSupported = (kind: DeviceKind): boolean => {
  if (typeof navigator === 'undefined') return false;
  if (typeof window !== 'undefined' && window.isSecureContext === false) return false;
  return kind === 'location' ? !!navigator.geolocation : !!navigator.mediaDevices?.getUserMedia;
};

/** Reads the current permission state without prompting; 'unknown' when the browser cannot say. */
export const queryStatus = async (kind: DeviceKind): Promise<PermissionStatus> => {
  if (!isSupported(kind)) return 'unsupported';
  try {
    const result = await navigator.permissions.query({ name: PERMISSION_NAME[kind] as PermissionName });
    return result.state;
  } catch {
    return 'unknown';
  }
};

/** Subscribes to permission changes made in browser settings; returns an unsubscribe function. */
export const watchStatus = async (kind: DeviceKind, onChange: (status: PermissionStatus) => void): Promise<() => void> => {
  if (!isSupported(kind)) return () => {};
  try {
    const result = await navigator.permissions.query({ name: PERMISSION_NAME[kind] as PermissionName });
    const handler = () => onChange(result.state);
    result.addEventListener('change', handler);
    return () => result.removeEventListener('change', handler);
  } catch {
    return () => {};
  }
};

const cameraErrorStatus = (err: unknown): PermissionStatus => {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'unsupported';
  return 'error';
};

/** Asks for camera access and stops the stream at once, so no frame is captured or kept. */
export const probeCamera = async (): Promise<PermissionStatus> => {
  if (!isSupported('camera')) return 'unsupported';
  let stream: MediaStream | undefined;
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (err) {
      if ((err as { name?: string })?.name !== 'OverconstrainedError') throw err;
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    return 'granted';
  } catch (err) {
    return cameraErrorStatus(err);
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
};

/** Asks for location access with one fix that is thrown away; the position is never read or sent. */
export const probeLocation = (): Promise<PermissionStatus> => {
  if (!isSupported('location')) return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      (err) => resolve(err.code === 1 ? 'denied' : 'error'),
      { enableHighAccuracy: false, timeout: LOCATION_PROBE_TIMEOUT_MS, maximumAge: LOCATION_PROBE_MAX_AGE_MS }
    );
  });
};

const isIos = (): boolean =>
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

const NOUN: Record<DeviceKind, string> = { location: 'Location', camera: 'Camera' };

/** Plain-language next step for a status, or null when nothing needs fixing. */
export const permissionHint = (kind: DeviceKind, status: PermissionStatus): string | null => {
  switch (status) {
    case 'denied':
      return isIos()
        ? kind === 'location'
          ? 'Open Settings, then Privacy, then Location Services, then Safari Websites, and choose While Using. Then tap Check again.'
          : 'Open Settings, then Safari, then Camera, and choose Ask or Allow. Then tap Check again.'
        : `Tap the lock or settings icon next to the web address, set ${NOUN[kind]} to Allow, then tap Check again.`;
    case 'unsupported':
      return kind === 'location'
        ? 'This browser cannot share your location here. Try Chrome or Safari, and open Runway over https.'
        : 'We cannot check the camera on this device. Photo challenges may still work through your phone camera app.';
    case 'error':
      return kind === 'location'
        ? 'Location is allowed but no signal yet. Step outside or near a window, then tap Check again.'
        : 'The camera could not start. Close other apps using it, then tap Check again.';
    default:
      return null;
  }
};
