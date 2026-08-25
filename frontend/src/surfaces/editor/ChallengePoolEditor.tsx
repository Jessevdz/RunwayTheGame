import React, { useEffect, useMemo, useState } from 'react';
import { Select, Input, Chip } from '@ds';
import { IconCoin } from './components/EditorIcons';

export interface ChallengeDraft {
  id?: string;
  prompt: string;
  rubric: {
    must_show: string[];
    fails_if: string[];
    acceptable_ambiguity: string;
  };
  coin_reward: number;
  veto_penalty_seconds: number;
}

interface EditorWaypoint {
  id: string;
  name: string;
  isStart?: boolean;
  isFinish?: boolean;
}

interface EditorRoad {
  waypoint_id_a: string;
  waypoint_id_b: string;
}

interface ChallengePoolEditorProps {
  waypoints: EditorWaypoint[];
  /** Roads used to order waypoints in visiting order. */
  roads?: EditorRoad[];
  challenges: { [waypointId: string]: ChallengeDraft };
  /** Selected waypoint ID. */
  selectedWaypointId: string | null;
  onSelectWaypoint: (waypointId: string) => void;
  onChangeChallenges: (updated: { [waypointId: string]: ChallengeDraft }) => void;
}

/** Natural sort comparator for waypoint names. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sorts waypoints by visiting order starting from the start waypoint. */
function orderWaypointsForPicker(
  waypoints: EditorWaypoint[],
  roads: EditorRoad[]
): EditorWaypoint[] {
  const start = waypoints.find((w) => w.isStart);

  const hops = new Map<string, number>();
  if (start) {
    const adjacency = new Map<string, string[]>();
    for (const s of roads) {
      if (!adjacency.has(s.waypoint_id_a)) adjacency.set(s.waypoint_id_a, []);
      if (!adjacency.has(s.waypoint_id_b)) adjacency.set(s.waypoint_id_b, []);
      adjacency.get(s.waypoint_id_a)!.push(s.waypoint_id_b);
      adjacency.get(s.waypoint_id_b)!.push(s.waypoint_id_a);
    }

    hops.set(start.id, 0);
    const queue = [start.id];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      for (const neighbour of adjacency.get(current) || []) {
        if (hops.has(neighbour)) continue;
        hops.set(neighbour, hops.get(current)! + 1);
        queue.push(neighbour);
      }
    }
  }

  // 0 start · 1 on the route · 2 not connected to the start
  const group = (w: EditorWaypoint) => {
    if (w.isStart) return 0;
    return hops.has(w.id) ? 1 : 2;
  };

  return waypoints.filter((w) => !w.isFinish).sort((a, b) => {
    const groupDelta = group(a) - group(b);
    if (groupDelta !== 0) return groupDelta;

    const hopDelta = (hops.get(a.id) ?? Infinity) - (hops.get(b.id) ?? Infinity);
    if (hopDelta !== 0 && Number.isFinite(hopDelta)) return hopDelta;

    return byName.compare(a.name || a.id, b.name || b.id);
  });
}

/** Default veto penalty duration in seconds. */
export const DEFAULT_VETO_PENALTY_SECONDS = 900;

const VETO_PENALTY_OPTIONS = [
  { label: '15 Minutes', value: 900 },
  { label: '30 Minutes', value: 1800 },
  { label: '1 Hour', value: 3600 },
  { label: '1.5 Hours', value: 5400 },
  { label: '2 Hours', value: 7200 },
  { label: '2.5 Hours', value: 9000 },
  { label: '3 Hours', value: 10800 },
  { label: '3.5 Hours', value: 12600 },
  { label: '4 Hours', value: 14400 }
];

