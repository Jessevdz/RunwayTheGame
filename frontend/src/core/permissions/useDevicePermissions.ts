import { useCallback, useEffect, useRef, useState } from 'react';
import {
  probeCamera,
  probeLocation,
  queryStatus,
  watchStatus,
  type DeviceKind,
  type PermissionStatus
} from './devicePermissions';

export interface DevicePermissionsState {
  location: PermissionStatus;
  camera: PermissionStatus;
  /** Prompts for one permission (or re-checks it after the player changed settings). */
  request: (kind: DeviceKind) => Promise<PermissionStatus>;
  /** True once both permissions are granted. */
  ready: boolean;
}

const KINDS: DeviceKind[] = ['location', 'camera'];

/** Tracks location and camera permission for the lobby; nothing is captured and nothing is sent to the server. */
export const useDevicePermissions = (): DevicePermissionsState => {
  const [statuses, setStatuses] = useState<Record<DeviceKind, PermissionStatus>>({
    location: 'unknown',
    camera: 'unknown'
  });
  const mounted = useRef(true);
  const requested = useRef<Set<DeviceKind>>(new Set());

  const set = useCallback((kind: DeviceKind, status: PermissionStatus) => {
    if (mounted.current) setStatuses((prev) => (prev[kind] === status ? prev : { ...prev, [kind]: status }));
  }, []);

  useEffect(() => {
    mounted.current = true;
    const stops: Array<() => void> = [];
    let cancelled = false;
    KINDS.forEach((kind) => {
      queryStatus(kind).then((status) => {
        if (!requested.current.has(kind)) set(kind, status);
      });
      watchStatus(kind, (status) => set(kind, status)).then((stop) => {
        if (cancelled) stop();
        else stops.push(stop);
      });
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      stops.forEach((stop) => stop());
    };
  }, [set]);

  const request = useCallback(
    async (kind: DeviceKind) => {
      requested.current.add(kind);
      set(kind, 'checking');
      const status = await (kind === 'location' ? probeLocation() : probeCamera());
      set(kind, status);
      return status;
    },
    [set]
  );

  return {
    location: statuses.location,
    camera: statuses.camera,
    request,
    ready: statuses.location === 'granted' && statuses.camera === 'granted'
  };
};
