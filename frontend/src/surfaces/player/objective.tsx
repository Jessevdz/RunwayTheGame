import React from 'react';
import { isCoinRush, isSoloMode, type GameState } from '../../core/projection/projectionStore';
import { type GPSPosition } from '../../core/player/locationService';
import { type TeamSession } from '../../core/game/teamSession';
import { getTeamName } from '../../core/team/palette';
import { formatClock, formatDurationWords } from '../../core/format/clock';
import { IconCoin } from '@ds';
import { formatDistance, ordinal } from './consoleFormat';
import { type RaceClock } from './useRaceClock';
import { type RaceRouteView } from './useRaceRoute';

/** What the objective card is currently saying. */
export interface ObjectiveView {
  tone: 'go' | 'challenge' | 'stop' | 'block' | 'done' | 'idle';
  title: string;
  say?: React.ReactNode;
  readout?: { value: string; unit: string };
  primary?: { label: string; icon: string; disabled?: boolean; onClick: () => void };
  minor?: { label: string; onClick: () => void };
}

export interface ObjectiveInput {
  gameState: GameState;
  session: TeamSession;
  playerLocation: GPSPosition | null;
  clock: RaceClock;
  route: RaceRouteView;
  /** The three things the card's buttons can ask for. */
  on: {
    startChallenge: (waypointId: string, roadId?: string) => void;
    arrive: (waypointId: string) => void;
    /** Opens the confirmation dialog for skipping a challenge. */
    askVeto: (waypointId: string, roadId?: string) => void;
  };
}

