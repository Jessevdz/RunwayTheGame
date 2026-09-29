import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GameState } from '../../core/projection/projectionStore';
import type { TeamSession } from '../../core/game/teamSession';

const activatePowerup = vi.fn(async (..._args: unknown[]) => ({ status: 'ok' }));
vi.mock('../../core/api/client', () => ({
  buyPowerup: vi.fn(),
  activatePowerup: (...args: unknown[]) => activatePowerup(...args)
}));

import { ShopPanel } from './ShopPanel';

const session = { gameId: 'g1', teamId: 'me', teamToken: 'tok', teamName: 'Red', slotIndex: 0, homeWaypointId: 'a' } as TeamSession;

const gameState = {
  gameId: 'g1',
  mode: 'team',
  coins: { me: 5 },
  inventory: { me: ['nerf'] },
  teams: {
    me: { name: 'Red Fox', slotIndex: 0 },
    done: { name: 'Green Gecko', slotIndex: 3 },
    blue: { name: 'Blue Jay', slotIndex: 2 }
  },
  progress: { done: { reachedFinish: true }, blue: { reachedFinish: false } }
} as unknown as GameState;

describe('ShopPanel nerf targeting', () => {
  beforeEach(() => activatePowerup.mockClear());

  it('asks which rival to freeze and sends the chosen team', async () => {
    render(<ShopPanel session={session} gameState={gameState} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /use/i }));

    expect(activatePowerup).not.toHaveBeenCalled();
    expect(screen.getByText('Who gets the dart?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /green gecko/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /blue jay/i }));
    await waitFor(() => expect(activatePowerup).toHaveBeenCalledTimes(1));
    expect(activatePowerup.mock.calls[0][1]).toMatchObject({ powerup: 'nerf', target_team_id: 'blue' });
  });

  it('returns to the shop without using the dart when cancelled', () => {
    render(<ShopPanel session={session} gameState={gameState} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /use/i }));
    fireEvent.click(screen.getByRole('button', { name: /back to the shop/i }));
    expect(activatePowerup).not.toHaveBeenCalled();
    expect(screen.getByText(/owned power-ups/i)).toBeInTheDocument();
  });
});
