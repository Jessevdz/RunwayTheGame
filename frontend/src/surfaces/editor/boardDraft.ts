import { generateUUID } from '../../core/util/uuid';
import type { ApiBoard, ApiChallenge, ApiRoad, ApiWaypoint } from '../../core/api/client';
import type { RoadDraft, WaypointDraft } from '../../core/editor/geometryUtils';
import { DEFAULT_VETO_PENALTY_SECONDS } from './ChallengePoolEditor';
import type { ChallengeDraft } from './ChallengePoolEditor';
import type { CardDraft } from './deckCards';
import { DEFAULT_POWERUPS, ensureDefaultPowerups } from './powerups';
import type { PowerupDraft } from './powerups';

export interface RulesetDraft {
  reward_only_first_completer: boolean;
}

/** Everything the designer edits. The one thing the save, export and dirty check all read. */
export interface EditorDraft {
  boardName: string;
  waypoints: WaypointDraft[];
  roads: RoadDraft[];
  challenges: { [waypointId: string]: ChallengeDraft };
  roadblockCards: CardDraft[];
  curseCards: CardDraft[];
  powerups: PowerupDraft[];
  ruleset: RulesetDraft;
}

export const UNTITLED_MAP_NAME = 'Untitled Map';

export const DEFAULT_ARRIVAL_RADIUS_M = 25;
const DEFAULT_COIN_REWARD = 20;

const defaultRuleset: RulesetDraft = {
  reward_only_first_completer: true
};

export const createEmptyDraft = (): EditorDraft => ({
  boardName: UNTITLED_MAP_NAME,
  waypoints: [],
  roads: [],
  challenges: {},
  roadblockCards: [],
  curseCards: [],
  powerups: ensureDefaultPowerups(),
  ruleset: defaultRuleset
});

/** Stable stringification of the draft — the baseline the dirty check compares against. */
export const draftSignature = (draft: EditorDraft): string =>
  JSON.stringify([
    draft.boardName,
    draft.waypoints,
    draft.roads,
    draft.challenges,
    draft.roadblockCards,
    draft.curseCards,
    draft.powerups,
    draft.ruleset
  ]);

/** Derives powerup cost mapping from draft powerups. */
export const derivePowerupCosts = (powerups: PowerupDraft[]): { [id: string]: number } =>
  Object.fromEntries(powerups.map((p) => [p.id, p.cost]));

/** Challenges assigned to active (non-finish) waypoints that exist in the draft. */
export const activeChallengeEntries = (draft: EditorDraft): [string, ChallengeDraft][] => {
  const validWaypointIds = new Set(
    draft.waypoints.filter((w) => !w.isFinish).map((w) => w.id)
  );
  return Object.entries(draft.challenges).filter(([waypointId]) => validWaypointIds.has(waypointId));
};

const isUUID = (id?: string): boolean => !!id && id.length === 36 && id.includes('-');

export interface BoardPayload {
  name: string;
  waypoints: ApiWaypoint[];
  roads: ApiRoad[];
  challenges: ApiChallenge[];
  roadblock_cards: CardDraft[];
  curse_cards: CardDraft[];
  powerups: PowerupDraft[];
  powerup_costs: { [id: string]: number };
}

