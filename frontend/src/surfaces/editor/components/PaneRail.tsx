import React from 'react';
import { IconButton } from '@ds';
import { EDITOR_TABS } from './tabDefs';
import type { EditorTabId } from './tabDefs';
import { IconBack, IconChevronLeft } from './EditorIcons';

interface PaneRailProps {
  active: EditorTabId;
  errorCount: number;
  onBack: () => void;
  onExpand: () => void;
  onPick: (id: EditorTabId) => void;
}

/** Collapsed pane side rail with navigation icons and error indicator count. */
export const PaneRail: React.FC<PaneRailProps> = ({ active, errorCount, onBack, onExpand, onPick }) => (
  <>
    <div className="pane-rail-head">
      <IconButton
        icon={<IconBack />}
        label="Back to home"
        variant="secondary"
        size="sm"
        onClick={onBack}
      />
      <IconButton
        icon={<IconChevronLeft />}
        label="Expand panel"
        variant="ghost"
        size="sm"
        onClick={onExpand}
      />
    </div>
    <nav className="pane-rail" aria-label="Map designer sections">
      {EDITOR_TABS.map((tab) => {
        const badge = tab.id === 'validation' ? errorCount : 0;
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.title}
            aria-current={tab.id === active}
            title={tab.title}
            className={`pane-rail__btn ${tab.id === active ? 'pane-rail__btn--active' : ''}`.trim()}
            onClick={() => onPick(tab.id)}
          >
            <span className="pane-tab__mark">
              {tab.icon}
              {badge > 0 && <span className="pane-tab__badge">{badge > 9 ? '9+' : badge}</span>}
            </span>
          </button>
        );
      })}
    </nav>
  </>
);
