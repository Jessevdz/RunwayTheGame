import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PlayLauncher } from './PlayLauncher';

const board = {
  id: 'b1',
  name: 'Harbour Loop',
  waypoint_count: 4,
  updated_at: '2026-01-01T00:00:00Z',
  is_listed: true,
  preview: null
};

const api = vi.hoisted(() => ({ createGame: vi.fn() }));

vi.mock('../../core/api/client', () => ({
  createGame: api.createGame,
  publishBoard: vi.fn(),
  getServerConfig: vi.fn().mockResolvedValue({ ai_referee: false }),
  ApiError: class ApiError extends Error {
    status = 500;
  }
}));
vi.mock('../../core/game/boardCatalog', () => ({ listRaceableBoards: vi.fn(async () => [{ ...board, mine: false }]) }));
vi.mock('../../core/map/RoutePreview', () => ({ RoutePreview: () => null }));
vi.mock('../../core/analytics/analyticsClient', () => ({ analytics: { track: vi.fn() } }));

const renderLauncher = () =>
  render(
    <MemoryRouter>
      <PlayLauncher />
    </MemoryRouter>
  );

describe('PlayLauncher', () => {
  beforeEach(() => {
    api.createGame.mockReset();
  });

  it('keeps the map list on screen when hosting fails and offers a retry', async () => {
    api.createGame.mockRejectedValue(new Error('Server is busy'));
    renderLauncher();
    const card = (await screen.findByText('Harbour Loop')).closest('.map-card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /(Host|Race this map)$/ }));
    expect(await screen.findByText('Server is busy')).toBeInTheDocument();
    expect(screen.getByText('Harbour Loop')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(api.createGame).toHaveBeenCalledTimes(2);
  });

  it('shows a plain sentence instead of a raw fetch error', async () => {
    api.createGame.mockRejectedValue(new TypeError('Failed to fetch'));
    renderLauncher();
    const card = (await screen.findByText('Harbour Loop')).closest('.map-card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /(Host|Race this map)$/ }));
    expect(await screen.findByText(/Couldn't reach the server/)).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });
});
