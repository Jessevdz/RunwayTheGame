import React from 'react';
import { Button } from '@ds';
import { IconCheck, IconSave, IconShare, IconImport, IconExport, IconTrash } from './EditorIcons';
import type { SaveStatus } from './PaneHeader';

interface PaneFooterProps {
  editable: boolean;
  status: SaveStatus;
  errorCount: number;
  warningCount: number;
  canShare: boolean;
  /** There is something on the map to throw away. */
  canClear: boolean;
  /** Already in the public gallery. Decides whether the share action's headline
   *  job is "put this out there" or "manage what is already out there". */
  listed: boolean;
  onReviewIssues: () => void;
  onClear: () => void;
  onShare: () => void;
  onSave: () => void;
  onImport: () => void;
  onExport: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Pinned footer action bar for map editor save and validation status. */
export const PaneFooter: React.FC<PaneFooterProps> = ({
  editable,
  status,
  errorCount,
  warningCount,
  canShare,
  canClear,
  listed,
  onReviewIssues,
  onClear,
  onShare,
  onSave,
  onImport,
  onExport
}) => {
  const tone = errorCount > 0 ? 'error' : warningCount > 0 ? 'warn' : 'clean';
  const summary =
    errorCount > 0
      ? plural(errorCount, 'error')
      : warningCount > 0
        ? plural(warningCount, 'warning')
        : 'All checks pass';

  return (
    <footer className="pane-foot">
      <button
        type="button"
        className={`pane-foot__status pane-foot__status--${tone}`}
        title="Open validation"
        onClick={onReviewIssues}
      >
        <IconCheck />
        <span className="pane-foot__status-text">{summary}</span>
      </button>

      <div className="pane-foot__actions">
        {canShare && (
          <Button
            variant="secondary"
            size="sm"
            icon={<IconShare />}
            onClick={onShare}
            className="pane-foot__btn"
            title={
              listed
                ? 'Share links, or remove this map from the public gallery'
                : 'Publish this map to the public gallery, or share a link'
            }
          >
            {/* A saved map's next step is publishing, so the button names it.
                Once it is out there the job changes to managing it, and "Share"
                covers both the links and taking it back down. */}
            <span className="pane-foot__btn-label">{listed ? 'Share' : 'Publish'}</span>
          </Button>
        )}
        {editable && canClear && (
          <Button
            variant="secondary"
            size="sm"
            icon={<IconTrash />}
            onClick={onClear}
            className="pane-foot__btn"
            title="Clear the map and start over"
          >
            <span className="pane-foot__btn-label">Clear</span>
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={<IconExport />}
          onClick={onExport}
          className="pane-foot__btn"
          title="Export map JSON"
        >
          <span className="pane-foot__btn-label">Export</span>
        </Button>
        {editable && (
          <Button
            variant="secondary"
            size="sm"
            icon={<IconImport />}
            onClick={onImport}
            className="pane-foot__btn"
            title="Import map JSON"
          >
            <span className="pane-foot__btn-label">Import</span>
          </Button>
        )}
        {editable && (
          <Button
            variant={status === 'saved' ? 'secondary' : 'primary'}
            size="sm"
            icon={<IconSave />}
            disabled={status === 'saving'}
            onClick={onSave}
            className="pane-foot__btn pane-foot__btn--save"
            title={status === 'saving' ? 'Saving map...' : 'Save map'}
          >
            <span className="pane-foot__btn-label">{status === 'saving' ? 'Saving' : 'Save'}</span>
          </Button>
        )}
      </div>
    </footer>
  );
};

