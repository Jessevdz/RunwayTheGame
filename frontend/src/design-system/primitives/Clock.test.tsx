import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Clock } from './Clock';
import { formatClockFace, spokenClock } from './clockFormat';
import { Progress } from './Progress';

describe('Clock', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatClockFace(261)).toBe('04:21');
    expect(formatClockFace(3725)).toBe('1:02:05');
    expect(formatClockFace(-5)).toBe('00:00');
  });

  it('speaks a readable time', () => {
    expect(spokenClock(261)).toBe('4 minutes 21 seconds');
    expect(spokenClock(3661)).toBe('1 hour 1 minute 1 second');
    expect(spokenClock(9)).toBe('9 seconds');
  });

  it('labels the timer and uses Flap tiles when asked', () => {
    const { container, rerender } = render(<Clock seconds={261} />);
    expect(screen.getByRole('timer', { name: '4 minutes 21 seconds' })).toBeInTheDocument();
    expect(container.querySelector('.flap')).toBeNull();
    rerender(<Clock seconds={261} flap />);
    expect(container.querySelector('.flap')).not.toBeNull();
  });
});

describe('Progress', () => {
  it('exposes progressbar semantics and clamps the value', () => {
    render(<Progress value={12} max={8} label="Waypoints" valueText="8 of 8" />);
    const bar = screen.getByRole('progressbar', { name: 'Waypoints' });
    expect(bar).toHaveAttribute('aria-valuenow', '8');
    expect(bar).toHaveAttribute('aria-valuetext', '8 of 8');
  });

  it('renders the arc variant with the ArcMark motif', () => {
    const { container } = render(<Progress value={50} label="Arc" variant="arc" />);
    expect(container.querySelector('.arc-mark')).not.toBeNull();
  });
});
