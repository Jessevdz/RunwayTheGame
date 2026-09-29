import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, ConfirmSheet } from './ConfirmSheet';
import { useAlert, useConfirm } from './useConfirm';

const Asker: React.FC<{ onResult: (value: boolean) => void }> = ({ onResult }) => {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => onResult(await confirm({ title: 'Leave the race?', message: 'You will lose your place.' }))}
    >
      ask
    </button>
  );
};

describe('ConfirmSheet', () => {
  it('renders as a sheet-presented dialog with both actions', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmSheet title="Delete map?" onConfirm={onConfirm} onCancel={onCancel} confirmLabel="Delete">
        This cannot be undone.
      </ConfirmSheet>
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete map?' });
    expect(dialog).toHaveClass('dialog--sheet');
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('drops the cancel action for alerts', () => {
    render(<ConfirmSheet hideCancel confirmLabel="OK" />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('marks destructive confirmations', () => {
    render(<ConfirmSheet danger />);
    expect(screen.getByRole('dialog')).toHaveClass('confirm-sheet--danger');
  });
});

describe('useConfirm', () => {
  it('resolves true when confirmed', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Asker onResult={onResult} />
      </ConfirmProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'ask' }));
    expect(screen.getByRole('dialog', { name: 'Leave the race?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves false when cancelled', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Asker onResult={onResult} />
      </ConfirmProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'ask' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('resolves false on Escape', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Asker onResult={onResult} />
      </ConfirmProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'ask' }));
    await userEvent.keyboard('{Escape}');
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('falls back to window.confirm without a provider', async () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onResult = vi.fn();
    render(<Asker onResult={onResult} />);
    await userEvent.click(screen.getByRole('button', { name: 'ask' }));
    expect(spy).toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(true);
    spy.mockRestore();
  });
});

describe('useAlert', () => {
  it('shows a single acknowledge action and resolves on OK', async () => {
    const done = vi.fn();
    const Caller: React.FC = () => {
      const alert = useAlert();
      return (
        <button type="button" onClick={async () => { await alert({ title: 'Heads up' }); done(); }}>
          go
        </button>
      );
    };
    render(
      <ConfirmProvider>
        <Caller />
      </ConfirmProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(done).toHaveBeenCalled();
  });
});
