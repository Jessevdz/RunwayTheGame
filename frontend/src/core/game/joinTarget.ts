/** Pure helper functions for parsing player join inputs (race code, URL, or game ID). */

export type JoinTarget =
  | {
      kind: 'link';
      gameId: string;
      apiBase?: string;
      teamToken?: string;
      teamId?: string;
      teamCode?: string;
      slotIndex?: number;
      teamName?: string;
    }
  | { kind: 'gameId'; gameId: string }
  | { kind: 'code'; code: string };

// Character alphabet for 6-character race codes.
const JOIN_CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
const JOIN_CODE_LENGTH = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeRaceCode(raw: string): string {
  return raw.trim().replace(/[\s\-_]/g, '').toUpperCase();
}

export function looksLikeRaceCode(raw: string): boolean {
  const code = normalizeRaceCode(raw);
  if (code.length !== JOIN_CODE_LENGTH) return false;
  return [...code].every((c) => JOIN_CODE_ALPHABET.includes(c));
}

/** True for values that should not be converted to uppercase. */
export function looksLikeUrl(raw: string): boolean {
  const value = raw.trim();
  return value.startsWith('/') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function parseIntOrUndefined(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseJoinInput(raw: string): JoinTarget | null {
  const value = raw.trim();
  if (!value) return null;

  // 1. A full invite link, or a path copied out of the address bar.
  if (looksLikeUrl(value)) {
    let url: URL;
    try {
      url = new URL(value, window.location.origin);
    } catch {
      return null;
    }
    const q = url.searchParams;
    let gameId = (q.get('gameId') || q.get('game') || '').trim();
    if (!gameId) {
      const last = url.pathname.split('/').filter(Boolean).pop() || '';
      if (UUID_RE.test(last)) gameId = last;
    }
    if (!gameId) return null;

    // Capability tokens must never ride in the query string (they are captured
    // by proxies, history and shared links); only a URL-hash fragment may carry one.
    const frag = new URLSearchParams(url.hash.replace(/^#/, ''));
    const hashToken = frag.get('teamToken') || frag.get('token') || undefined;

    return {
      kind: 'link',
      gameId,
      apiBase: q.get('api') || undefined,
      teamToken: hashToken,
      teamId: q.get('teamId') || q.get('team') || undefined,
      teamCode: q.get('teamCode') || q.get('code') || undefined,
      slotIndex: parseIntOrUndefined(q.get('slotIndex') || q.get('slot')),
      teamName: q.get('teamName') || q.get('name') || undefined,
    };
  }

  // 2. A bare game id.
  if (UUID_RE.test(value)) {
    return { kind: 'gameId', gameId: value };
  }

  // 3. A race code.
  if (looksLikeRaceCode(value)) {
    return { kind: 'code', code: normalizeRaceCode(value) };
  }

  return null;
}