/** The on-wire board: what `updateBoard` is sent, and the body of an export file. */
export function buildBoardPayload(draft: EditorDraft): BoardPayload {
  const challengeIdByWaypoint: { [waypointId: string]: string } = {};
  const challenges: ApiChallenge[] = activeChallengeEntries(draft).map(([waypointId, c]) => {
    const challengeId = isUUID(c.id) ? c.id! : generateUUID();
    challengeIdByWaypoint[waypointId] = challengeId;
    return {
      id: challengeId,
      waypoint_id: waypointId,
      prompt: c.prompt,
      rubric: {
        must_show: c.rubric?.must_show || [],
        fails_if: c.rubric?.fails_if || [],
        acceptable_ambiguity: c.rubric?.acceptable_ambiguity || ''
      },
      coin_reward: c.coin_reward ?? DEFAULT_COIN_REWARD,
      veto_penalty_seconds: c.veto_penalty_seconds ?? DEFAULT_VETO_PENALTY_SECONDS
    };
  });

  return {
    name: draft.boardName,
    waypoints: draft.waypoints.map((w) => ({
      id: w.id,
      name: w.name,
      lat: w.lat,
      lon: w.lon,
      arrival_radius_m: w.arrival_radius_m || DEFAULT_ARRIVAL_RADIUS_M,
      is_start: w.isStart,
      is_finish: w.isFinish,
      challenge_id: challengeIdByWaypoint[w.id]
    })),
    roads: draft.roads.map((s) => ({
      id: s.id,
      waypoint_id_a: s.waypoint_id_a,
      waypoint_id_b: s.waypoint_id_b,
      waypoint_a: s.waypoint_id_a,
      waypoint_b: s.waypoint_id_b,
      length_m: 1000
    })),
    challenges,
    roadblock_cards: draft.roadblockCards,
    curse_cards: draft.curseCards,
    powerups: draft.powerups,
    powerup_costs: derivePowerupCosts(draft.powerups)
  };
}

/** An export file is the save payload plus the ruleset, which the server does not store. */
export const buildExportFile = (draft: EditorDraft): BoardPayload & { ruleset: RulesetDraft } => ({
  ...buildBoardPayload(draft),
  ruleset: draft.ruleset
});

/** Powerups from a board or a file: full definitions, legacy cost map, or neither. */
function powerupsFrom(
  powerups: PowerupDraft[] | undefined,
  costs: { [id: string]: number } | undefined
): PowerupDraft[] {
  if (powerups && powerups.length > 0) return ensureDefaultPowerups(powerups);
  if (costs) {
    // Legacy board: reconstruct full definitions from the default catalog + saved costs.
    return ensureDefaultPowerups(DEFAULT_POWERUPS.map((p) => ({ ...p, cost: costs[p.id] ?? p.cost })));
  }
  return ensureDefaultPowerups();
}

/** Server board -> draft. The ruleset is not on the wire, so the current one is kept. */
export function applyBoardToDraft(prev: EditorDraft, board: ApiBoard): EditorDraft {
  const waypoints: WaypointDraft[] = (board.waypoints || []).map((w) => ({
    id: w.id,
    name: w.name,
    lat: w.lat,
    lon: w.lon,
    arrival_radius_m: w.arrival_radius_m || DEFAULT_ARRIVAL_RADIUS_M,
    isStart: w.is_start || false,
    isFinish: w.is_finish || false
  }));

  const validWaypointIds = new Set(waypoints.filter((w) => !w.isFinish).map((w) => w.id));
  const challenges: { [waypointId: string]: ChallengeDraft } = {};
  (board.challenges || []).forEach((c) => {
    const waypointId = c.waypoint_id || c.road_id || c.id;
    if (!validWaypointIds.has(waypointId)) return;
    challenges[waypointId] = {
      prompt: c.prompt,
      rubric: {
        must_show: c.rubric?.must_show || [],
        fails_if: c.rubric?.fails_if || [],
        acceptable_ambiguity: c.rubric?.acceptable_ambiguity || ''
      },
      coin_reward: c.coin_reward || DEFAULT_COIN_REWARD,
      veto_penalty_seconds: c.veto_penalty_seconds || DEFAULT_VETO_PENALTY_SECONDS
    };
  });

  return {
    ...prev,
    boardName: board.name || UNTITLED_MAP_NAME,
    waypoints,
    roads: (board.roads || []).map((s) => ({
      id: s.id,
      waypoint_id_a: s.waypoint_id_a || s.waypoint_a || '',
      waypoint_id_b: s.waypoint_id_b || s.waypoint_b || '',
      challenge_id: s.challenge_id || null
    })),
    challenges,
    roadblockCards: board.roadblock_deck || prev.roadblockCards,
    curseCards: board.curse_deck || prev.curseCards,
    powerups: powerupsFrom(
      board.powerups?.map((p) => ({ ...p, effect: p.effect as PowerupDraft['effect'] })),
      board.powerup_costs
    )
  };
}

