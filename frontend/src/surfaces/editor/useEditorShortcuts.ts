import { useEffect, useRef } from 'react';
import { EDITOR_TOOLS } from './components/toolDefs';
import type { EditorTool } from './components/toolDefs';

export interface EditorShortcutHandlers {
  isEditable: boolean;
  hasSelection: boolean;
  save: () => void;
  deleteSelection: () => void;
  /** Escape: drop the tool and the selection, and tell the map to do the same. */
  cancel: () => void;
  pickTool: (tool: EditorTool) => void;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  );
};

/** Hook handling keyboard shortcuts for map editor actions. */
export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const current = handlersRef.current;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        current.save();
        return;
      }

      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        current.cancel();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && current.hasSelection) {
        e.preventDefault();
        current.deleteSelection();
        return;
      }

      const tool = EDITOR_TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (tool && !(tool.writes && !current.isEditable)) {
        e.preventDefault();
        current.pickTool(tool.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
