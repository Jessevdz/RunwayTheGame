import type { ValidationError } from '../../core/editor/geometryUtils';

/**
 * Maps a validation issue's id onto the shared code vocabulary the server
 * allowlists. Ids carry a waypoint id suffix; the prefix is the kind.
 */
const CODE_BY_PREFIX: Array<[string, string]> = [
  ['err-no-waypoints', 'no_waypoints'],
  ['err-start-count', 'start_count'],
  ['err-finish-count', 'finish_count'],
  ['err-start-is-finish', 'start_is_finish'],
  ['err-isolated', 'waypoint_isolated'],
  ['err-unreachable', 'waypoint_unreachable'],
  ['err-finish-unreachable', 'finish_unreachable'],
  ['err-finish-has-challenge', 'finish_has_challenge'],
  ['err-waypoint-challenge-coins', 'challenge_coins_range'],
  ['err-waypoint-challenge-veto', 'challenge_veto_range'],
  ['err-waypoint-challenge-prompt', 'challenge_prompt_empty'],
  ['warn-intersect', 'roads_cross'],
  ['warn-waypoint-challenge-missing', 'challenge_missing']
];

// Longest prefix first, so `err-finish-unreachable` is not claimed by
// `err-finish-count`'s shorter sibling as the list grows.
const ORDERED = [...CODE_BY_PREFIX].sort((a, b) => b[0].length - a[0].length);

/** Returns the allowlisted code for an issue, or null when it has no mapping. */
export function validationIssueCode(issue: ValidationError): string | null {
  for (const [prefix, code] of ORDERED) {
    if (issue.id === prefix || issue.id.startsWith(`${prefix}-`)) return code;
  }
  return null;
}
