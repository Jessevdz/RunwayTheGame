import { getItem, removeItem, setItem } from '../../core/util/storage';
import type { EditorDraft } from './boardDraft';

/** Local storage draft persistence utilities for board edits. */

const draftKey = (mapId: string | null): string => `runway:draft:${mapId || 'new'}`;

type StoredDraft = Partial<EditorDraft> & { updatedAt?: string };

export function readLocalDraft(mapId: string | null): StoredDraft | null {
  return getItem<StoredDraft>(draftKey(mapId));
}

export function writeLocalDraft(mapId: string | null, draft: EditorDraft): void {
  setItem<StoredDraft>(draftKey(mapId), { ...draft, updatedAt: new Date().toISOString() });
}

export function clearLocalDraft(mapId: string | null): void {
  removeItem(draftKey(mapId));
}
