import { describe, expect, it } from 'vitest';
import { NO_FIX_MESSAGE, playerErrorMessage } from './playerErrors';

const api = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('playerErrorMessage', () => {
  it('turns the out-of-range gate into a distance to close', () => {
    const err = api(
      422,
      'GPS verification failed: you are 84 m from the waypoint with 12 m GPS accuracy; get within 13 m'
    );
    expect(playerErrorMessage(err, 'arrive')).toBe("You're still about 84 m out. Get within 13 m and try again.");
  });

  it('explains poor accuracy without quoting limits', () => {
    const err = api(422, 'GPS verification failed: GPS accuracy of 90 m is too poor to confirm arrival (limit 50 m) - wait');
    expect(playerErrorMessage(err, 'arrive')).toMatch(/accurate enough/);
  });

  it('explains the speed gate', () => {
    const err = api(422, 'GPS verification failed: implausible velocity (40 m/s). Stay where you are for a few seconds and try again.');
    expect(playerErrorMessage(err, 'arrive')).toMatch(/too fast/);
  });

  it('explains freezes and cooldowns', () => {
    expect(playerErrorMessage(api(403, 'team is frozen'), 'start')).toMatch(/frozen/);
    expect(playerErrorMessage(api(403, 'team is under a veto cooldown and cannot take on a challenge yet'), 'start')).toMatch(
      /cooldown/
    );
  });

  it('explains a duplicate photo', () => {
    const err = api(409, 'an earlier evidence submission for this challenge is still being reviewed');
    expect(playerErrorMessage(err, 'photo')).toMatch(/still being checked/);
  });

  it('says nothing was sent when the network is down', () => {
    expect(playerErrorMessage(new TypeError('Failed to fetch'), 'start')).toMatch(/nothing was sent/);
  });

  it('never leaks raw server text for an unknown failure', () => {
    const message = playerErrorMessage(api(400, 'invalid request body: json: cannot unmarshal'), 'start');
    expect(message).toBe("Couldn't start the challenge. Try again.");
    expect(message).not.toMatch(/json/);
  });

  it('maps server faults and rate limits to plain advice', () => {
    expect(playerErrorMessage(api(500, 'failed to record arrival: pq: deadlock'), 'arrive')).toMatch(/our side/);
    expect(playerErrorMessage(api(429, 'position reported too frequently'), 'arrive')).toMatch(/Too many/);
  });

  it('falls back per action for a bare throw', () => {
    expect(playerErrorMessage(undefined, 'veto')).toBe("Couldn't skip that challenge. Try again.");
    expect(playerErrorMessage('boom', 'end')).toBe("Couldn't end the run. Try again.");
  });

  it('exposes a plain no-fix message', () => {
    expect(NO_FIX_MESSAGE).toMatch(/GPS/);
  });
});
