import type { AnalyticsProps } from '../../core/analytics/events';
import type { EditorDraft } from './boardDraft';

/** True when any challenge carries grading criteria beyond its bare prompt. */
function hasRubrics(draft: EditorDraft): boolean {
  return Object.values(draft.challenges).some(
    (c) =>
      c.rubric.must_show.length > 0 ||
      c.rubric.fails_if.length > 0 ||
      c.rubric.acceptable_ambiguity.trim() !== ''
  );
}

/**
 * Describes a saved board as counts and flags. Every value here is bucketed or
 * boolean on the server, so this says how big a board is and never which one.
 */
export function boardSaveProps(draft: EditorDraft, result: string): AnalyticsProps {
  return {
    result,
    waypoints: draft.waypoints.length,
    roads: draft.roads.length,
    challenges: Object.keys(draft.challenges).length,
    roadblock_cards: draft.roadblockCards.length,
    curse_cards: draft.curseCards.length,
    powerups: draft.powerups.length,
    has_start: draft.waypoints.some((w) => w.isStart),
    has_finish: draft.waypoints.some((w) => w.isFinish),
    has_rubrics: hasRubrics(draft)
  };
}
