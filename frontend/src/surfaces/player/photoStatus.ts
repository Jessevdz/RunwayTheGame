import { useEffect, useMemo, useState } from 'react';
import type { GameState, SubmissionInfo } from '../../core/projection/projectionStore';
import { getQueuedActions } from '../../core/projection/offlineStore';
import { syncEngine } from '../../core/projection/syncEngine';
import { CAPTURE_QUEUED_EVENT } from './captureEvents';

/** What has happened to the photo for one challenge, as far as this phone can tell. */
export type PhotoState =
  | { kind: 'none' }
  | { kind: 'pending'; elapsedSeconds: number }
  | { kind: 'queued' }
  | { kind: 'rejected'; rationale: string };

/** Identifies one challenge slot: a waypoint's own challenge, or a road's challenge from that waypoint. */
export const captureKey = (waypointId: string, roadId?: string): string => `${waypointId}|${roadId ?? ''}`;

interface DerivePhotoInput {
  submissions: Record<string, SubmissionInfo>;
  teamId: string;
  waypointId: string;
  roadId?: string;
  /** Capture keys of photos saved offline and not yet sent. */
  queued: ReadonlySet<string>;
  now: number;
}

/** Works out whether this team has a photo waiting, saved offline, or turned down for one challenge. */
export function derivePhotoState({ submissions, teamId, waypointId, roadId, queued, now }: DerivePhotoInput): PhotoState {
  const mine = Object.values(submissions)
    .filter((s) => s.teamId === teamId && s.waypointId === waypointId && (s.roadId || '') === (roadId ?? ''))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const latest = mine[mine.length - 1];

  if (latest?.status === 'pending') {
    const started = Date.parse(latest.createdAt);
    const elapsedSeconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
    return { kind: 'pending', elapsedSeconds };
  }
  if (queued.has(captureKey(waypointId, roadId))) return { kind: 'queued' };
  if (latest?.status === 'fail') return { kind: 'rejected', rationale: latest.rationale };
  return { kind: 'none' };
}

/** Keys of this game's photos waiting in the offline queue, kept fresh as the queue changes. */
export function useQueuedCaptureKeys(gameId: string | null): ReadonlySet<string> {
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    const refresh = () => {
      getQueuedActions()
        .then((rows) => {
          if (cancelled) return;
          const next = rows
            .filter((row) => row.payload.gameId === gameId)
            .map((row) => captureKey(row.payload.waypointId, row.payload.roadId))
            .sort();
          setKeys((prev) => (prev.join(',') === next.join(',') ? prev : next));
        })
        .catch(() => {});
    };
    const stopQueue = syncEngine.subscribeQueueCount(refresh);
    window.addEventListener(CAPTURE_QUEUED_EVENT, refresh);
    return () => {
      cancelled = true;
      stopQueue();
      window.removeEventListener(CAPTURE_QUEUED_EVENT, refresh);
    };
  }, [gameId]);

  return useMemo(() => new Set(keys), [keys]);
}

/** Photo state for a waypoint's own challenge and for the chosen road's challenge, ticking each second while one is pending. */
export function useChallengePhotos(input: {
  gameState: GameState;
  teamId: string;
  waypointId: string | undefined;
  roadId: string | undefined;
}): { waypoint: PhotoState; road: PhotoState } {
  const { gameState, teamId, waypointId, roadId } = input;
  const queued = useQueuedCaptureKeys(gameState.gameId);
  const [now, setNow] = useState(() => Date.now());

  const derive = (road?: string): PhotoState =>
    waypointId
      ? derivePhotoState({ submissions: gameState.submissions, teamId, waypointId, roadId: road, queued, now })
      : { kind: 'none' };

  const waypoint = derive();
  const road = roadId ? derive(roadId) : ({ kind: 'none' } as PhotoState);
  const ticking = waypoint.kind === 'pending' || road.kind === 'pending';

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  return { waypoint, road };
}
