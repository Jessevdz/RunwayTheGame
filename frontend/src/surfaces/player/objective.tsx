import React from 'react';
import { isCoinRush, isSoloMode, type GameState } from '../../core/projection/projectionStore';
import { type GPSPosition } from '../../core/player/locationService';
import { bearingDegrees } from '../../core/player/bearing';
import { type GpsStatus } from '../../core/player/gpsStatus';
import { type TeamSession } from '../../core/game/teamSession';
import { getTeamName } from '../../core/team/palette';
import { formatClock, formatDurationWords } from '../../core/format/clock';
import { Icon, type IconName } from '@ds';
import { formatDistance, ordinal } from './consoleFormat';
import { type PhotoState } from './photoStatus';
import { type RaceClock } from './useRaceClock';
import { type RaceRouteView } from './useRaceRoute';

/** Where the next stop lies from here, for the arrow beside the distance. */
export interface ObjectiveGuide {
  /** Compass bearing to the target, degrees clockwise from north. */
  bearing: number;
  /** Metres to the target. */
  distance: number;
  inRange: boolean;
  targetName: string;
}

/** What the objective card is currently saying. */
export interface ObjectiveView {
  tone: 'go' | 'challenge' | 'stop' | 'block' | 'done' | 'idle';
  title: string;
  say?: React.ReactNode;
  /** A countdown also carries its seconds, so a roomy card can draw it on split-flap tiles. */
  readout?: { value: string; unit: string; clockSeconds?: number };
  /** Honest state of a photo already sent or saved, shown instead of inviting a second one. */
  status?: { kind: 'pending' | 'queued' | 'rejected'; text: string };
  guide?: ObjectiveGuide;
  /** True when the card is about the next stop, so the field bar draws a direction arrow even before there is a fix. */
  showArrow?: boolean;
  primary?: { label: string; icon: IconName; disabled?: boolean; onClick: () => void };
  minor?: { label: string; onClick: () => void };
}

export interface ObjectiveInput {
  gameState: GameState;
  session: TeamSession;
  playerLocation: GPSPosition | null;
  clock: RaceClock;
  route: RaceRouteView;
  /** State of the photo for the current waypoint's challenge and for the chosen road's challenge. */
  photos: { waypoint: PhotoState; road: PhotoState };
  gps: GpsStatus;
  /** True while a command is in flight, so the button cannot send it twice. */
  busy: boolean;
  /** The three things the card's buttons can ask for. */
  on: {
    startChallenge: (waypointId: string, roadId?: string) => void;
    arrive: (waypointId: string) => void;
    /** Opens the confirmation dialog for skipping a challenge. */
    askVeto: (waypointId: string, roadId?: string) => void;
  };
}

/** Longest rejection reason shown on the card. */
const REASON_MAX = 140;

/** The words for a photo that has left the player's hands but not yet become a result. */
export function photoStatusLine(photo: PhotoState, verification: GameState['ruleset']['verification']): ObjectiveView['status'] {
  if (photo.kind === 'pending') {
    const who = verification === 'host' ? 'your host' : verification === 'trust' ? 'the group' : 'the referee';
    return { kind: 'pending', text: `With ${who}, ${formatClock(photo.elapsedSeconds)}` };
  }
  if (photo.kind === 'queued') {
    return { kind: 'queued', text: 'Saved on this phone. It sends when you are back online.' };
  }
  if (photo.kind === 'rejected') {
    const reason = photo.rationale.length > REASON_MAX ? `${photo.rationale.slice(0, REASON_MAX)}…` : photo.rationale;
    return { kind: 'rejected', text: reason ? `Not accepted: ${reason}` : 'Your last photo was not accepted.' };
  }
  return undefined;
}

