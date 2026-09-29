import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultHero } from './ResultHero';
import { computeRaceResult } from './raceResult';
import { makeReport, row } from './reportFixture';

function renderHero(report: ReturnType<typeof makeReport>) {
  return render(<ResultHero report={report} result={computeRaceResult(report)} />);
}

describe('ResultHero', () => {
  it('leads with the winner and lists the runners-up', () => {
    renderHero(
      makeReport({
        winner_team_id: 'a',
        standings: [row('a', { finished: true, distance_to_finish: 0 }), row('b', { waypoints_reached: 2 })],
      })
    );
    expect(screen.getByText('WINNER')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('A');
    expect(screen.getByRole('list', { name: 'Runners-up' })).toHaveTextContent('2nd');
  });

  it('names every team on a tie', () => {
    renderHero(
      makeReport({
        mode: 'coin_rush',
        standings: [row('a', { coins: 9, finish_rank: 1 }), row('b', { coins: 9, finish_rank: 1 })],
      })
    );
    expect(screen.getByText('TIED FOR FIRST')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('AB');
  });

  it('shows the time for a finished solo run', () => {
    renderHero(
      makeReport({
        mode: 'solo_time_trial',
        clock: { started_at: '2026-01-01T10:00:00Z', finished_at: '2026-01-01T10:12:05Z', time_penalty_seconds: 0, veto_count: 0, skip_count: 0 },
        standings: [row('solo', { finished: true })],
      })
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('12:05');
    expect(screen.queryByRole('list', { name: 'Runners-up' })).not.toBeInTheDocument();
  });

  it('says so when nobody finished or nobody came', () => {
    const { unmount } = renderHero(makeReport({ standings: [row('a'), row('b')] }));
    expect(screen.getByText('NO ONE FINISHED')).toBeInTheDocument();
    unmount();
    renderHero(makeReport());
    expect(screen.getByText('NO TEAMS')).toBeInTheDocument();
  });
});
