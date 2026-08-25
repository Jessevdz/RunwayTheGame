import { useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createEmptyDraft, draftSignature } from './boardDraft';
import type { EditorDraft } from './boardDraft';

type FieldSetter<K extends keyof EditorDraft> = Dispatch<SetStateAction<EditorDraft[K]>>;

export interface BoardDraftApi {
  draft: EditorDraft;
  /** Whole-draft edit — hydration, import, anything touching more than one field. */
  update: (updater: (prev: EditorDraft) => EditorDraft) => void;
  reset: () => void;
  setBoardName: FieldSetter<'boardName'>;
  setWaypoints: FieldSetter<'waypoints'>;
  setRoads: FieldSetter<'roads'>;
  setChallenges: FieldSetter<'challenges'>;
  setRoadblockCards: FieldSetter<'roadblockCards'>;
  setCurseCards: FieldSetter<'curseCards'>;
  setPowerups: FieldSetter<'powerups'>;
  setRuleset: FieldSetter<'ruleset'>;
  signature: string;
  isDirty: boolean;
  /** The draft as it stood at `signature` is now on the server. */
  markSaved: (signature: string) => void;
  /** Whatever the next render computes is the clean baseline — used after hydration,
   *  where the incoming draft's signature does not exist yet. */
  adoptBaseline: () => void;
}

/** Hook managing editable board draft state and dirty tracking against baseline. */
export function useBoardDraft(): BoardDraftApi {
  const [draft, setDraft] = useState<EditorDraft>(createEmptyDraft);

  const update = useCallback((updater: (prev: EditorDraft) => EditorDraft) => {
    setDraft(updater);
  }, []);

  const reset = useCallback(() => {
    setDraft(createEmptyDraft());
  }, []);

  const setField = useCallback(
    <K extends keyof EditorDraft>(key: K, value: SetStateAction<EditorDraft[K]>) => {
      setDraft((prev) => {
        const next =
          typeof value === 'function'
            ? (value as (current: EditorDraft[K]) => EditorDraft[K])(prev[key])
            : value;
        return next === prev[key] ? prev : { ...prev, [key]: next };
      });
    },
    []
  );

  const setters = useMemo(
    () => ({
      setBoardName: (v: SetStateAction<string>) => setField('boardName', v),
      setWaypoints: (v: SetStateAction<EditorDraft['waypoints']>) => setField('waypoints', v),
      setRoads: (v: SetStateAction<EditorDraft['roads']>) => setField('roads', v),
      setChallenges: (v: SetStateAction<EditorDraft['challenges']>) => setField('challenges', v),
      setRoadblockCards: (v: SetStateAction<EditorDraft['roadblockCards']>) =>
        setField('roadblockCards', v),
      setCurseCards: (v: SetStateAction<EditorDraft['curseCards']>) => setField('curseCards', v),
      setPowerups: (v: SetStateAction<EditorDraft['powerups']>) => setField('powerups', v),
      setRuleset: (v: SetStateAction<EditorDraft['ruleset']>) => setField('ruleset', v)
    }),
    [setField]
  );

  const signature = useMemo(() => draftSignature(draft), [draft]);

  const savedSignatureRef = useRef<string | null>(null);
  const adoptBaselineRef = useRef<boolean>(false);

  if (adoptBaselineRef.current) {
    adoptBaselineRef.current = false;
    savedSignatureRef.current = signature;
  }
  // First render: initialise the baseline without marking the draft dirty.
  if (savedSignatureRef.current === null) {
    savedSignatureRef.current = signature;
  }

  const markSaved = useCallback((saved: string) => {
    savedSignatureRef.current = saved;
  }, []);

  const adoptBaseline = useCallback(() => {
    adoptBaselineRef.current = true;
  }, []);

  return {
    draft,
    update,
    reset,
    ...setters,
    signature,
    isDirty: signature !== savedSignatureRef.current,
    markSaved,
    adoptBaseline
  };
}
