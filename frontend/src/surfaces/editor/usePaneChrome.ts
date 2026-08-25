import { useCallback, useEffect, useRef, useState } from 'react';

const STORE_KEY = 'runway:editor:pane';

const MIN_W = 320;
const MAX_W = 620;
const DEFAULT_W = 380;

/** Sheet height is a viewport fraction so it survives rotation. */
/** DESIGN.md sanctions exactly two breakpoints; this is the md one. */
const SHEET_BP = 768;
const SHEET_QUERY = `(max-width: ${SHEET_BP}px)`;

const MIN_H = 0.28;
const MAX_H = 0.9;
const DEFAULT_H = 0.62;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface PaneChromeState {
  width: number;
  height: number;
  collapsed: boolean;
}

const read = (): PaneChromeState => {
  const fallback = { width: DEFAULT_W, height: DEFAULT_H, collapsed: false };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      width: clamp(Number(parsed.width) || DEFAULT_W, MIN_W, MAX_W),
      height: clamp(Number(parsed.height) || DEFAULT_H, MIN_H, MAX_H),
      collapsed: !!parsed.collapsed
    };
  } catch {
    return fallback;
  }
};

/** Hook managing editor pane dimensions and bottom sheet behavior. */
export const usePaneChrome = () => {
  const [state, setState] = useState<PaneChromeState>(read);
  const [dragging, setDragging] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* private mode — the pane still works, it just forgets */
    }
  }, [state]);

  const setCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => ({ ...prev, collapsed }));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    const isSheet = window.matchMedia(SHEET_QUERY).matches;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setDragging(true);

    const move = (ev: PointerEvent) => {
      if (isSheet) {
        const ratio = (window.innerHeight - ev.clientY) / window.innerHeight;
        setState((prev) => ({ ...prev, height: clamp(ratio, MIN_H, MAX_H), collapsed: false }));
      } else {
        const next = Math.round(window.innerWidth - ev.clientX);
        setState((prev) => ({ ...prev, width: clamp(next, MIN_W, MAX_W), collapsed: false }));
      }
    };

    const up = () => {
      setDragging(false);
      target.releasePointerCapture?.(e.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, []);

  /** Keyboard parity for the drag handle — a mouse-only resizer is not a control. */
  const handleResizeKey = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const isSheet = window.matchMedia(SHEET_QUERY).matches;
    const grow = e.key === (isSheet ? 'ArrowUp' : 'ArrowLeft');
    const shrink = e.key === (isSheet ? 'ArrowDown' : 'ArrowRight');
    if (!grow && !shrink) return;
    e.preventDefault();
    const step = grow ? 1 : -1;
    setState((prev) =>
      isSheet
        ? { ...prev, height: clamp(prev.height + step * 0.04, MIN_H, MAX_H) }
        : { ...prev, width: clamp(prev.width + step * 24, MIN_W, MAX_W) }
    );
  }, []);

  return {
    width: state.width,
    height: state.height,
    collapsed: state.collapsed,
    dragging,
    setCollapsed,
    toggleCollapsed,
    handleResizeStart,
    handleResizeKey
  };
};
