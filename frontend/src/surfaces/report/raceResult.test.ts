import { describe, it, expect } from 'vitest';
import { makeReport, row } from './reportFixture';
import { buildStatTiles, computeRaceResult, entryMetric, ordinal, retentionNotice, soloElapsedSeconds } from './raceResult';

describe('ordinal', () => {
  it('handles teens and suffixes', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});

describe('computeRaceResult', () => {
  it('names a single winner and lists the next two places', () => {
    const report = makeReport({
      winner_team_id: 'a',
      standings: [
        row('a', { finished: true, distance_to_finish: 0, coins: 5 }),
        row('b', { waypoints_reached: 3, distance_to_finish: 50 }),
        row('c', { waypoints_reached: 2, distance_to_finish: 80 }),
        row('d', { waypoints_reached: 1, distance_to_finish: 90 }),
      ],
    });
    const result = computeRaceResult(report);
    expect(result.kind).toBe('winner');
    expect(result.leaders.map((l) => l.teamId)).toEqual(['a']);
    expect(result.runnersUp.map((r) => [r.teamId, r.place])).toEqual([['b', 2], ['c', 3]]);
    expect(result.ranked.map((r) => r.place)).toEqual([1, 2, 3, 4]);
  });

  it('keeps the recorded winner first even if the standings sort them lower', () => {
    const report = makeReport({
      winner_team_id: 'b',
      standings: [row('a', { finished: true, distance_to_finish: 0 }), row('b', { finished: true, distance_to_finish: 0 })],
    });
    const result = computeRaceResult(report);
    expect(result.kind).toBe('winner');
    expect(result.leaders[0].teamId).toBe('b');
    expect(result.runnersUp[0]).toMatchObject({ teamId: 'a', place: 2 });
  });

  it('reports a tie in a coin rush and skips the next place', () => {
    const report = makeReport({
      mode: 'coin_rush',
      standings: [
        row('a', { coins: 30, finish_rank: 1 }),
        row('b', { coins: 30, finish_rank: 1 }),
        row('c', { coins: 10 }),
      ],
    });
    const result = computeRaceResult(report);
    expect(result.kind).toBe('tie');
    expect(result.leaders.map((l) => l.teamId)).toEqual(['a', 'b']);
    expect(result.ranked.map((r) => r.place)).toEqual([1, 1, 3]);
    expect(result.runnersUp.map((r) => r.teamId)).toEqual(['c']);
  });

  it('does not invent a tie when coin balances are hidden', () => {
    const report = makeReport({
      mode: 'coin_rush',
      standings: [row('a', { coins: 0, coins_visible: false, finish_rank: 1 }), row('b', { coins: 0, coins_visible: false, finish_rank: 1 })],
    });
    expect(computeRaceResult(report).ranked.map((r) => r.place)).toEqual([1, 2]);
  });

  it('has no winner when nobody reached the finish', () => {
    const report = makeReport({
      standings: [row('a', { waypoints_reached: 2, distance_to_finish: 40 }), row('b', { waypoints_reached: 1, distance_to_finish: 70 })],
    });
    const result = computeRaceResult(report);
    expect(result.kind).toBe('no-finishers');
    expect(result.leaders.map((l) => l.teamId)).toEqual(['a']);
  });

  it('handles a race with no teams', () => {
    expect(computeRaceResult(makeReport()).kind).toBe('empty');
  });

  it('does not crown anyone in a race that is still open', () => {
    const report = makeReport({ status: 'live', standings: [row('a'), row('b')] });
    expect(computeRaceResult(report).kind).toBe('open');
  });

  it('reads a finished solo run as elapsed time plus penalties', () => {
    const report = makeReport({
      mode: 'solo_time_trial',
      clock: { started_at: '2026-01-01T10:00:00Z', finished_at: '2026-01-01T10:10:00Z', time_penalty_seconds: 30, veto_count: 1, skip_count: 0 },
      standings: [row('solo', { finished: true, distance_to_finish: 0 })],
    });
    const result = computeRaceResult(report);
    expect(result.kind).toBe('solo-finished');
    expect(result.soloSeconds).toBe(630);
    expect(result.runnersUp).toEqual([]);
  });

  it('marks a solo run that never finished as did not finish', () => {
    const report = makeReport({ mode: 'solo_casual', standings: [row('solo')] });
    const result = computeRaceResult(report);
    expect(result.kind).toBe('solo-dnf');
    expect(result.soloSeconds).toBeUndefined();
  });
});

describe('soloElapsedSeconds', () => {
  it('is undefined for unparseable timestamps', () => {
    const report = makeReport({ clock: { started_at: 'x', finished_at: 'y', time_penalty_seconds: 0, veto_count: 0, skip_count: 0 } });
    expect(soloElapsedSeconds(report)).toBeUndefined();
  });
});

describe('entryMetric', () => {
  it('uses coins and placement in a coin rush and waypoints otherwise', () => {
    const base = { teamId: 'a', teamName: 'A', place: 2, finished: false, waypoints: 1, coins: 12, coinsVisible: true, finishRank: 2, finishBonus: 3 };
    expect(entryMetric('coin_rush', base)).toBe('12 coins · 2nd across the line');
    expect(entryMetric('coin_rush', { ...base, coinsVisible: false, finishRank: 0 })).toBe('Coins hidden');
    expect(entryMetric('team', base)).toBe('1 waypoint');
    expect(entryMetric('team', { ...base, finished: true })).toBe('Reached the finish');
  });
});

describe('buildStatTiles', () => {
  it('leads with four tiles and pushes the rest behind the expander', () => {
    const tiles = buildStatTiles(makeReport());
    expect(tiles.key).toHaveLength(4);
    const ids = [...tiles.key, ...tiles.more].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tiles.more.length).toBeGreaterThan(3);
  });

  it('shows coins as the fourth tile of a coin rush and vetoes for solo runs', () => {
    expect(buildStatTiles(makeReport({ mode: 'coin_rush' })).key[3].id).toBe('coins-earned');
    expect(buildStatTiles(makeReport({ mode: 'solo_time_trial' })).key[3].id).toBe('vetoes');
  });

  it('omits conditional tiles when there is nothing to report', () => {
    const ids = buildStatTiles(makeReport()).more.map((t) => t.id);
    expect(ids).not.toContain('powerups');
    expect(ids).not.toContain('roadblocks');
    expect(ids).not.toContain('odd-arrivals');
  });
});

describe('retentionNotice', () => {
  const now = Date.parse('2026-01-10T10:00:00Z');

  it('returns a body so the notice is never empty', () => {
    const notice = retentionNotice(makeReport(), now);
    expect(notice?.body).toBeTruthy();
    expect(notice?.title).toBe('This report is deleted in 5 days');
    expect(notice?.kind).toBe('info');
  });

  it('warns close to expiry and says today on the last day', () => {
    const soon = retentionNotice(makeReport(), Date.parse('2026-01-14T00:00:00Z'));
    expect(soon?.kind).toBe('warn');
    expect(retentionNotice(makeReport(), Date.parse('2026-02-01T00:00:00Z'))?.title).toBe('This report expires today');
  });

  it('returns null without a usable expiry', () => {
    const report = makeReport();
    expect(retentionNotice({ ...report, retention: { ...report.retention, expires_at: '' } }, now)).toBeNull();
    expect(retentionNotice({ ...report, retention: { ...report.retention, expires_at: 'soon' } }, now)).toBeNull();
  });
});
