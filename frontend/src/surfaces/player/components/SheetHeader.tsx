import React from 'react';
import { peekUnit } from '../consoleFormat';
import { type SheetChrome } from '../useSheetChrome';
import { type ObjectiveView } from '../objective';

interface SheetHeaderProps {
  sheet: SheetChrome;
  objective: ObjectiveView;
  reached: number;
  total: number;
  progressPct: number;
}

/** Player console sheet header displaying handle bar, progress, and peek bar. */
export const SheetHeader: React.FC<SheetHeaderProps> = ({
  sheet,
  objective,
  reached,
  total,
  progressPct
}) => (
  <>
    {/* One control, two gestures: drag it to size the sheet, tap it to fold
        the sheet away and hand the whole screen back to the map. */}
    <button
      type="button"
      className={`player-sheet__handle${sheet.collapsed ? ' player-sheet__handle--collapsed' : ''}`}
      aria-expanded={!sheet.collapsed}
      aria-label={sheet.collapsed ? 'Expand the race panel' : 'Collapse the race panel'}
      title="Drag to resize, tap to toggle collapse"
      onPointerDown={sheet.handleDragStart}
      onKeyDown={sheet.handleDragKey}
      onClick={(e) => {
        // Pointer taps are resolved inside the drag handler, which already
        // knows whether the press travelled. This is the keyboard path only.
        if (e.detail === 0) sheet.toggleCollapsed();
      }}
    >
      <span className="player-sheet__handle-bar" aria-hidden="true" />
      <span className="player-sheet__handle-icon" aria-hidden="true">
        {sheet.collapsed ? '▲' : '▼'}
      </span>
    </button>

    {/* How far along you are, as the sheet's own top rule. It was a labelled
        row of its own; a race only ever needs it in peripheral vision. */}
    <div
      className="player-prog"
      role="progressbar"
      aria-label="Waypoints reached"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={reached}
      aria-valuetext={`${reached} of ${total} waypoints`}
    >
      <span className="player-prog__fill" style={{ width: `${progressPct}%` }} />
    </div>

    {/* Folded away, the sheet still answers the one question — it just stops
        arguing for the space to answer it in full. A single tappable line
        brings the whole console back. */}
    <button
      type="button"
      className={`player-peek player-peek--${objective.tone}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        sheet.setCollapsed(false);
      }}
      aria-label="Expand the race panel"
    >
      <span className="player-peek__title">{objective.title}</span>
      {objective.readout && (
        <span className="player-peek__readout">
          {objective.readout.value}
          {peekUnit(objective.readout.unit) && <small>{peekUnit(objective.readout.unit)}</small>}
        </span>
      )}
    </button>
  </>
);
