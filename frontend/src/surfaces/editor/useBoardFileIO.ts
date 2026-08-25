import { useCallback, useRef } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { applyImportToDraft, buildExportFile, isBoardFile } from './boardDraft';
import type { BoardDraftApi } from './useBoardDraft';

export interface BoardFileIO {
  /** Belongs to the hidden file input the surface has to render. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  exportBoard: () => void;
  triggerImport: () => void;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'map';

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Carrying a board between devices as a file, which needs no account and no server. */
export function useBoardFileIO(
  board: BoardDraftApi,
  reportError: (message: string | null) => void
): BoardFileIO {
  const { draft, update } = board;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportBoard = useCallback(() => {
    downloadJson(`${slugify(draft.boardName || 'map')}.json`, buildExportFile(draft));
  }, [draft]);

  const triggerImport = useCallback(() => {
    if (!fileInputRef.current) return;
    // Cleared first, so re-picking the same file still fires a change event.
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }, []);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const rawText = event.target?.result;
          if (typeof rawText !== 'string' || !rawText) return;
          const data: unknown = JSON.parse(rawText);
          if (!isBoardFile(data)) throw new Error('Invalid JSON structure');
          update((prev) => applyImportToDraft(prev, data));
          reportError(null);
        } catch (err) {
          reportError(
            `Failed to import map: ${err instanceof Error ? err.message : 'Invalid format'}`
          );
        }
      };

      reader.readAsText(file);
    },
    [update, reportError]
  );

  return { fileInputRef, exportBoard, triggerImport, handleFileChange };
}
