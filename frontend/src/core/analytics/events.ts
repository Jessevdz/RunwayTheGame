/** Typed analytics event vocabulary and property schemas. */

export type AnalyticsEventName =
  // Where does traffic go, and is the editor ever reached?
  | 'app.surface_opened'
  | 'app.design_unavailable'
  | 'app.request_failed'
  // The editor session, and the funnel's denominator.
  | 'editor.session_started'
  | 'editor.session_ended'
  // Geometry, one per map CustomEvent.
  | 'editor.waypoint_added'
  | 'editor.waypoint_moved'
  | 'editor.waypoint_deleted'
  | 'editor.waypoint_selected'
  | 'editor.road_added'
  | 'editor.road_deleted'
  | 'editor.start_set'
  | 'editor.finish_set'
  | 'editor.action_cancelled'
  // Editor chrome and authoring.
  | 'editor.tool_selected'
  | 'editor.tab_opened'
  | 'editor.challenge_edited'
  | 'editor.powerup_edited'
  | 'editor.confirm_shown'
  | 'editor.confirm_resolved'
  | 'editor.import_attempted'
  | 'editor.export_performed'
  // The outcomes of designing.
  | 'board.saved'
  | 'board.forked'
  | 'board.listed'
  | 'board.published'
  | 'board.share_copied'
  | 'board.validation_issue'
  | 'board.race_launched'
  // Reserved event types for deck operations.
  | 'deck.editor_opened'
  | 'deck.card_added'
  | 'deck.card_removed';

/** Primitive type for analytics event property values (label, flag, or count). */
export type AnalyticsPropValue = string | boolean | number;

export type AnalyticsProps = Record<string, AnalyticsPropValue>;

/** Coarse viewport category for analytics partitioning. */
export type Viewport = 'mobile' | 'tablet' | 'desktop';

export function currentViewport(): Viewport {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

/** Categorizes session duration into duration range buckets. */
export function sessionDuration(ms: number): string {
  const minutes = ms / 60000;
  if (minutes < 1) return 'under_1m';
  if (minutes < 5) return '1_5m';
  if (minutes < 15) return '5_15m';
  if (minutes < 60) return '15_60m';
  return 'over_60m';
}