/** Applies a stored local draft, field by field — an old copy may be missing any of them. */
export function applyStoredDraft(prev: EditorDraft, stored: Partial<EditorDraft>): EditorDraft {
  return {
    ...prev,
    ...(stored.boardName ? { boardName: stored.boardName } : {}),
    ...(stored.waypoints ? { waypoints: stored.waypoints } : {}),
    ...(stored.roads ? { roads: stored.roads } : {}),
    ...(stored.challenges ? { challenges: stored.challenges } : {}),
    ...(stored.roadblockCards ? { roadblockCards: stored.roadblockCards } : {}),
    ...(stored.curseCards ? { curseCards: stored.curseCards } : {}),
    ...(stored.powerups ? { powerups: ensureDefaultPowerups(stored.powerups) } : {}),
    ...(stored.ruleset ? { ruleset: stored.ruleset } : {})
  };
}

/**
 * An imported file, which is any JSON the user picked. Every field is optional and
 * every key has a legacy spelling, so the shape is read defensively and coerced.
 */
interface RawWaypoint {
  id?: string;
  name?: string;
  lat?: number;
  lon?: number;
  arrival_radius_m?: number;
  arrivalRadiusM?: number;
  is_start?: boolean;
  isStart?: boolean;
  is_finish?: boolean;
  isFinish?: boolean;
}

interface RawRoad {
  id?: string;
  waypoint_id_a?: string;
  waypoint_a?: string;
  waypointIdA?: string;
  waypoint_id_b?: string;
  waypoint_b?: string;
  waypointIdB?: string;
  challenge_id?: string;
  challengeId?: string;
}

interface RawChallenge extends Partial<ChallengeDraft> {
  waypoint_id?: string;
  waypointId?: string;
  road_id?: string;
}

export interface RawBoardFile {
  name?: string;
  waypoints?: RawWaypoint[];
  roads?: RawRoad[];
  challenges?: RawChallenge[] | { [waypointId: string]: ChallengeDraft };
  roadblock_cards?: CardDraft[];
  roadblockCards?: CardDraft[];
  roadblock_deck?: CardDraft[];
  curse_cards?: CardDraft[];
  curseCards?: CardDraft[];
  curse_deck?: CardDraft[];
  powerups?: PowerupDraft[];
  powerup_costs?: { [id: string]: number };
  ruleset?: RulesetDraft;
}

const asChallengeDraft = (c: RawChallenge): ChallengeDraft => ({
  id: c.id,
  prompt: c.prompt || '',
  rubric: {
    must_show: Array.isArray(c.rubric?.must_show) ? c.rubric.must_show : [],
    fails_if: Array.isArray(c.rubric?.fails_if) ? c.rubric.fails_if : [],
    acceptable_ambiguity: c.rubric?.acceptable_ambiguity || ''
  },
  coin_reward: c.coin_reward ?? DEFAULT_COIN_REWARD,
  veto_penalty_seconds: c.veto_penalty_seconds ?? DEFAULT_VETO_PENALTY_SECONDS
});

// Validates that the input data is a plain JSON object.
export const isBoardFile = (data: unknown): data is RawBoardFile =>
  !!data && typeof data === 'object' && !Array.isArray(data);

