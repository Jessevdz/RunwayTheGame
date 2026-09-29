import { useEffect, useState } from 'react';

/** What the browser says about a permission; unknown when it cannot be asked without prompting. */
export type FieldPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface FieldPermissions {
  geolocation: FieldPermissionState;
  camera: FieldPermissionState;
}

const UNKNOWN: FieldPermissions = { geolocation: 'unknown', camera: 'unknown' };

const NAMES = ['geolocation', 'camera'] as const;

const asState = (state: PermissionState): FieldPermissionState => state;

/** Opens a status handle for one permission, or null where the browser will not say. */
async function openStatus(name: (typeof NAMES)[number]): Promise<PermissionStatus | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
  try {
    return await navigator.permissions.query({ name: name as PermissionName });
  } catch {
    return null;
  }
}

/** Reads the location and camera permission state without ever showing a prompt. */
export async function queryFieldPermissions(): Promise<FieldPermissions> {
  const [geolocation, camera] = await Promise.all(NAMES.map(openStatus));
  return {
    geolocation: geolocation ? asState(geolocation.state) : 'unknown',
    camera: camera ? asState(camera.state) : 'unknown'
  };
}

/** Calls back whenever the location or camera permission changes, and returns an unsubscribe. */
export function watchFieldPermissions(onChange: (permissions: FieldPermissions) => void): () => void {
  let cancelled = false;
  const statuses: PermissionStatus[] = [];
  const refresh = () => {
    void queryFieldPermissions().then((next) => {
      if (!cancelled) onChange(next);
    });
  };

  void Promise.all(NAMES.map(openStatus)).then((opened) => {
    if (cancelled) return;
    opened.forEach((status) => {
      if (!status) return;
      status.addEventListener('change', refresh);
      statuses.push(status);
    });
  });

  return () => {
    cancelled = true;
    statuses.forEach((status) => status.removeEventListener('change', refresh));
  };
}

/** Live location and camera permission state for chips and prompts; permissions are only read, never requested. */
export function useFieldPermissions(): FieldPermissions {
  const [permissions, setPermissions] = useState<FieldPermissions>(UNKNOWN);

  useEffect(() => {
    let cancelled = false;
    void queryFieldPermissions().then((next) => {
      if (!cancelled) setPermissions(next);
    });
    const stop = watchFieldPermissions((next) => setPermissions(next));
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return permissions;
}
