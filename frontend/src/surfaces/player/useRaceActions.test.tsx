import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as client from '../../core/api/client';
import type { GameState } from '../../core/projection/projectionStore';
import type { TeamSession } from '../../core/game/teamSession';
import { NO_FIX_MESSAGE } from './playerErrors';
import { useRaceActions } from './useRaceActions';

vi.mock('../../core/api/client', () => ({
  startChallenge: vi.fn(),
  vetoChallenge: vi.fn(),
  arriveWaypoint: vi.fn()
}));

const session: TeamSession = {
  gameId: 'game-1',
  teamId: 'team-1',
  teamToken: 'token',
  teamName: 'Red',
  slotIndex: 0,
  homeWaypointId: 'wp-0'
};

const gameState = { gameId: 'game-1' } as GameState;
const fix = { lat: 51.5, lon: 4.2, accuracy: 6 };

const setup = (playerLocation: typeof fix | null) =>
  renderHook(() =>
    useRaceActions({
      gameState,
      session,
      playerLocation,
      onStartChallenge: vi.fn(),
      resetOn: 'wp-1'
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRaceActions', () => {
  it('refuses to start a challenge with no GPS fix instead of sending 0, 0', async () => {
    const { result } = setup(null);

    await act(async () => {
      await result.current.startChallenge('wp-1');
    });

    expect(client.startChallenge).not.toHaveBeenCalled();
    expect(result.current.error).toBe(NO_FIX_MESSAGE);
  });

  it('refuses to record an arrival with no GPS fix', async () => {
    const { result } = setup(null);

    await act(async () => {
      await result.current.arrive('wp-1');
    });

    expect(client.arriveWaypoint).not.toHaveBeenCalled();
    expect(result.current.error).toBe(NO_FIX_MESSAGE);
  });

  it('sends the real position when there is a fix', async () => {
    vi.mocked(client.arriveWaypoint).mockResolvedValue({ status: 'arrived' });
    const { result } = setup(fix);

    await act(async () => {
      await result.current.arrive('wp-1');
    });

    expect(client.arriveWaypoint).toHaveBeenCalledWith(
      'game-1',
      expect.objectContaining({ lat: 51.5, lon: 4.2, accuracy_m: 6 })
    );
    expect(result.current.error).toBeNull();
  });

  it('shows plain language instead of the raw server message', async () => {
    vi.mocked(client.arriveWaypoint).mockRejectedValue(
      Object.assign(new Error('GPS verification failed: you are 84 m from the waypoint with 12 m GPS accuracy; get within 13 m'), {
        status: 422
      })
    );
    const { result } = setup(fix);

    await act(async () => {
      await result.current.arrive('wp-1');
    });

    expect(result.current.error).toBe("You're still about 84 m out. Get within 13 m and try again.");
  });

  it('ignores a second tap while a command is still on its way', async () => {
    let finish: (value: { status: string }) => void = () => {};
    vi.mocked(client.arriveWaypoint).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { result } = setup(fix);

    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.arrive('wp-1');
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      await result.current.arrive('wp-1');
    });
    expect(client.arriveWaypoint).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ status: 'arrived' });
      await first;
    });
    expect(result.current.busy).toBe(false);
  });
});
