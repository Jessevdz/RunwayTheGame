import React from 'react';
import { EDITOR_TABS } from './tabDefs';
import type { EditorTabId } from './tabDefs';

interface TabStripProps {
  active: EditorTabId;
  errorCount: number;
  onChange: (id: EditorTabId) => void;
}

/** Tab navigation strip for map designer pane sections. */
export const TabStrip: React.FC<TabStripProps> = ({ active, errorCount, onChange }) => (
  <div className="pane-tabs" role="tablist" aria-label="Map designer sections">
    {EDITOR_TABS.map((tab) => {
      const isActive = tab.id === active;
      const badge = tab.id === 'validation' ? errorCount : 0;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          title={badge > 0 ? `${tab.title} — ${badge} error${badge === 1 ? '' : 's'}` : tab.title}
          className="pane-tab"
          onClick={() => onChange(tab.id)}
        >
          <span className="pane-tab__mark">
            {tab.icon}
            {badge > 0 && <span className="pane-tab__badge">{badge > 9 ? '9+' : badge}</span>}
          </span>
          <span className="pane-tab__label">
            <span className="pane-tab__label-short">{tab.label}</span>
            <span className="pane-tab__label-full">{tab.fullLabel}</span>
          </span>
        </button>
      );
    })}
  </div>
);
