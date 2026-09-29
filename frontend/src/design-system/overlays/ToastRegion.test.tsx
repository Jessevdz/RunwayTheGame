import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastRegion } from './ToastRegion';
import { MAX_VISIBLE_TOASTS, clearToasts, showToast } from './toastStore';

afterEach(() => {
  act(() => clearToasts());
  vi.useRealTimers();
});

describe('ToastRegion', () => {
  it('sits at the top by default and has a polite and an assertive live region', () => {
    render(<ToastRegion />);
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveClass('toast-region--top');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('can be placed at the bottom', () => {
    render(<ToastRegion position="bottom" />);
    expect(screen.getByRole('region')).toHaveClass('toast-region--bottom');
  });

  it('announces calm toasts politely and errors assertively', () => {
    render(<ToastRegion />);
    act(() => {
      showToast('Saved', { tone: 'moss' });
      showToast('Upload failed', { tone: 'crimson' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed');
  });

  it('auto-dismisses after the duration', () => {
    vi.useFakeTimers();
    render(<ToastRegion />);
    act(() => {
      showToast('Gone soon', { duration: 1000 });
    });
    expect(screen.getByText('Gone soon')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.queryByText('Gone soon')).not.toBeInTheDocument();
  });

  it('keeps a toast with duration 0 until it is dismissed', async () => {
    render(<ToastRegion />);
    act(() => {
      showToast('Sticky', { duration: 0 });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Sticky')).not.toBeInTheDocument();
  });

  it('caps how many toasts are visible at once', () => {
    render(<ToastRegion />);
    act(() => {
      for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i += 1) showToast(`Toast ${i}`, { duration: 0 });
    });
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(screen.queryByText('Toast 0')).not.toBeInTheDocument();
  });
});
