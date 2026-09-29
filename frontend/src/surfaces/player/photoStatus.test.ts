import { describe, expect, it } from 'vitest';
import type { SubmissionInfo } from '../../core/projection/projectionStore';
import { captureKey, derivePhotoState } from './photoStatus';

const sub = (over: Partial<SubmissionInfo>): SubmissionInfo => ({
  submissionId: 's1',
  teamId: 'team-1',
  waypointId: 'wp-1',
  roadId: '',
  challengeId: 'ch-1',
  blobRef: 'b',
  status: 'pending',
  confidence: 0,
  rationale: '',
  source: '',
  createdAt: '2026-01-01T10:00:00Z',
  ...over
});

const base = {
  teamId: 'team-1',
  waypointId: 'wp-1',
  queued: new Set<string>(),
  now: Date.parse('2026-01-01T10:00:42Z')
};

describe('derivePhotoState', () => {
  it('is none when nothing has been sent', () => {
    expect(derivePhotoState({ ...base, submissions: {} })).toEqual({ kind: 'none' });
  });

  it('counts the seconds a photo has been with the grader', () => {
    expect(derivePhotoState({ ...base, submissions: { s1: sub({}) } })).toEqual({
      kind: 'pending',
      elapsedSeconds: 42
    });
  });

  it('ignores other teams and other waypoints', () => {
    const submissions = { a: sub({ teamId: 'team-2' }), b: sub({ waypointId: 'wp-2' }) };
    expect(derivePhotoState({ ...base, submissions })).toEqual({ kind: 'none' });
  });

  it('keeps a waypoint challenge apart from a road challenge at the same waypoint', () => {
    const submissions = { s1: sub({ roadId: 'road-1' }) };
    expect(derivePhotoState({ ...base, submissions })).toEqual({ kind: 'none' });
    expect(derivePhotoState({ ...base, submissions, roadId: 'road-1' }).kind).toBe('pending');
  });

  it('reports a photo saved offline', () => {
    const queued = new Set([captureKey('wp-1')]);
    expect(derivePhotoState({ ...base, submissions: {}, queued })).toEqual({ kind: 'queued' });
  });

  it('reports the latest rejection with its reason', () => {
    const submissions = { s1: sub({ status: 'fail', rationale: 'Too dark.' }) };
    expect(derivePhotoState({ ...base, submissions })).toEqual({ kind: 'rejected', rationale: 'Too dark.' });
  });

  it('lets a newer pending photo replace an older rejection', () => {
    const submissions = {
      s1: sub({ status: 'fail', createdAt: '2026-01-01T09:00:00Z' }),
      s2: sub({ submissionId: 's2', createdAt: '2026-01-01T10:00:00Z' })
    };
    expect(derivePhotoState({ ...base, submissions }).kind).toBe('pending');
  });

  it('never runs the elapsed time backwards', () => {
    const state = derivePhotoState({ ...base, submissions: { s1: sub({}) }, now: Date.parse('2026-01-01T09:59:00Z') });
    expect(state).toEqual({ kind: 'pending', elapsedSeconds: 0 });
  });
});
