import React from 'react';
import { EDITOR_TOOLS } from './toolDefs';
import type { EditorTool } from './toolDefs';

interface ToolPaletteProps {
  active: EditorTool;
  editable: boolean;
  onChange: (tool: EditorTool) => void;
}

/** Map editor tool selection palette component. */
export const ToolPalette: React.FC<ToolPaletteProps> = ({ active, editable, onChange }) => {
  const current = EDITOR_TOOLS.find((t) => t.id === active) || EDITOR_TOOLS[0];

  return (
    <section className="pane-section" aria-label="Map tools">
      <div className="pane-section__head">
        <h3 className="pane-section__title">Tools</h3>
        <span className="t-label fs-1">Esc to select</span>
      </div>

      <div className="tool-palette" role="radiogroup" aria-label="Active map tool">
        {EDITOR_TOOLS.map((tool) => {
          const disabled = tool.writes && !editable;
          return (
            <button
              key={tool.id}
              type="button"
              role="radio"
              aria-checked={tool.id === active}
              disabled={disabled}
              title={`${tool.label} (${tool.key})`}
              className={`tool tool--${tool.id} ${tool.id === active ? 'tool--active' : ''}`.trim()}
              onClick={() => onChange(tool.id)}
            >
              <span className="tool__mark">{tool.icon}</span>
              <span className="tool__label">{tool.label}</span>
            </button>
          );
        })}
      </div>

      <p className="tool-hint">
        <span className="tool-hint__mark" aria-hidden="true">{current.icon}</span>
        <span>
          {current.hint} <span className="kbd">{current.key}</span>
        </span>
      </p>
    </section>
  );
};
