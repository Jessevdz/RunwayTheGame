import { getItem, setItem } from '../util/storage';

/** Manages map edit tokens and local map records in storage. */

export interface MapRecord {
  mapId: string;
  editToken: string;
  name: string;
  updatedAt: string;
  /** Indicates whether this map is listed in the public gallery. */
  isListed?: boolean;
}

const MAPS_STORAGE_KEY = 'runway:maps';

export function listMyMaps(): MapRecord[] {
  const parsed = getItem<MapRecord[]>(MAPS_STORAGE_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveMyMap(entry: { mapId: string; editToken: string; name?: string; isListed?: boolean }): void {
  const current = listMyMaps();
  const existingIndex = current.findIndex((m) => m.mapId === entry.mapId);
  const updatedRecord: MapRecord = {
    mapId: entry.mapId,
    editToken: entry.editToken,
    name: entry.name || (existingIndex >= 0 ? current[existingIndex].name : 'Untitled Map'),
    updatedAt: new Date().toISOString(),
    isListed: entry.isListed ?? (existingIndex >= 0 ? current[existingIndex].isListed : false)
  };

  if (existingIndex >= 0) {
    current[existingIndex] = updatedRecord;
  } else {
    current.unshift(updatedRecord);
  }

  setItem(MAPS_STORAGE_KEY, current);
}

/** Syncs local map metadata with server response values. */
export function syncMyMapMeta(mapId: string, meta: { name?: string; isListed?: boolean }): void {
  const current = listMyMaps();
  const index = current.findIndex((m) => m.mapId === mapId);
  if (index < 0) return;
  current[index] = {
    ...current[index],
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.isListed === undefined ? {} : { isListed: meta.isListed })
  };
  setItem(MAPS_STORAGE_KEY, current);
}

export function getEditToken(mapId: string): string | null {
  const current = listMyMaps();
  const match = current.find((m) => m.mapId === mapId);
  return match ? match.editToken : null;
}

export function removeMyMap(mapId: string): void {
  const current = listMyMaps();
  const filtered = current.filter((m) => m.mapId !== mapId);
  setItem(MAPS_STORAGE_KEY, filtered);
}

/** Captures map edit token from the URL hash fragment and persists it. */
export function captureEditTokenFromHash(mapId: string): string | null {
  try {
    const hash = window.location.hash;
    if (!hash) return null;
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get('token') || params.get('key') || params.get('edit_token');
    if (token) {
      saveMyMap({ mapId, editToken: token });
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', cleanUrl);
      return token;
    }
  } catch {
    // Ignore hash parsing errors
  }
  return null;
}