/** Computes current objective card view state based on race state and clock. */
export function buildObjective({
  gameState,
  session,
  playerLocation,
  clock,
  route,
  on
}: ObjectiveInput): ObjectiveView {
  const { currentWaypoint, isCurrentWaypointCleared, routes, destination } = route;
  const { freezeLeft, vetoLeft, countdownLeft, countdownRunning, runElapsed } = clock;

  const solo = isSoloMode(gameState.mode);
  const timeTrial = gameState.mode === 'solo_time_trial';
  const coinRush = isCoinRush(gameState.mode);
  const coins = gameState.coins[session.teamId] || 0;
  /** Veto penalties read from server ruleset. */
  const vetoTimePenalty = gameState.ruleset.vetoTimePenaltySeconds;
  const vetoCooldown = gameState.ruleset.vetoPenaltyMinSeconds;

  if (gameState.winner || gameState.state === 'ended') {
    const iWon = gameState.winner === session.teamId;
    if (solo) {
      if (gameState.winner) {
        return {
          tone: 'done',
          title: timeTrial ? formatClock(runElapsed) : 'You made it',
          say: timeTrial
            ? 'That is your time, penalties included.'
            : 'The whole route, at your own pace. Nothing to post, nothing to beat.'
        };
      }
      return {
        tone: 'done',
        title: 'Ended early',
        say: timeTrial
          ? 'This time trial was ended before reaching the finish line. No time was posted.'
          : 'This walk was ended before reaching the finish line.'
      };
    }
    if (coinRush && gameState.winner) {
      const winnerCoins = gameState.standings.find((s) => s.teamId === gameState.winner)?.coins;
      return {
        tone: 'done',
        title: iWon ? 'You won' : `${getTeamName(gameState.winner, gameState.teams)} won`,
        say: winnerCoins == null
          ? 'The winner’s coin balance is hidden in this view.'
          : <><IconCoin /> {winnerCoins} banked. {iWon ? 'Richest on the board.' : 'Full breakdown is below.'}</>,
        readout: { value: `${coins}`, unit: 'your final coins' }
      };
    }
    return {
      tone: 'done',
      title: gameState.winner
        ? (iWon ? 'You won' : `${getTeamName(gameState.winner, gameState.teams)} won`)
        : 'Race ended early',
      say: gameState.winner
        ? (iWon ? 'First to the finish. Nice legs.' : 'The finish has been claimed. Final standings are below.')
        : 'This race was ended by the host.'
    };
  }

  if (freezeLeft > 0) {
    return {
      tone: 'stop',
      title: 'Hold position',
      say: 'A nerf dart has you. You cannot start challenges or record arrivals until it wears off.',
      readout: { value: formatClock(freezeLeft), unit: 'until you thaw' }
    };
  }

  if (!currentWaypoint) {
    return { tone: 'idle', title: 'Loading the route', say: 'Waiting for the race to reach this device.' };
  }

  if (!isCurrentWaypointCleared) {
    const skipLabel = timeTrial
      ? `Skip it (+${formatClock(vetoTimePenalty)})`
      : solo
        ? 'Skip this challenge'
        : `Skip it (${formatDurationWords(vetoCooldown)} penalty)`;
    if (vetoLeft > 0) {
      return {
        tone: 'stop',
        title: currentWaypoint.name,
        say: 'You cannot start another challenge or skip one while this cooldown is active. Wait for it to end, then clear or skip this challenge.',
        readout: { value: formatClock(vetoLeft), unit: 'until challenges unlock' }
      };
    }
    return {
      tone: 'challenge',
      title: currentWaypoint.name,
      say: 'Photograph the challenge here to open the roads out of this waypoint.',
      primary: { label: 'Do the challenge', icon: '📸', onClick: () => on.startChallenge(currentWaypoint.id) },
      minor: { label: skipLabel, onClick: () => on.askVeto(currentWaypoint.id) }
    };
  }

  if (currentWaypoint.isFinish || route.reachedFinish) {
    if (coinRush) {
      const mine = gameState.coinRush?.finishers.find((f) => f.teamId === session.teamId);
      return {
        tone: 'done',
        title: mine ? `Banked · ${ordinal(mine.rank)} place` : 'Banked',
        say: mine?.bonusCoins
          ? `+${mine.bonusCoins} coins for the finish. Your score is settled — the shop is closed to you now.`
          : 'Your score is settled. The shop is closed to you now.',
        readout: countdownRunning
          ? { value: formatClock(countdownLeft), unit: 'until the race is called' }
          : { value: `${coins}`, unit: 'coins banked' }
      };
    }
    return { tone: 'done', title: 'You made it', say: 'Nothing left to clear. Standings are below.' };
  }

  if (routes.length === 0) {
    return {
      tone: 'idle',
      title: currentWaypoint.name,
      say: 'No roads lead out of this waypoint. Ask the host to check the board.'
    };
  }

  if (!destination) {
    return { tone: 'idle', title: 'Choosing a route', say: 'Pick where you are heading next.' };
  }

  const next = destination.waypoint;

  if (destination.road.challengeId && destination.road.lockState === 'locked') {
    const skipLabel = timeTrial
      ? `Skip it (+${formatClock(vetoTimePenalty)})`
      : solo
        ? 'Skip this challenge'
        : `Skip it (${formatDurationWords(vetoCooldown)} penalty)`;
    if (vetoLeft > 0) {
      return {
        tone: 'stop',
        title: `Road to ${next.name}`,
        say: 'You cannot start another challenge or skip one while this cooldown is active. Wait for it to end, then clear or skip this road challenge.',
        readout: { value: formatClock(vetoLeft), unit: 'until challenges unlock' }
      };
    }
    return {
      tone: 'challenge',
      title: `Road to ${next.name}`,
      say: 'Photograph the challenge on this road from the waypoint where you are standing to open this route.',
      primary: {
        label: 'Do the road challenge',
        icon: '📸',
        onClick: () => on.startChallenge(currentWaypoint.id, destination.road.id)
      },
      minor: { label: skipLabel, onClick: () => on.askVeto(currentWaypoint.id, destination.road.id) }
    };
  }

  /* Roadblock objective inactive for current PoC
  if (destination.blocked) {
    return {
      tone: 'block',
      title: `Blocked to ${next.name}`,
      say: `${getTeamName(destination.roadblock.placedBy, gameState.teams)} left a card on this road: “${destination.roadblock.challengeText}”`,
      primary: {
        label: 'Clear the roadblock',
        icon: '🚧',
        onClick: () => onClearRoadblock(destination.road.id, destination.roadblock.challengeText)
      }
    };
  }
  */

  const wideGps = !!playerLocation && playerLocation.accuracy > next.arrival_radius_m;
  return {
    tone: destination.inRange ? 'go' : 'idle',
    title: next.name,
    readout:
      destination.distance === null
        ? { value: '—', unit: 'waiting for GPS' }
        : destination.inRange
          ? { value: String(Math.round(destination.distance)), unit: 'metres — inside the zone' }
          : formatDistance(destination.distance),
    say: destination.inRange
      ? 'You are inside the arrival zone. Record it to take the waypoint.'
      : destination.distance === null
        ? 'No position yet. Step into the open so your phone can find satellites.'
        : wideGps
          ? `Arrive within ${next.arrival_radius_m} m. Your GPS is only accurate to ±${Math.round(playerLocation!.accuracy)} m, which may hold the arrival back.`
          : `Get within ${next.arrival_radius_m} m to record your arrival.`,
    primary: {
      label: destination.inRange ? "I'm here" : 'Keep walking',
      icon: '🏁',
      disabled: !destination.inRange,
      onClick: () => on.arrive(next.id)
    }
  };
}
