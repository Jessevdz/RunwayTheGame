import { describe, expect, it } from 'vitest';
import { OTHER_ROUTE, routeShape } from './routeShape';

describe('routeShape', () => {
  it('separates board reads, writes and deletes on the same path', () => {
    expect(routeShape('/api/boards/abc-123/', 'GET')).toBe('boards.get');
    expect(routeShape('/api/boards/abc-123/', 'PUT')).toBe('boards.update');
    expect(routeShape('/api/boards/abc-123', 'DELETE')).toBe('boards.delete');
  });

  it('separates listing boards from creating one', () => {
    expect(routeShape('/api/boards/', 'GET')).toBe('boards.list');
    expect(routeShape('/api/boards/?ids=a,b', 'GET')).toBe('boards.list');
    expect(routeShape('/api/boards/', 'POST')).toBe('boards.create');
  });

  it('classifies nested board actions ahead of the bare resource', () => {
    expect(routeShape('/api/boards/abc/publish', 'POST')).toBe('boards.publish');
    expect(routeShape('/api/boards/abc/validate', 'POST')).toBe('boards.validate');
    expect(routeShape('/api/boards/abc/visibility', 'POST')).toBe('boards.visibility');
    expect(routeShape('/api/boards/abc/fork', 'POST')).toBe('boards.fork');
    expect(routeShape('/api/boards/abc/decks/curse', 'PUT')).toBe('boards.decks');
    expect(routeShape('/api/boards/abc/waypoints/w1/challenges', 'POST')).toBe('boards.challenges');
    expect(routeShape('/api/boards/abc/leaderboard?limit=1', 'GET')).toBe('leaderboard');
  });

  it('classifies the game routes the play loop uses', () => {
    expect(routeShape('/api/games/', 'POST')).toBe('games.create');
    expect(routeShape('/api/games/solo', 'POST')).toBe('games.create');
    expect(routeShape('/api/games/g1', 'GET')).toBe('games.get');
    expect(routeShape('/api/games/by-code/ABCD', 'GET')).toBe('games.get');
    expect(routeShape('/api/games/g1/join', 'POST')).toBe('games.join');
    expect(routeShape('/api/games/g1/teams/t1/join', 'POST')).toBe('games.join');
    expect(routeShape('/api/games/g1/report', 'GET')).toBe('games.report');
    expect(routeShape('/api/games/g1/submission', 'POST')).toBe('games.submission');
    expect(routeShape('/api/games/g1/position', 'POST')).toBe('games.position');
    expect(routeShape('/api/games/g1/shop/buy', 'POST')).toBe('games.powerup');
    expect(routeShape('/api/games/g1/powerup/use', 'POST')).toBe('games.powerup');
  });

  it('never returns a path for something it cannot classify', () => {
    expect(routeShape('/api/bug-reports/abc-123', 'DELETE')).toBe(OTHER_ROUTE);
    expect(routeShape('/api/admin/session', 'POST')).toBe(OTHER_ROUTE);
  });

  it('ignores the query string when deciding a shape', () => {
    expect(routeShape('/api/config?cache=0', 'GET')).toBe('config');
    expect(routeShape('/api/roadmap?status=open', 'GET')).toBe('roadmap');
  });
});