// Parses an imported JSON file into an editor draft.
export function applyImportToDraft(prev: EditorDraft, data: RawBoardFile): EditorDraft {
  const next: EditorDraft = { ...prev };

  if (data.name && typeof data.name === 'string') {
    next.boardName = data.name;
  }

  if (Array.isArray(data.waypoints)) {
    next.waypoints = data.waypoints.map((w) => ({
      id: w.id || generateUUID(),
      name: w.name || 'Waypoint',
      lat: typeof w.lat === 'number' ? w.lat : 0,
      lon: typeof w.lon === 'number' ? w.lon : 0,
      arrival_radius_m: w.arrival_radius_m || w.arrivalRadiusM || DEFAULT_ARRIVAL_RADIUS_M,
      isStart: w.isStart ?? w.is_start ?? false,
      isFinish: w.isFinish ?? w.is_finish ?? false
    }));
  }

  if (Array.isArray(data.roads)) {
    next.roads = data.roads.map((s) => ({
      id: s.id || generateUUID(),
      waypoint_id_a: s.waypoint_id_a || s.waypoint_a || s.waypointIdA || '',
      waypoint_id_b: s.waypoint_id_b || s.waypoint_b || s.waypointIdB || '',
      challenge_id: s.challenge_id || s.challengeId || null
    }));
  }

  // Active non-finish waypoints that can hold a challenge
  const nonFinishWaypoints = next.waypoints.filter((w) => !w.isFinish);
  const validWaypointIds = new Set(nonFinishWaypoints.map((w) => w.id));

  if (Array.isArray(data.challenges)) {
    const parsed: { [waypointId: string]: ChallengeDraft } = {};
    const assignedWpIds = new Set<string>();
    const unassignedChallenges: RawChallenge[] = [];

    // Map by challenge_id if present on raw waypoints
    const rawWpByChallengeId = new Map<string, string>();
    if (Array.isArray(data.waypoints)) {
      data.waypoints.forEach((w, idx) => {
        const cid = (w as any).challenge_id || (w as any).challengeId;
        const wpDraft = next.waypoints[idx];
        if (cid && wpDraft && !wpDraft.isFinish) {
          rawWpByChallengeId.set(cid, wpDraft.id);
        }
      });
    }

    data.challenges.forEach((c) => {
      const explicitWpId = c.waypoint_id || c.waypointId || c.road_id;
      if (explicitWpId && validWaypointIds.has(explicitWpId) && !assignedWpIds.has(explicitWpId)) {
        parsed[explicitWpId] = asChallengeDraft(c);
        assignedWpIds.add(explicitWpId);
      } else if (c.id && rawWpByChallengeId.has(c.id)) {
        const wpId = rawWpByChallengeId.get(c.id)!;
        if (!assignedWpIds.has(wpId)) {
          parsed[wpId] = asChallengeDraft(c);
          assignedWpIds.add(wpId);
        }
      } else {
        unassignedChallenges.push(c);
      }
    });

    // Fallback: If challenges could not be linked by explicit ID (e.g. disconnected UUIDs),
    // assign remaining unlinked challenges in order to the remaining unassigned non-finish waypoints.
    if (unassignedChallenges.length > 0) {
      const remainingWaypoints = nonFinishWaypoints.filter((w) => !assignedWpIds.has(w.id));
      unassignedChallenges.forEach((c, idx) => {
        if (idx < remainingWaypoints.length) {
          const wp = remainingWaypoints[idx];
          parsed[wp.id] = asChallengeDraft(c);
          assignedWpIds.add(wp.id);
        }
      });
    }

    next.challenges = parsed;
  } else if (data.challenges && typeof data.challenges === 'object') {
    next.challenges = Object.fromEntries(
      Object.entries(data.challenges).filter(([waypointId]) => validWaypointIds.has(waypointId))
    );
  }

  // Exports use `*_cards`; a raw board read model uses `*_deck`. Accept both.
  const importedRoadblocks = data.roadblock_cards || data.roadblockCards || data.roadblock_deck;
  if (Array.isArray(importedRoadblocks)) {
    next.roadblockCards = importedRoadblocks;
  }

  const importedCurses = data.curse_cards || data.curseCards || data.curse_deck;
  if (Array.isArray(importedCurses)) {
    next.curseCards = importedCurses;
  }

  next.powerups = powerupsFrom(
    Array.isArray(data.powerups) ? data.powerups : undefined,
    data.powerup_costs
  );

  if (data.ruleset && typeof data.ruleset === 'object') {
    next.ruleset = data.ruleset;
  }

  return next;
}
