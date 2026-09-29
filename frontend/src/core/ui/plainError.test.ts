import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { plainError } from './plainError';

describe('plainError', () => {
  it('rewrites network failures', () => {
    expect(plainError(new TypeError('Failed to fetch'), 'x')).toMatch(/connection/);
  });

  it('rewrites server errors', () => {
    expect(plainError(new ApiError(503, 'upstream'), 'x')).toMatch(/our side/);
  });

  it('keeps short API messages and falls back otherwise', () => {
    expect(plainError(new ApiError(400, 'Name is required'), 'x')).toBe('Name is required');
    expect(plainError('weird', 'Could not load maps.')).toBe('Could not load maps.');
  });
});
