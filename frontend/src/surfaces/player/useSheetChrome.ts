import { useCallback, useEffect, useRef, useState } from 'react';

const STORE_KEY = 'runway:player:sheet';

/** DESIGN.md sanctions exactly two breakpoints; this is the md one. */
const SHEET_BP = 767;
const SHEET_QUERY = `(max-width: ${SHEET_BP}px)`;

/** Height is a viewport fraction, so it survives rotation. */
const MIN_H = 0.24;
const MAX_H = 0.92;
const DEFAULT_H = 0.52;

/** Pointer slop below which a press on the handle is a tap, not a drag. */
const TAP_SLOP = 6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface SheetChromeState {
  height: number;
  collapsed: boolean;
}

const read = (): SheetChromeState => {
  const fallback = { height: DEFAULT_H, collapsed: true };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      height: clamp(Number(parsed.height) || DEFAULT_H, MIN_H, MAX_H),
      collapsed: parsed.collapsed !== undefined ? !!parsed.collapsed : true
    };
  } catch {
    return fallback;
  }
};

/** Hook controlling player console sheet position and drag behaviors. */
export const useSheetChrome = () => {
  const [state, setState] = useState<SheetChromeState>(read);
  const [dragging, setDragging] = useState(false);
  const [unfolding, setUnfolding] = useState(false);
  const unfoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const triggerUnfoldCooldown = useCallback(() => {
    setUnfolding(true);
    if (unfoldTimerRef.current) clearTimeout(unfoldTimerRef.current);
    unfoldTimerRef.current = setTimeout(() => {
      setUnfolding(false);
      unfoldTimerRef.current = null;
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (unfoldTimerRef.current) clearTimeout(unfoldTimerRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* private mode — the sheet still works, it just forgets */
    }
  }, [state]);

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      setState((prev) => {
        if (prev.collapsed && !collapsed) {
          triggerUnfoldCooldown();
        }
        return { ...prev, collapsed };
      });
    },
    [triggerUnfoldCooldown]
  );

  const toggleCollapsed = useCallback(() => {
    setState((prev) => {
      if (prev.collapsed) {
        triggerUnfoldCooldown();
      }
      return { ...prev, collapsed: !prev.collapsed };
    });
  }, [triggerUnfoldCooldown]);

  const handleDragStart = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Only a phone has a draggable sheet; at md the same markup is a fixed side
      // pane and the handle is not rendered at all.
      if (!window.matchMedia(SHEET_QUERY).matches) return;
      e.preventDefault();

      const target = e.currentTarget;
      const startY = e.clientY;
      let moved = false;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* The drag still tracks while the pointer is over the handle; capture is
           what keeps it tracking once the thumb runs past the edge. */
      }

      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientY - startY) < TAP_SLOP) return;
        if (!moved) {
          moved = true;
          setDragging(true);
        }
        // Measured from the bottom of the window: the sheet's top edge follows
        // the thumb, which is the only mapping that feels like dragging a sheet.
        const ratio = (window.innerHeight - ev.clientY) / window.innerHeight;
        setState({ height: clamp(ratio, MIN_H, MAX_H), collapsed: false });
      };

      const up = () => {
        // A press that never travelled is a tap, and a tap on the grab handle is
        // the collapse toggle — the affordance a player reaches for one-handed.
        if (!moved) {
          toggleCollapsed();
        } else if (!stateRef.current.collapsed) {
          triggerUnfoldCooldown();
        }
        setDragging(false);
        target.releasePointerCapture?.(e.pointerId);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
      };

      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    },
    [toggleCollapsed, triggerUnfoldCooldown]
  );

  /** Keyboard parity for the drag handle — a pointer-only resizer is not a control. */
  const handleDragKey = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const grow = e.key === 'ArrowUp';
      const shrink = e.key === 'ArrowDown';
      if (!grow && !shrink) return;
      e.preventDefault();
      const step = grow ? 0.04 : -0.04;
      setState((prev) => {
        if (prev.collapsed && grow) {
          triggerUnfoldCooldown();
        }
        return {
          height: clamp(prev.height + step, MIN_H, MAX_H),
          // Growing out of the collapsed state is the obvious reading of ArrowUp;
          // shrinking into it would fight the explicit toggle on Enter/Space.
          collapsed: grow ? false : prev.collapsed
        };
      });
    },
    [triggerUnfoldCooldown]
  );

  return {
    height: state.height,
    collapsed: state.collapsed,
    dragging,
    unfolding,
    setCollapsed,
    toggleCollapsed,
    handleDragStart,
    handleDragKey
  };
};

/** The sheet's behaviour, as handed to the chrome that draws it. */
export type SheetChrome = ReturnType<typeof useSheetChrome>;
