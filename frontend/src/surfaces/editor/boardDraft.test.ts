import { describe, expect, it } from 'vitest';
import {
  activeChallengeEntries,
  applyBoardToDraft,
  applyImportToDraft,
  buildBoardPayload,
  createEmptyDraft,
  type RawBoardFile
} from './boardDraft';

describe('boardDraft', () => {
  it('filters out challenges for finish waypoints and non-existent waypoints in activeChallengeEntries', () => {
    const draft = createEmptyDraft();
    draft.waypoints = [
      { id: 'wp-1', name: 'Start', lat: 0, lon: 0, arrival_radius_m: 25, isStart: true, isFinish: false },
      { id: 'wp-2', name: 'Middle', lat: 0, lon: 0, arrival_radius_m: 25, isStart: false, isFinish: false },
      { id: 'wp-finish', name: 'Finish', lat: 0, lon: 0, arrival_radius_m: 25, isStart: false, isFinish: true }
    ];
    draft.challenges = {
      'wp-1': { prompt: 'Prompt 1', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 },
      'wp-2': { prompt: 'Prompt 2', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 },
      'wp-finish': { prompt: 'Finish Prompt', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 },
      'wp-deleted': { prompt: 'Orphan Prompt', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 }
    };

    const entries = activeChallengeEntries(draft);
    expect(entries.map(([id]) => id)).toEqual(['wp-1', 'wp-2']);
  });

  it('buildBoardPayload maps challenges strictly to existing waypoints', () => {
    const draft = createEmptyDraft();
    draft.boardName = 'Test Map';
    draft.waypoints = [
      { id: 'wp-1', name: 'Start', lat: 10, lon: 20, arrival_radius_m: 25, isStart: true, isFinish: false },
      { id: 'wp-2', name: 'Finish', lat: 30, lon: 40, arrival_radius_m: 25, isStart: false, isFinish: true }
    ];
    draft.challenges = {
      'wp-1': { prompt: 'Start Prompt', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 },
      'wp-orphan': { prompt: 'Orphan Prompt', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 }
    };

    const payload = buildBoardPayload(draft);
    expect(payload.challenges).toHaveLength(1);
    expect(payload.challenges[0].waypoint_id).toBe('wp-1');
    expect(payload.challenges[0].prompt).toBe('Start Prompt');
    expect(payload.waypoints[0].challenge_id).toBe(payload.challenges[0].id);
    expect(payload.waypoints[1].challenge_id).toBeUndefined();
  });

  it('applyImportToDraft links challenges by matching waypoint_id', () => {
    const prev = createEmptyDraft();
    const rawFile: RawBoardFile = {
      name: 'Imported Map',
      waypoints: [
        { id: 'wp-a', name: 'Start', is_start: true, is_finish: false, lat: 0, lon: 0 },
        { id: 'wp-b', name: 'Checkpoint', is_start: false, is_finish: false, lat: 0, lon: 0 },
        { id: 'wp-c', name: 'Finish', is_start: false, is_finish: true, lat: 0, lon: 0 }
      ],
      challenges: [
        { waypoint_id: 'wp-a', prompt: 'Take photo at Start' },
        { waypoint_id: 'wp-b', prompt: 'Take photo at Checkpoint' }
      ]
    };

    const next = applyImportToDraft(prev, rawFile);
    expect(next.challenges['wp-a']?.prompt).toBe('Take photo at Start');
    expect(next.challenges['wp-b']?.prompt).toBe('Take photo at Checkpoint');
    expect(next.challenges['wp-c']).toBeUndefined();
  });

  it('applyImportToDraft reconciles disconnected challenge UUIDs to non-finish waypoints', () => {
    const prev = createEmptyDraft();
    const rawFile: RawBoardFile = {
      name: 'Disconnected Map',
      waypoints: [
        { id: 'real-wp-1', name: 'Start', is_start: true, is_finish: false, lat: 0, lon: 0 },
        { id: 'real-wp-2', name: 'Point B', is_start: false, is_finish: false, lat: 0, lon: 0 },
        { id: 'real-wp-finish', name: 'Finish', is_start: false, is_finish: true, lat: 0, lon: 0 }
      ],
      challenges: [
        { waypoint_id: 'foreign-id-1', prompt: 'Prompt for first waypoint' },
        { waypoint_id: 'foreign-id-2', prompt: 'Prompt for second waypoint' }
      ]
    };

    const next = applyImportToDraft(prev, rawFile);
    expect(next.challenges['real-wp-1']?.prompt).toBe('Prompt for first waypoint');
    expect(next.challenges['real-wp-2']?.prompt).toBe('Prompt for second waypoint');
    expect(next.challenges['real-wp-finish']).toBeUndefined();
    expect(next.challenges['foreign-id-1']).toBeUndefined();
  });

  it('applyBoardToDraft ignores challenges referencing deleted or finish waypoints', () => {
    const prev = createEmptyDraft();
    const next = applyBoardToDraft(prev, {
      id: 'board-1',
      version: 1,
      name: 'Server Board',
      waypoints: [
        { id: 'wp-1', name: 'Start', lat: 0, lon: 0, arrival_radius_m: 25, is_start: true, is_finish: false },
        { id: 'wp-finish', name: 'Finish', lat: 0, lon: 0, arrival_radius_m: 25, is_start: false, is_finish: true }
      ],
      roads: [],
      challenges: [
        { id: 'ch-1', waypoint_id: 'wp-1', prompt: 'Valid Prompt', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 },
        { id: 'ch-2', waypoint_id: 'wp-finish', prompt: 'Finish Prompt', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 },
        { id: 'ch-3', waypoint_id: 'wp-ghost', prompt: 'Ghost Prompt', rubric: { must_show: [], fails_if: [], acceptable_ambiguity: '' }, coin_reward: 20, veto_penalty_seconds: 900 }
      ],
      roadblock_deck: [],
      curse_deck: [],
      powerup_costs: {}
    });

    expect(Object.keys(next.challenges)).toEqual(['wp-1']);
    expect(next.challenges['wp-1'].prompt).toBe('Valid Prompt');
  });
});
