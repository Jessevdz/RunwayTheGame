import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createBoard,
  forkBoard,
  getBoard,
  setBoardVisibility,
  updateBoard
} from '../../core/api/client';
import {
  captureEditTokenFromHash,
  getEditToken,
  saveMyMap,
  syncMyMapMeta
} from '../../core/game/mapSession';
import { applyBoardToDraft, applyStoredDraft, buildBoardPayload, UNTITLED_MAP_NAME } from './boardDraft';
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from './localDraft';
import type { BoardDraftApi } from './useBoardDraft';
import type { SaveStatus } from './components/PaneHeader';

export interface BoardPersistence {
  mapId: string | null;
  editToken: string | null;
  isEditable: boolean;
  isListed: boolean;
  listingBusy: boolean;
  listingError: string | null;
  saveStatus: SaveStatus;
  errorMessage: string | null;
  reportError: (message: string | null) => void;
  save: () => Promise<void>;
  clearStoredDraft: () => void;
  fork: () => Promise<void>;
  isForking: boolean;
  setListed: (next: boolean) => Promise<void>;
  clearListingError: () => void;
}

/** Hook managing board server persistence, local draft sync, and gallery publishing. */
export function useBoardPersistence(routeMapId: string | undefined, board: BoardDraftApi): BoardPersistence {
  const navigate = useNavigate();
  const { draft, update, signature, isDirty, markSaved, adoptBaseline } = board;

  const [mapId, setMapId] = useState<string | null>(routeMapId || null);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [isEditable, setIsEditable] = useState<boolean>(true);

  const [asyncStatus, setAsyncStatus] = useState<SaveStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isForking, setIsForking] = useState<boolean>(false);
  const [isListed, setIsListed] = useState<boolean>(false);
  const [listingBusy, setListingBusy] = useState<boolean>(false);
  const [listingError, setListingError] = useState<string | null>(null);

  // Hydrates board draft from server or local storage fallback.
  useEffect(() => {
    if (!routeMapId) {
      const stored = readLocalDraft(null);
      if (stored) update((prev) => applyStoredDraft(prev, stored));
      return;
    }

    setMapId(routeMapId);
    const activeToken = captureEditTokenFromHash(routeMapId) || getEditToken(routeMapId);
    setEditToken(activeToken);

    getBoard(routeMapId)
      .then((res) => {
        setIsListed(!!res.is_listed);
        if (activeToken) {
          syncMyMapMeta(routeMapId, { name: res.board.name, isListed: !!res.is_listed });
        }
        update((prev) => applyBoardToDraft(prev, res.board));
        setIsEditable(true);
        setAsyncStatus(null);
        // Whatever the server just handed us is, by definition, saved.
        adoptBaseline();
      })
      .catch((err: Error) => {
        const stored = readLocalDraft(routeMapId);
        if (stored) {
          update((prev) => applyStoredDraft(prev, stored));
          setErrorMessage(null);
          setIsEditable(true);
        } else {
          setErrorMessage(`Failed to load map: ${err.message}`);
          setAsyncStatus('error');
        }
      });
  }, [routeMapId, update, adoptBaseline]);

  // Mirror the draft to local storage so work survives a refresh.
  useEffect(() => {
    if (draft.waypoints.length === 0 && draft.boardName === UNTITLED_MAP_NAME) return;
    writeLocalDraft(mapId, draft);
  }, [mapId, draft]);

  const save = useCallback(async () => {
    if (!isEditable) return;
    const signatureAtSave = signature;
    setAsyncStatus('saving');
    setErrorMessage(null);

    const payload = buildBoardPayload(draft);

    /** A board row plus the token that may write it — created on demand. */
    const claimBoard = async (): Promise<{ id: string; token: string }> => {
      const res = await createBoard(payload.name);
      setMapId(res.id);
      setEditToken(res.edit_token);
      return { id: res.id, token: res.edit_token };
    };

    try {
      let target = mapId && editToken ? { id: mapId, token: editToken } : await claimBoard();

      try {
        await updateBoard(target.id, { ...payload, edit_token: target.token });
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (!message.toLowerCase().includes('board not found')) throw err;
        // The id this device remembers is gone from the server — claim a new one.
        target = await claimBoard();
        await updateBoard(target.id, { ...payload, edit_token: target.token });
      }

      saveMyMap({ mapId: target.id, editToken: target.token, name: payload.name });
      if (routeMapId && routeMapId !== target.id) clearLocalDraft(routeMapId);
      clearLocalDraft(null);

      markSaved(signatureAtSave);
      // Clear the async override so the surface re-derives 'saved' vs 'dirty'.
      setAsyncStatus(null);

      if (target.id !== routeMapId) {
        navigate(`/design/${target.id}#token=${target.token}`, { replace: true });
      }
    } catch (err) {
      setAsyncStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Save failed');
    }
  }, [isEditable, signature, draft, mapId, editToken, routeMapId, markSaved, navigate]);

  /**
   * Lists this map in the public gallery, or takes it back out. Only the device
   * holding the edit token can do either, which is what makes "remove it again"
   * possible without accounts: the token that created the map is the same
   * capability that withdraws it.
   */
  const setListed = useCallback(
    async (next: boolean) => {
      if (!mapId || !editToken) return;
      setListingBusy(true);
      setListingError(null);
      try {
        await setBoardVisibility(mapId, next, { editToken });
        setIsListed(next);
        syncMyMapMeta(mapId, { name: draft.boardName, isListed: next });
      } catch (err) {
        const fallback = next
          ? 'Could not publish this map.'
          : 'Could not remove this map from the gallery.';
        setListingError(err instanceof Error ? err.message || fallback : fallback);
      } finally {
        setListingBusy(false);
      }
    },
    [mapId, editToken, draft.boardName]
  );

  const fork = useCallback(async () => {
    if (!mapId) return;
    setIsForking(true);
    try {
      const res = await forkBoard(mapId);
      saveMyMap({ mapId: res.id, editToken: res.edit_token, name: res.name });
      navigate(`/design/${res.id}#token=${res.edit_token}`);
    } catch (err) {
      setErrorMessage(`Fork failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setIsForking(false);
    }
  }, [mapId, navigate]);

  const clearStoredDraft = useCallback(() => {
    clearLocalDraft(mapId);
    if (mapId) clearLocalDraft(null);
  }, [mapId]);

  const reportError = useCallback((message: string | null) => {
    setErrorMessage(message);
    setAsyncStatus(message ? 'error' : null);
  }, []);

  const clearListingError = useCallback(() => setListingError(null), []);

  return {
    mapId,
    editToken,
    isEditable,
    isListed,
    listingBusy,
    listingError,
    // An in-flight save or a failure speaks for itself; otherwise the signature does.
    saveStatus:
      asyncStatus === 'saving' || asyncStatus === 'error' ? asyncStatus : isDirty ? 'dirty' : 'saved',
    errorMessage,
    reportError,
    save,
    clearStoredDraft,
    fork,
    isForking,
    setListed,
    clearListingError
  };
}