/** Computes current objective card view state based on race state and clock. */
export function buildObjective({
  gameState,
  session,
  playerLocation,
  clock,
  route,
  photos,
  gps,
  busy,
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
            ? 'Penalties included.'
            : 'Route complete.'
        };
      }
      return {
        tone: 'done',
        title: 'Ended early',
        say: timeTrial
          ? 'You ended this run before the finish. No time posted.'
          : 'You ended this walk before the finish.'
      };
    }
    if (coinRush && gameState.winner) {
      const winnerCoins = gameState.standings.find((s) => s.teamId === gameState.winner)?.coins;
      return {
        tone: 'done',
        title: iWon ? 'You won' : `${getTeamName(gameState.winner, gameState.teams)} won`,
        say: winnerCoins == null ? undefined : <><Icon name="coin" /> {winnerCoins} banked.</>,
        readout: { value: `${coins}`, unit: 'your final coins' }
      };
    }
    return {
      tone: 'done',
      title: gameState.winner
        ? (iWon ? 'You won' : `${getTeamName(gameState.winner, gameState.teams)} won`)
        : 'Race ended early',
      say: gameState.winner
        ? (iWon ? 'First to the finish.' : 'Final standings below.')
        : 'Ended by the host.'
    };
  }

  if (freezeLeft > 0) {
    return {
      tone: 'stop',
      title: 'Hold position',
      say: 'Hit by a nerf dart. No challenges or arrivals until it wears off.',
      readout: { value: formatClock(freezeLeft), unit: 'until you thaw', clockSeconds: freezeLeft }
    };
  }

  if (!currentWaypoint) {
    return { tone: 'idle', title: 'Loading the route', say: 'Waiting for the race.' };
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
        say: 'Challenges and skips are locked during the cooldown.',
        readout: { value: formatClock(vetoLeft), unit: 'until challenges unlock', clockSeconds: vetoLeft }
      };
    }
    const photo = photos.waypoint;
    const status = photoStatusLine(photo, gameState.ruleset.verification);
    if (photo.kind === 'pending' || photo.kind === 'queued') {
      return {
        tone: 'challenge',
        title: currentWaypoint.name,
        status,
        say: photo.kind === 'pending' ? 'Hang tight. We will tell you the moment it is graded.' : 'Nothing more to do here until it sends.'
      };
    }
    return {
      tone: 'challenge',
      title: currentWaypoint.name,
      status,
      say: status ? 'Take another photo to try again.' : 'Clear the challenge to open the roads out.',
      primary: {
        label: photo.kind === 'rejected' ? 'Take another photo' : 'Do the challenge',
        icon: 'camera',
        disabled: busy,
        onClick: () => on.startChallenge(currentWaypoint.id)
      },
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
          ? `+${mine.bonusCoins} finish bonus. Score locked, shop closed.`
          : 'Score locked, shop closed.',
        readout: countdownRunning
          ? { value: formatClock(countdownLeft), unit: 'until the race is called', clockSeconds: countdownLeft }
          : { value: `${coins}`, unit: 'coins banked' }
      };
    }
    return { tone: 'done', title: 'You made it', say: 'Standings below.' };
  }

  if (routes.length === 0) {
    return {
      tone: 'idle',
      title: currentWaypoint.name,
      say: 'No roads lead out of here. Ask the host.'
    };
  }

  if (!destination) {
    return { tone: 'idle', title: 'Choosing a route', say: 'Pick your next stop.' };
  }

  const next = destination.waypoint;
  const guide: ObjectiveGuide | undefined =
    playerLocation && destination.distance !== null
      ? {
          bearing: bearingDegrees(playerLocation, next),
          distance: destination.distance,
          inRange: destination.inRange,
          targetName: next.name
        }
      : undefined;

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
        say: 'Challenges and skips are locked during the cooldown.',
        readout: { value: formatClock(vetoLeft), unit: 'until challenges unlock', clockSeconds: vetoLeft }
      };
    }
    const photo = photos.road;
    const status = photoStatusLine(photo, gameState.ruleset.verification);
    if (photo.kind === 'pending' || photo.kind === 'queued') {
      return {
        tone: 'challenge',
        title: `Road to ${next.name}`,
        status,
        guide,
        showArrow: true,
        say: photo.kind === 'pending' ? 'Hang tight. We will tell you the moment it is graded.' : 'Nothing more to do until it sends.'
      };
    }
    return {
      tone: 'challenge',
      title: `Road to ${next.name}`,
      status,
      guide,
      showArrow: true,
      say: status ? 'Take another photo to try again.' : 'Clear this road’s challenge to open the route.',
      primary: {
        label: photo.kind === 'rejected' ? 'Take another photo' : 'Do the road challenge',
        icon: 'camera',
        disabled: busy,
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
        icon: 'barrier',
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
          ? { value: String(Math.round(destination.distance)), unit: 'metres, in the zone' }
          : formatDistance(destination.distance),
    guide,
    showArrow: true,
    say: destination.inRange
      ? 'In the arrival zone. Record it to take the waypoint.'
      : destination.distance === null
        ? gps.detail || 'No GPS yet. Step into the open.'
        : wideGps
          ? `Get within ${next.arrival_radius_m} m. GPS accuracy is ±${Math.round(playerLocation!.accuracy)} m, which may delay arrival.`
          : `Get within ${next.arrival_radius_m} m to arrive.`,
    primary: {
      label: destination.inRange ? "I'm here" : 'Keep walking',
      icon: 'flag',
      disabled: !destination.inRange || busy,
      onClick: () => on.arrive(next.id)
    }
  };
}
