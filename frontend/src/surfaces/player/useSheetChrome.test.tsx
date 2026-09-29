import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlayerSheet, useSheetAttention } from './useSheetChrome';

beforeEach(() => {
  localStorage.clear();
});

describe('usePlayerSheet', () => {
  it('starts folded and remembers where it was left', () => {
    const first = renderHook(() => usePlayerSheet());
    expect(first.result.current.snap).toBe('collapsed');

    act(() => first.result.current.setSnap('expanded'));
    first.unmount();

    const second = renderHook(() => usePlayerSheet());
    expect(second.result.current.snap).toBe('expanded');
  });

  it('opens a folded panel to peek but leaves an open one alone', () => {
    const { result } = renderHook(() => usePlayerSheet());

    act(() => result.current.openToPeek());
    expect(result.current.snap).toBe('peek');

    act(() => result.current.setSnap('expanded'));
    act(() => result.current.openToPeek());
    expect(result.current.snap).toBe('expanded');
  });
});

describe('useSheetAttention', () => {
  it('does not fire for a key already present at mount', () => {
    const open = vi.fn();
    const { result } = renderHook(() => useSheetAttention('go:here', open));

    expect(result.current).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the panel and restarts the pulse when the key changes to a new alert', () => {
    const open = vi.fn();
    const { result, rerender } = renderHook(({ alert }) => useSheetAttention(alert, open), {
      initialProps: { alert: null as string | null }
    });

    rerender({ alert: 'go:arrive' });
    expect(result.current).toBe(1);
    expect(open).toHaveBeenCalledTimes(1);

    rerender({ alert: 'go:arrive' });
    expect(result.current).toBe(1);

    rerender({ alert: null });
    rerender({ alert: 'challenge:next' });
    expect(result.current).toBe(2);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
