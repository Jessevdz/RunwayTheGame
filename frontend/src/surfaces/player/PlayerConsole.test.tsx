import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { projectionStore } from '../../core/projection/projectionStore';
import type { TeamSession } from '../../core/game/teamSession';
import { PlayerConsole } from './PlayerConsole';

vi.mock('../../core/api/client', () => ({
  startChallenge: vi.fn(),
  vetoChallenge: vi.fn(),
  arriveWaypoint: vi.fn()
}));

const session: TeamSession = {
  gameId: 'game-1',
  teamId: 'team-1',
  teamToken: 't',
  teamName: 'Red',
  slotIndex: 0,
  homeWaypointId: 'a'
};

const snapshot = {
  game_id: 'game-1',
  board: {
    id: 'board-1',
    name: 'Board',
    waypoints: [
      { id: 'a', name: 'Old Market', lat: 51.0, lon: 4.0, arrival_radius_m: 25, is_start: true, is_finish: false, challenge_id: 'c1' },
      { id: 'b', name: 'Harbour', lat: 51.01, lon: 4.0, arrival_radius_m: 25, is_start: false, is_finish: true }
    ],
    roads: []
  }
};

const renderConsole = (location: { lat: number; lon: number; accuracy: number } | null) =>
  render(
    <MemoryRouter>
      <PlayerConsole
        playerLocation={location}
        gps={{ error: null, lastFixAt: location ? Date.now() : null }}
        session={session}
        destinationChoice={{ id: null, set: vi.fn() }}
        onLeave={vi.fn()}
        onStartChallenge={vi.fn()}
        onClearRoadblock={vi.fn()}
      />
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  projectionStore.reset();
});

describe('PlayerConsole field bar', () => {
  it('starts folded until something needs attention', () => {
    renderConsole({ lat: 51, lon: 4, accuracy: 8 });
    expect(screen.getByRole('region', { name: 'Race panel' })).toHaveAttribute('data-snap', 'collapsed');
  });

  it('keeps the target, primary action, coins and GPS state in the always-visible strip', async () => {
    renderConsole({ lat: 51, lon: 4, accuracy: 8 });
    await act(async () => {
      projectionStore.applySnapshot(snapshot as never);
    });

    const panel = screen.getByRole('region', { name: 'Race panel' });
    // The unlocked challenge opens the folded panel by itself.
    expect(panel).toHaveAttribute('data-snap', 'peek');

    const strip = panel.querySelector<HTMLElement>('.field-bar')!;
    expect(within(strip).getByText('Old Market')).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: /do the challenge/i })).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: /coins/i })).toBeInTheDocument();
    expect(within(strip).getByRole('status')).toHaveTextContent('GPS');
  });

  it('shows a finding-GPS chip and no coordinates before the first fix', async () => {
    renderConsole(null);
    await act(async () => {
      projectionStore.applySnapshot(snapshot as never);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Finding GPS');
  });
});
