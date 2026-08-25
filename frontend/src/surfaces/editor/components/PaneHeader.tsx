import React from 'react';
import { Button, IconButton } from '@ds';
import { IconBack, IconChevronRight } from './EditorIcons';

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

const STATUS_COPY: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving',
  dirty: 'Unsaved',
  error: 'Save failed'
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface PaneHeaderProps {
  name: string;
  editable: boolean;
  status: SaveStatus;
  /** A map with no server id has never been saved — "Saved" would be a lie. */
  savedToServer: boolean;
  /** Listed in the public gallery. Independent of save state: a saved map is
   *  private until its designer publishes it. */
  listed: boolean;
  waypointCount: number;
  roadCount: number;
  onNameChange: (value: string) => void;
  onBack: () => void;
  onCollapse: () => void;
}

/** Pinned header component showing map title, status indicators, and save state. */
export const PaneHeader: React.FC<PaneHeaderProps> = ({
  name,
  editable,
  status,
  savedToServer,
  listed,
  waypointCount,
  roadCount,
  onNameChange,
  onBack,
  onCollapse
}) => (
  <header className="pane-head">
    <div className="pane-head__row">
      <Button
        variant="secondary"
        size="sm"
        icon={<IconBack />}
        onClick={onBack}
        className="pane-head__back-btn"
      >
        <span>Home</span>
      </Button>
      <input
        className="pane-head__title"
        type="text"
        value={name}
        disabled={!editable}
        aria-label="Map title"
        placeholder="Untitled map"
        onChange={(e) => onNameChange(e.target.value)}
      />
      <IconButton
        icon={<IconChevronRight />}
        label="Collapse panel"
        variant="ghost"
        size="sm"
        onClick={onCollapse}
      />
    </div>

    <div className="pane-meta">
      {editable && (
        <>
          <span className={`pane-status pane-status--${status}`}>
            {!savedToServer && status === 'saved' ? 'Draft' : STATUS_COPY[status]}
          </span>
          <span className="pane-meta__sep" aria-hidden="true">·</span>
          {/* Where the map lives, said plainly. Two people have asked whether
              "Saved" means the world can see it; this is the answer, and it
              only appears once there is a saved map to answer for. */}
          {savedToServer && (
            <>
              <span
                className={`pane-status pane-status--${listed ? 'listed' : 'private'}`}
                title={
                  listed
                    ? 'Listed in the public gallery. Anyone can find, view, and fork it.'
                    : 'Only this device can open this map. Publish it to put it in the public gallery.'
                }
              >
                {listed ? 'In gallery' : 'Private'}
              </span>
              <span className="pane-meta__sep" aria-hidden="true">·</span>
            </>
          )}
        </>
      )}
      <span>{plural(waypointCount, 'waypoint')}</span>
      <span className="pane-meta__sep" aria-hidden="true">·</span>
      <span>{plural(roadCount, 'road')}</span>
    </div>
  </header>
);
