import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CelebrationOverlay } from './CelebrationOverlay';
import type { PendingCelebration } from '../../core/game/useRaceMoments';

const celebration: PendingCelebration = {
  moment: { key: 'cleared:b', kind: 'cleared', waypointId: 'b', coinsGained: 5 },
  copy: {
    eyebrow: 'Challenge',
    title: 'Cleared!',
    detail: 'Bridge',
    unlocked: '1 road out now open: Finish.',
    next: 'Next stop: Finish',
    coins: '+5 coins'
  }
};

describe('CelebrationOverlay', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('shows what happened, what it unlocked and the next target', () => {
    render(<CelebrationOverlay celebration={celebration} onContinue={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Cleared!' })).toBeInTheDocument();
    expect(screen.getByText('1 road out now open: Finish.')).toBeInTheDocument();
    expect(screen.getByText('Next stop: Finish')).toBeInTheDocument();
    expect(screen.getByText(/\+5 coins/)).toBeInTheDocument();
  });

  it('continues from the big button and from Escape', () => {
    const onContinue = vi.fn();
    render(<CelebrationOverlay celebration={celebration} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onContinue).toHaveBeenCalledTimes(2);
  });

  it('vibrates where the browser can', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    render(<CelebrationOverlay celebration={celebration} onContinue={() => {}} />);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('renders quietly with no vibration support', () => {
    Reflect.deleteProperty(navigator, 'vibrate');
    expect(() => render(<CelebrationOverlay celebration={celebration} onContinue={() => {}} />)).not.toThrow();
  });
});
