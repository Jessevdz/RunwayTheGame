import { isSoloMode, type GameState } from '../projection/projectionStore';
import { getTeamName } from '../team/palette';
import type { CelebrationMoment, RivalEvent } from './raceMoments';

/** What the full-screen celebration says, already in plain words. */
export interface CelebrationCopy {
  eyebrow: string;
  title: string;
  /** Where it happened, such as a waypoint name. */
  detail?: string;
  /** What this opened up. */
  unlocked?: string;
  /** Where to go from here. */
  next?: string;
  coins?: string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Names of the stops reachable from a waypoint by roads this team has not walked, skipping stops it already passed. */
const stopsOutOf = (state: GameState, waypointId: string, teamId: string): string[] => {
  const walked = new Set(state.progress[teamId]?.traversedRoads ?? []);
  const passed = new Set(state.progress[teamId]?.clearedWaypoints ?? []);
  const names: string[] = [];
  state.roads.forEach((road) => {
    if (walked.has(road.id)) return;
    const other = road.waypointA === waypointId ? road.waypointB : road.waypointB === waypointId ? road.waypointA : '';
    const name = other && !passed.has(other) ? state.waypoints.find((w) => w.id === other)?.name : undefined;
    if (name) names.push(name);
  });
  return names;
};

const nextLine = (stops: string[]): string | undefined => {
  if (stops.length === 0) return undefined;
  if (stops.length === 1) return `Next stop: ${stops[0]}`;
  return 'Next: choose your route';
};

/** Words for a celebration, read from the state the moment happened in. */
export function describeCelebration(moment: CelebrationMoment, state: GameState, teamId: string): CelebrationCopy {
  const waypoint = moment.waypointId ? state.waypoints.find((w) => w.id === moment.waypointId) : undefined;
  const coins = moment.coinsGained > 0 ? `+${moment.coinsGained} ${plural(moment.coinsGained, 'coin', 'coins')}` : undefined;
  const solo = isSoloMode(state.mode);

  switch (moment.kind) {
    case 'won':
      return solo
        ? { eyebrow: 'Route complete', title: 'You made it!', detail: waypoint?.name, coins }
        : { eyebrow: 'First to the line', title: 'You won!', detail: 'Your team crossed the finish first.', coins };

    case 'finished':
      return {
        eyebrow: 'Finish',
        title: 'You made it!',
        detail: waypoint?.name,
        next: state.mode === 'coin_rush' ? 'Your score is locked in.' : 'Standings are in the panel.',
        coins
      };

    case 'cleared': {
      if (moment.roadId) {
        const road = state.roads.find((r) => r.id === moment.roadId);
        const here = state.progress[teamId]?.currentWaypointId;
        const to = road ? (road.waypointA === here ? road.waypointB : road.waypointA) : '';
        const name = state.waypoints.find((w) => w.id === to)?.name;
        return {
          eyebrow: 'Challenge',
          title: 'Cleared!',
          detail: name ? `Road to ${name}` : undefined,
          unlocked: name ? `The road to ${name} is open.` : 'The road is open.',
          next: name ? `Next stop: ${name}` : undefined,
          coins
        };
      }
      const stops = moment.waypointId ? stopsOutOf(state, moment.waypointId, teamId) : [];
      return {
        eyebrow: 'Challenge',
        title: 'Cleared!',
        detail: waypoint?.name,
        unlocked:
          stops.length === 0
            ? undefined
            : `${stops.length} ${plural(stops.length, 'road', 'roads')} out now open: ${stops.join(', ')}.`,
        next: nextLine(stops),
        coins
      };
    }

    case 'arrived': {
      const hasChallenge = !!waypoint?.challengeId && !state.waypointStates[waypoint.id]?.clearedBy?.[teamId];
      const stops = moment.waypointId ? stopsOutOf(state, moment.waypointId, teamId) : [];
      return {
        eyebrow: 'Arrived',
        title: 'You’re here!',
        detail: waypoint?.name,
        next: hasChallenge ? 'Next: clear the challenge here.' : nextLine(stops),
        coins
      };
    }
  }
}

/** One short sentence for the pop-up a rival event earns. */
export function describeRivalEvent(event: RivalEvent, state: GameState): { text: string; tone: 'gold' | 'rust' | 'crimson' } {
  const who = getTeamName(event.teamId, state.teams);
  switch (event.kind) {
    case 'nerfed':
      return { text: 'A rival froze your team. Hold position until the timer ends.', tone: 'crimson' };
    case 'rival_finished':
      return { text: `${who} reached the finish.`, tone: 'gold' };
    case 'rival_won':
      return { text: `${who} won the race.`, tone: 'gold' };
    case 'countdown_started': {
      const minutes = Math.max(1, Math.round((event.seconds ?? 0) / 60));
      return { text: `A team is home. The coin rush ends in ${minutes} min.`, tone: 'rust' };
    }
  }
}
