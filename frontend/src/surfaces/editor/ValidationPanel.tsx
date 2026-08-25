import React from 'react';
import type { ValidationError } from '../../core/editor/geometryUtils';
import { IconButton } from '@ds';
import { IconLocate } from './components/EditorIcons';

interface ValidationPanelProps {
  issues: ValidationError[];
  onFocusIssue: (waypointIds: string[]) => void;
  waypointCount: number;
}

const locateTargets = (err: ValidationError): string[] | null => {
  if (err.waypointIds) return err.waypointIds;
  if (err.road) return [err.road.waypoint_id_a, err.road.waypoint_id_b];
  return null;
};

interface IssueListProps {
  title: string;
  issues: ValidationError[];
  tone: 'error' | 'warn';
  emptyCopy: string;
  onFocusIssue: (waypointIds: string[]) => void;
}

const IssueList: React.FC<IssueListProps> = ({ title, issues, tone, emptyCopy, onFocusIssue }) => (
  <section className="pane-section">
    <div className="pane-section__head">
      <h3 className="pane-section__title">{title}</h3>
      <span className="t-data fs-2">{issues.length}</span>
    </div>

    {issues.length === 0 ? (
      <p className="pane-blank">{emptyCopy}</p>
    ) : (
      <div className="pane-list">
        {issues.map((issue) => {
          const targets = locateTargets(issue);
          return (
            <div key={issue.id} className={`pane-row pane-row--${tone}`}>
              {targets ? (
                <button
                  type="button"
                  className="pane-row__main"
                  title="Show on map"
                  onClick={() => onFocusIssue(targets)}
                >
                  <span className="pane-row__label">{issue.message}</span>
                </button>
              ) : (
                <span className="pane-row__main pane-row__main--static">
                  <span className="pane-row__label">{issue.message}</span>
                </span>
              )}
              {targets && (
                <span className="pane-row__aside">
                  <IconButton
                    icon={<IconLocate />}
                    label="Show on map"
                    variant="ghost"
                    size="sm"
                    onClick={() => onFocusIssue(targets)}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    )}
  </section>
);

/** Panel displaying board validation errors and warnings. */
export const ValidationPanel: React.FC<ValidationPanelProps> = ({ issues, onFocusIssue, waypointCount }) => {
  const errors = issues.filter((i) => i.type === 'error');
  const warnings = issues.filter((i) => i.type === 'warning');

  if (waypointCount === 0) {
    return (
      <p className="pane-blank">Nothing to check yet — place a waypoint on the map first.</p>
    );
  }

  return (
    <>
      <IssueList
        title="Blocks publish"
        issues={errors}
        tone="error"
        emptyCopy="No blocking problems. This map can be published."
        onFocusIssue={onFocusIssue}
      />
      <IssueList
        title="Worth a look"
        issues={warnings}
        tone="warn"
        emptyCopy="No warnings."
        onFocusIssue={onFocusIssue}
      />
    </>
  );
};
