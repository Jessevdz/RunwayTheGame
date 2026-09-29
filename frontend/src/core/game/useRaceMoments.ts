import { useCallback, useEffect, useState } from 'react';
import { showToast } from '@ds';
import { projectionStore } from '../projection/projectionStore';
import { createMomentTracker, type CelebrationMoment } from './raceMoments';
import { describeCelebration, describeRivalEvent, type CelebrationCopy } from './momentCopy';

/** A celebration waiting to be shown, with its words already worked out. */
export interface PendingCelebration {
  moment: CelebrationMoment;
  copy: CelebrationCopy;
}

/** Celebrations kept waiting while the player is busy elsewhere. */
export const MAX_QUEUED_CELEBRATIONS = 3;

/** Watches the projection for this team's key moments, pops toasts for rival events, and queues celebrations. */
export function useRaceMoments(teamId: string | undefined): { current: PendingCelebration | null; dismiss: () => void } {
  const [queue, setQueue] = useState<PendingCelebration[]>([]);

  useEffect(() => {
    if (!teamId) return;
    setQueue([]);
    const tracker = createMomentTracker(teamId);
    return projectionStore.subscribe((state) => {
      const batch = tracker.observe(state);
      batch.rival.forEach((event) => {
        const { text, tone } = describeRivalEvent(event, state);
        showToast(text, { tone, duration: 6000 });
      });
      if (batch.celebration) {
        const pending = { moment: batch.celebration, copy: describeCelebration(batch.celebration, state, teamId) };
        setQueue((q) => [...q, pending].slice(-MAX_QUEUED_CELEBRATIONS));
      }
    });
  }, [teamId]);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  return { current: queue[0] ?? null, dismiss };
}
