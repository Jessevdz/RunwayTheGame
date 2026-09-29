import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from './Sheet';
import { clampOffset, computeOffsets, resolveSnap, stepSnap, toggleSnap } from './sheetSnap';

const offsets = computeOffsets(800, 400, 100);

describe('sheet snap logic', () => {
  it('computes offsets from measured sizes', () => {
    expect(offsets).toEqual({ expanded: 0, peek: 400, collapsed: 700 });
  });

  it('never lets the peek offset pass the collapsed offset', () => {
    expect(computeOffsets(800, 50, 100).peek).toBe(700);
  });

  it('steps up and down and stops at the ends', () => {
    expect(stepSnap('collapsed', 'up')).toBe('peek');
    expect(stepSnap('peek', 'up')).toBe('expanded');
    expect(stepSnap('expanded', 'up')).toBe('expanded');
    expect(stepSnap('expanded', 'down')).toBe('peek');
    expect(stepSnap('collapsed', 'down')).toBe('collapsed');
  });

  it('toggles between collapsed and peek', () => {
    expect(toggleSnap('collapsed')).toBe('peek');
    expect(toggleSnap('peek')).toBe('collapsed');
    expect(toggleSnap('expanded')).toBe('collapsed');
  });

  it('clamps drag offsets to the travel range', () => {
    expect(clampOffset(-50, offsets)).toBe(0);
    expect(clampOffset(900, offsets)).toBe(700);
    expect(clampOffset(250, offsets)).toBe(250);
  });

  it('settles on the nearest snap when released at rest', () => {
    expect(resolveSnap(offsets, 30)).toBe('expanded');
    expect(resolveSnap(offsets, 380)).toBe('peek');
    expect(resolveSnap(offsets, 650)).toBe('collapsed');
  });

  it('lets a downward fling carry past the nearest snap', () => {
    expect(resolveSnap(offsets, 300, 2)).toBe('collapsed');
  });

  it('lets an upward fling carry past the nearest snap', () => {
    expect(resolveSnap(offsets, 450, -2)).toBe('expanded');
  });
});

describe('Sheet', () => {
  it('keeps the summary visible when collapsed and hides the body', () => {
    render(
      <Sheet defaultSnap="collapsed" summary={<span>Next stop 120 m</span>}>
        <button type="button">Inside</button>
      </Sheet>
    );
    expect(screen.getByText('Next stop 120 m')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Inside' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('exposes the snap state as a class and data attribute', () => {
    render(<Sheet defaultSnap="peek" label="race panel" />);
    const region = screen.getByRole('region', { name: 'race panel' });
    expect(region).toHaveClass('sheet--peek');
    expect(region).toHaveAttribute('data-snap', 'peek');
  });

  it('gives the handle a tap-target class hook and an accessible name', () => {
    render(<Sheet defaultSnap="peek" label="race panel" />);
    expect(screen.getByRole('button', { name: 'Collapse race panel' })).toHaveClass('sheet__handle');
  });

  it('steps the snap with arrow keys and reports each change', async () => {
    const onSnapChange = vi.fn();
    render(<Sheet defaultSnap="collapsed" onSnapChange={onSnapChange} />);
    const handle = screen.getByRole('button');
    handle.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(onSnapChange).toHaveBeenLastCalledWith('peek');
    await userEvent.keyboard('{ArrowUp}');
    expect(onSnapChange).toHaveBeenLastCalledWith('expanded');
    await userEvent.keyboard('{ArrowDown}');
    expect(onSnapChange).toHaveBeenLastCalledWith('peek');
    expect(screen.getByRole('region')).toHaveClass('sheet--peek');
  });

  it('toggles from the keyboard with Enter', async () => {
    const onSnapChange = vi.fn();
    render(<Sheet defaultSnap="collapsed" onSnapChange={onSnapChange} />);
    screen.getByRole('button').focus();
    await userEvent.keyboard('{Enter}');
    expect(onSnapChange).toHaveBeenCalledWith('peek');
  });

  it('follows the controlled snap prop and does not change on its own', async () => {
    const onSnapChange = vi.fn();
    const { rerender } = render(<Sheet snap="collapsed" onSnapChange={onSnapChange} />);
    screen.getByRole('button').focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(onSnapChange).toHaveBeenCalledWith('peek');
    expect(screen.getByRole('region')).toHaveClass('sheet--collapsed');
    rerender(<Sheet snap="expanded" onSnapChange={onSnapChange} />);
    expect(screen.getByRole('region')).toHaveClass('sheet--expanded');
  });

  it('reports onSettle after a snap change', () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    const { rerender } = render(<Sheet snap="collapsed" onSettle={onSettle} />);
    rerender(<Sheet snap="expanded" onSettle={onSettle} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle.mock.calls[0][0]).toBe('expanded');
    vi.useRealTimers();
  });

  it('moves the sheet with transform during a drag and commits on release', () => {
    const onSnapChange = vi.fn();
    render(<Sheet defaultSnap="expanded" onSnapChange={onSnapChange} />);
    const region = screen.getByRole('region');
    const handle = screen.getByRole('button');
    Object.defineProperty(region, 'offsetHeight', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });

    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(handle, { clientY: 500, pointerId: 1, pointerType: 'touch' });
    expect(region.style.transform).toContain('translate3d');
    expect(region).toHaveClass('sheet--dragging');
    expect(onSnapChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { clientY: 500, pointerId: 1, pointerType: 'touch' });
    expect(region.style.transform).toBe('');
    expect(region).not.toHaveClass('sheet--dragging');
    expect(onSnapChange).toHaveBeenCalledTimes(1);
  });
});
