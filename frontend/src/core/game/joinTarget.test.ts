import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeRaceCode,
  looksLikeRaceCode,
  looksLikeUrl,
  parseJoinInput
} from './joinTarget';
import { resolveJoinTarget, JoinError } from './resolveJoinTarget';

const getGameByCode = vi.hoisted(() => vi.fn());
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    getGameByCode
  };
});

describe('joinTarget.ts helpers', () => {
  it('normalizes race codes by trimming, uppercasing, and stripping whitespace and hyphens', () => {
    expect(normalizeRaceCode(' 234-567 ')).toBe('234567');
    expect(normalizeRaceCode('abc_def')).toBe('ABCDEF');
  });

  it('validates race codes with looksLikeRaceCode', () => {
    expect(looksLikeRaceCode('234567')).toBe(true);
    expect(looksLikeRaceCode('BCDFGH')).toBe(true);
    // Invalid characters: vowels (A, E, I, O, U) or digits (0, 1) not in alphabet
    expect(looksLikeRaceCode('AAAAAA')).toBe(false);
    expect(looksLikeRaceCode('123456')).toBe(false);
    expect(looksLikeRaceCode('SHORT')).toBe(false);
  });

  it('detects URLs with looksLikeUrl', () => {
    expect(looksLikeUrl('/join/12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(looksLikeUrl('https://example.com/join')).toBe(true);
    expect(looksLikeUrl('http://localhost:5173')).toBe(true);
    expect(looksLikeUrl('234567')).toBe(false);
  });
});

describe('parseJoinInput', () => {
  it('returns null for empty or invalid strings', () => {
    expect(parseJoinInput('')).toBeNull();
    expect(parseJoinInput('   ')).toBeNull();
    expect(parseJoinInput('invalid string here')).toBeNull();
  });

  it('parses bare race codes', () => {
    const res = parseJoinInput('234567');
    expect(res).toEqual({ kind: 'code', code: '234567' });
  });

  it('parses bare UUID game IDs', () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const res = parseJoinInput(uuid);
    expect(res).toEqual({ kind: 'gameId', gameId: uuid });
  });

  it('parses URL invite links extracting query parameters and path gameId', () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const url = `https://runway.example.com/join/${uuid}?teamId=team-1&slotIndex=2&name=Speedsters`;
    const res = parseJoinInput(url);

    expect(res).toEqual({
      kind: 'link',
      gameId: uuid,
      apiBase: undefined,
      teamToken: undefined,
      teamId: 'team-1',
      teamCode: undefined,
      slotIndex: 2,
      teamName: 'Speedsters'
    });
  });

  it('extracts teamToken strictly from URL hash fragment and ignores query string tokens', () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';

    // Query token should be ignored (security against referrer/proxy leakage)
    const queryUrl = `https://runway.example.com/join?gameId=${uuid}&teamToken=LEAKED-TOKEN`;
    const queryRes = parseJoinInput(queryUrl);
    expect(queryRes).not.toBeNull();
    if (queryRes && queryRes.kind === 'link') {
      expect(queryRes.teamToken).toBeUndefined();
    }

    // Hash token should be extracted
    const hashUrl = `https://runway.example.com/join?gameId=${uuid}&teamId=team-1#teamToken=VALID-CAPABILITY`;
    const hashRes = parseJoinInput(hashUrl);
    expect(hashRes).not.toBeNull();
    if (hashRes && hashRes.kind === 'link') {
      expect(hashRes.teamToken).toBe('VALID-CAPABILITY');
      expect(hashRes.teamId).toBe('team-1');
    }
  });
});

describe('resolveJoinTarget', () => {
  beforeEach(() => {
    localStorage.clear();
    getGameByCode.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves race code via getGameByCode and records race in local storage', async () => {
    getGameByCode.mockResolvedValueOnce({
      game_id: '12345678-1234-1234-1234-123456789abc',
      race_code: '234567',
      board_name: 'Antwerp Sprint',
      status: 'draft',
      team_count: 4
    });

    const res = await resolveJoinTarget({ kind: 'code', code: '234567' });

    expect(res).toEqual({
      gameId: '12345678-1234-1234-1234-123456789abc',
      boardName: 'Antwerp Sprint',
      raceCode: '234567',
      status: 'draft',
      teamCount: 4
    });

    const stored = localStorage.getItem('runway:races');
    expect(stored).toContain('12345678-1234-1234-1234-123456789abc');
  });

  it('persists team session when invite link carries teamToken and teamId in hash fragment', async () => {
    const target = parseJoinInput(
      'https://runway.example.com/join?gameId=12345678-1234-1234-1234-123456789abc&teamId=team-1&name=Racers#teamToken=SECRET'
    );
    expect(target).not.toBeNull();

    const resolved = await resolveJoinTarget(target!);
    expect(resolved.gameId).toBe('12345678-1234-1234-1234-123456789abc');

    const sessionRaw = localStorage.getItem('runway:session:12345678-1234-1234-1234-123456789abc');
    expect(sessionRaw).not.toBeNull();
    const session = JSON.parse(sessionRaw!);
    expect(session.teamToken).toBe('SECRET');
    expect(session.teamId).toBe('team-1');
    expect(session.teamName).toBe('Racers');
  });

  it('does not set hardNavigateTo for untrusted custom apiBase', async () => {
    const target = parseJoinInput(
      'https://runway.example.com/join?gameId=12345678-1234-1234-1234-123456789abc&api=http%3A%2F%2F192.168.1.50'
    );
    expect(target).not.toBeNull();

    const resolved = await resolveJoinTarget(target!);
    expect(resolved.hardNavigateTo).toBeUndefined();
  });

  it('throws JoinError when getGameByCode rejects with not found error', async () => {
    const { ApiError } = await import('../api/client');
    getGameByCode.mockRejectedValueOnce(new ApiError(404, 'Not found'));

    await expect(resolveJoinTarget({ kind: 'code', code: '234567' })).rejects.toThrow(JoinError);
  });
});

