import { describe, expect, it } from 'vitest';
import { TEAM_SLOT_COUNT, teamColorVar, teamInitials, teamSlot } from './teamIdentity';

describe('teamSlot', () => {
  it('uses the server slot when the team is known', () => {
    expect(teamSlot('t1', { t1: { slotIndex: 3 } })).toBe(3);
  });

  it('wraps slots beyond the palette', () => {
    expect(teamSlot('t1', { t1: { slotIndex: TEAM_SLOT_COUNT + 2 } })).toBe(2);
    expect(teamSlot('t1', { t1: { slotIndex: -1 } })).toBe(TEAM_SLOT_COUNT - 1);
  });

  it('is stable for an unknown team and always inside the palette', () => {
    const first = teamSlot('0d6f-unknown');
    expect(teamSlot('0d6f-unknown')).toBe(first);
    for (const id of ['a', 'b', 'team-42', 'ffff-ffff']) {
      const slot = teamSlot(id);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(TEAM_SLOT_COUNT);
    }
  });
});

describe('team chip helpers', () => {
  it('points at the team colour token', () => {
    expect(teamColorVar(4)).toBe('var(--team-4)');
  });

  it('takes initials from the first two words', () => {
    expect(teamInitials('Red Fox')).toBe('RF');
    expect(teamInitials('penguins')).toBe('PE');
    expect(teamInitials('  ')).toBe('?');
  });
});
