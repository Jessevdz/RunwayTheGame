import { useCallback, useState } from 'react';

/** Console modal overlay state definitions. */
export type ConsoleOverlay =
  | { kind: 'shop' }
  | { kind: 'log' }
  | { kind: 'invite' }
  /** Confirming a walk-away from the challenge gating this waypoint. */
  | { kind: 'veto'; waypointId: string }
  | { kind: 'end-run' };

export interface ConsoleOverlays {
  overlay: ConsoleOverlay | null;
  open: (overlay: ConsoleOverlay) => void;
  close: () => void;
  /** Returns true if active overlay matches specified kind. */
  is: (kind: ConsoleOverlay['kind']) => boolean;
}

export const useConsoleOverlays = (): ConsoleOverlays => {
  const [overlay, setOverlay] = useState<ConsoleOverlay | null>(null);
  const close = useCallback(() => setOverlay(null), []);
  return {
    overlay,
    open: setOverlay,
    close,
    is: (kind) => overlay?.kind === kind
  };
};
