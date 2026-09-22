import { useEffect, useRef } from 'react';
import { analytics } from '../../core/analytics/analyticsClient';
import { sessionDuration } from '../../core/analytics/events';
import type { SaveStatus } from './components/PaneHeader';

export interface EditorSessionState {
  /** The board id in the route, absent when the designer opened a blank map. */
  mapId: string | undefined;
  isEditable: boolean;
  saveStatus: SaveStatus;
  waypointCount: number;
  /** True once this session has written the board to the server at least once. */
  hasSaved: boolean;
}

/** Classifies how the designer arrived, which is the funnel's first branch. */
function openingMode(state: EditorSessionState): string {
  if (!state.isEditable) return 'readonly';
  return state.mapId ? 'existing' : 'new';
}

/**
 * Brackets an editor visit with a start and an end event. The end carries the
 * shape of what was built, so a session that produced nothing is
 * distinguishable from one that produced a board.
 */
export function useEditorSession(state: EditorSessionState): void {
  // The end event reports the state at the end, not the state at mount.
  const latest = useRef(state);
  latest.current = state;

  const startedAt = useRef<number>(Date.now());
  const ended = useRef(false);

  useEffect(() => {
    analytics.track('editor.session_started', { mode: openingMode(latest.current) });

    const end = () => {
      if (ended.current) return;
      ended.current = true;
      const current = latest.current;
      analytics.track('editor.session_ended', {
        duration: sessionDuration(Date.now() - startedAt.current),
        saved: current.hasSaved,
        dirty: current.saveStatus !== 'saved',
        waypoints: current.waypointCount
      });
    };

    // Closing the tab never unmounts the component, so the end is also bound to
    // the event the analytics client flushes on.
    window.addEventListener('pagehide', end);
    return () => {
      window.removeEventListener('pagehide', end);
      end();
    };
  }, []);
}
