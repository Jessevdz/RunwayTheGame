import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GetReadyCard } from './GetReadyCard';

const setNavigator = (props: Record<string, unknown>) => {
  Object.entries(props).forEach(([key, value]) =>
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true })
  );
};

afterEach(() => {
  setNavigator({ permissions: undefined, mediaDevices: undefined, geolocation: undefined });
});

describe('GetReadyCard', () => {
  it('explains that nothing is captured or sent and shows unsupported rows without a button', async () => {
    setNavigator({ permissions: undefined, mediaDevices: undefined, geolocation: undefined });
    render(<GetReadyCard />);
    expect(screen.getByText(/no photo is taken/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('NOT AVAILABLE')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /allow/i })).not.toBeInTheDocument();
  });

  it('shows how to fix a blocked location and recovers after a re-check', async () => {
    const getCurrentPosition = vi
      .fn()
      .mockImplementationOnce((_ok: unknown, err: (e: unknown) => void) => err({ code: 1 }))
      .mockImplementationOnce((ok: (p: unknown) => void) => ok({}));
    setNavigator({ permissions: undefined, mediaDevices: undefined, geolocation: { getCurrentPosition } });
    render(<GetReadyCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow location' }));
    expect(await screen.findByText('BLOCKED')).toBeInTheDocument();
    expect(screen.getByText(/to Allow|Location Services/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByText('READY')).toBeInTheDocument());
  });
});
