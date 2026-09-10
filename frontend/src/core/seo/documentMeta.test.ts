import { describe, it, expect } from 'vitest';
import { metaFor } from './documentMeta';

/** Every public surface, and nothing else, may carry a canonical instead of a `noindex`. */
const INDEXABLE = ['/', '/gallery', '/roadmap'];

const SESSION_PATHS = [
  '/race/abc123',
  '/race/abc123/report',
  '/host/abc123',
  '/join/abc123',
  '/design/abc123',
  '/races',
  '/solo',
  '/host',
  '/design',
  '/admin',
  '/admin/secret-key',
  '/roadmap/admin/secret-key',
  '/play',
];

describe('metaFor', () => {
  it('marks exactly the public surfaces indexable', () => {
    for (const path of INDEXABLE) {
      expect(metaFor(path).indexable, path).toBe(true);
    }
  });

  it('never indexes a session, device-local or admin surface', () => {
    for (const path of SESSION_PATHS) {
      expect(metaFor(path).indexable, path).toBe(false);
    }
  });

  it('falls back to the not-found entry for an unknown path', () => {
    expect(metaFor('/no-such-route').indexable).toBe(false);
    expect(metaFor('/no-such-route').title).toContain('Not found');
  });

  it('ignores a trailing slash', () => {
    expect(metaFor('/gallery/')).toEqual(metaFor('/gallery'));
    expect(metaFor('//')).toEqual(metaFor('/'));
  });

  it('gives every surface a distinct, non-empty title and description', () => {
    const paths = [...INDEXABLE, ...SESSION_PATHS];
    for (const path of paths) {
      const meta = metaFor(path);
      expect(meta.title.length, path).toBeGreaterThan(0);
      expect(meta.description.length, path).toBeGreaterThan(0);
    }
    // The landing page owns the bare wordmark title; the rest are suffixed.
    expect(metaFor('/').title).not.toContain('|');
    expect(metaFor('/gallery').title).toContain('| Runway');
  });
});