export const ChallengePoolEditor: React.FC<ChallengePoolEditorProps> = ({
  waypoints,
  roads = [],
  challenges,
  selectedWaypointId,
  onSelectWaypoint,
  onChangeChallenges
}) => {
  const [rawMustShow, setRawMustShow] = useState<string | null>(null);
  const [rawFailsIf, setRawFailsIf] = useState<string | null>(null);
  const [prevWaypointId, setPrevWaypointId] = useState<string>('');
  const [rubricOpen, setRubricOpen] = useState(false);

  const orderedWaypoints = useMemo(
    () => orderWaypointsForPicker(waypoints, roads),
    [waypoints, roads]
  );

  /** Checks if the finish waypoint is selected. */
  const finishWaypoint = waypoints.find((w) => w.isFinish) ?? null;
  const finishSelected = !!finishWaypoint && finishWaypoint.id === selectedWaypointId;

  const hasSelection = orderedWaypoints.some((w) => w.id === selectedWaypointId);
  const currentWaypointId = hasSelection ? selectedWaypointId! : orderedWaypoints[0]?.id ?? '';

  // This tab always edits *some* waypoint, so arriving with nothing selected
  // adopts the first one on the route — and says so on the map, rather than
  // editing a waypoint the map shows as unselected.
  useEffect(() => {
    if (!hasSelection && !finishSelected && currentWaypointId) onSelectWaypoint(currentWaypointId);
  }, [hasSelection, finishSelected, currentWaypointId, onSelectWaypoint]);

  if (finishSelected) {
    return (
      <div className="empty">
        <p className="fs-4">
          <strong>{finishWaypoint!.name || 'The finish'}</strong> is the finish line, and the finish
          line has no challenge. Reaching it is the objective: arriving logs the end of the race, and
          nothing else has to happen there.
        </p>
      </div>
    );
  }

  if (orderedWaypoints.length === 0) {
    return (
      <div className="empty">
        <p className="fs-4">
          {waypoints.length === 0
            ? 'No map waypoints available. Add waypoints on the elements tab first.'
            : 'The only waypoint on this map is the finish, which has no challenge. Add another waypoint on the elements tab.'}
        </p>
      </div>
    );
  }

  const currentWaypoint = orderedWaypoints.find((w) => w.id === currentWaypointId)!;

  // A blank rubric on purpose: for "photograph this thing" — which is nearly
  // every challenge — the prompt is the whole standard, and criteria seeded by the
  // editor are criteria nobody chose that the referee still enforces.
  const challenge: ChallengeDraft = challenges[currentWaypointId] || {
    prompt: '',
    rubric: {
      must_show: [],
      fails_if: [],
      acceptable_ambiguity: ''
    },
    coin_reward: 20,
    veto_penalty_seconds: DEFAULT_VETO_PENALTY_SECONDS
  };

  const criteriaCount =
    challenge.rubric.must_show.length +
    challenge.rubric.fails_if.length +
    (challenge.rubric.acceptable_ambiguity.trim() ? 1 : 0);

  if (prevWaypointId !== currentWaypointId) {
    setPrevWaypointId(currentWaypointId);
    setRawMustShow(null);
    setRawFailsIf(null);
    // Criteria already written stay visible; a waypoint with none opens on
    // the prompt alone, which is all most challenges ever need.
    setRubricOpen(criteriaCount > 0);
  }

  const handleUpdateField = (field: keyof ChallengeDraft, value: any) => {
    onChangeChallenges({
      ...challenges,
      [currentWaypointId]: {
        ...challenge,
        [field]: value
      }
    });
  };

  const handleUpdateRubric = (key: string, value: any) => {
    onChangeChallenges({
      ...challenges,
      [currentWaypointId]: {
        ...challenge,
        rubric: {
          ...challenge.rubric,
          [key]: value
        }
      }
    });
  };

  return (
    <div className="challenge-pool-editor">
      <Select
        label="SELECT WAYPOINT"
        value={currentWaypointId}
        onChange={(e) => onSelectWaypoint(e.target.value)}
      >
        {orderedWaypoints.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name || w.id}
            {w.isStart ? ' (Start Waypoint)' : ''}
          </option>
        ))}
      </Select>

      <div className="infobox challenge-pool-editor__card">
        <div className="challenge-pool-editor__header">
          <h4 className="t-announce fs-6">
            WAYPOINT CHALLENGE FOR: {currentWaypoint?.name || 'Waypoint'}
          </h4>
        </div>

        {/* Prompt Input */}
        <div className="field">
          <label className="fs-label">CHALLENGE PROMPT</label>
          <textarea
            className="deck-card__body-input"
            value={challenge.prompt}
            onChange={(e) => handleUpdateField('prompt', e.target.value)}
            placeholder="e.g. Find a red mailbox at this waypoint and take a photo of it."
            rows={3}
          />
        </div>

        {/* Reward Slider */}
        <div className="field">
          <div className="challenge-pool-editor__header">
            <label className="fs-label">COIN REWARD</label>
            <Chip kind="power"><IconCoin /> {challenge.coin_reward} Coins</Chip>
          </div>
          <input
            type="range"
            min={5}
            max={40}
            step={5}
            value={challenge.coin_reward}
            onChange={(e) => handleUpdateField('coin_reward', parseInt(e.target.value))}
            className="challenge-pool-editor__range"
          />
        </div>

        {/* Veto Penalty */}
        <Select
          label="VETO TIME PENALTY"
          value={challenge.veto_penalty_seconds}
          onChange={(e) => handleUpdateField('veto_penalty_seconds', parseInt(e.target.value))}
        >
          {VETO_PENALTY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        {/* Grading criteria, optional and folded away. The referee is told only
            about the fields that hold something, so a challenge whose prompt says it
            all is graded on the prompt and nothing else. */}
        <div className="rubric-fold">
          <button
            type="button"
            className="rubric-fold__toggle"
            aria-expanded={rubricOpen}
            onClick={() => setRubricOpen((open) => !open)}
          >
            <span className="rubric-fold__caret" aria-hidden="true">
              {rubricOpen ? '−' : '+'}
            </span>
            <span className="rubric-fold__label fs-label">GRADING CRITERIA</span>
            <span className="rubric-fold__note">
              {criteriaCount > 0
                ? `${criteriaCount} set`
                : 'Optional'}
            </span>
          </button>

          {rubricOpen && (
            <div className="rubric-fold__body">

              {/* Rubric must_show */}
              <Input
                label="MUST SHOW (comma separated)"
                placeholder="e.g. mailbox, red color"
                value={rawMustShow ?? challenge.rubric.must_show.join(', ')}
                onChange={(e) => {
                  const val = e.target.value;
                  setRawMustShow(val);
                  handleUpdateRubric(
                    'must_show',
                    val.split(',').map((s) => s.trim()).filter(Boolean)
                  );
                }}
              />

              {/* Rubric fails_if */}
              <Input
                label="FAILS IF (comma separated)"
                placeholder="e.g. blurry image, more than one person"
                value={rawFailsIf ?? challenge.rubric.fails_if.join(', ')}
                onChange={(e) => {
                  const val = e.target.value;
                  setRawFailsIf(val);
                  handleUpdateRubric(
                    'fails_if',
                    val.split(',').map((s) => s.trim()).filter(Boolean)
                  );
                }}
              />

              {/* Rubric acceptable_ambiguity */}
              <Input
                label="ACCEPTABLE AMBIGUITY"
                placeholder="e.g. mailbox model variance is acceptable"
                value={challenge.rubric.acceptable_ambiguity}
                onChange={(e) => handleUpdateRubric('acceptable_ambiguity', e.target.value)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
