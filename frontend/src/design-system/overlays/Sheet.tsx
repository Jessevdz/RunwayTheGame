import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  TAP_SLOP,
  clampOffset,
  computeOffsets,
  resolveSnap,
  stepSnap,
  toggleSnap,
  type SheetOffsets,
  type SheetSnap,
} from './sheetSnap';

export type { SheetSnap } from './sheetSnap';

export interface SheetProps {
  /** Controlled snap state; omit to let the sheet manage its own. */
  snap?: SheetSnap;
  /** Initial snap state when uncontrolled. */
  defaultSnap?: SheetSnap;
  /** Fires when a gesture or key commits a different snap state. */
  onSnapChange?: (snap: SheetSnap) => void;
  /** Fires once the sheet has come to rest, with the height in px that is now visible above the screen bottom. */
  onSettle?: (snap: SheetSnap, visibleHeight: number) => void;
  /** Always-visible strip under the handle, including when collapsed. */
  summary?: React.ReactNode;
  /** Content shown in the peek and expanded states. */
  children?: React.ReactNode;
  /** Names the panel for the handle's accessible label. */
  label?: string;
  /** Fraction of the viewport height visible at the peek snap. */
  peekRatio?: number;
  /** Fraction of the viewport height the sheet occupies when expanded. */
  expandedRatio?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Fallback if the settle transition never reports back. */
const SETTLE_FALLBACK_MS = 450;

/** Bottom sheet with collapsed, peek and expanded snap states that drags via transform. */
export const Sheet: React.FC<SheetProps> = ({
  snap: snapProp,
  defaultSnap = 'collapsed',
  onSnapChange,
  onSettle,
  summary,
  children,
  label = 'panel',
  peekRatio = 0.52,
  expandedRatio = 0.92,
  className = '',
  style,
}) => {
  const [innerSnap, setInnerSnap] = useState<SheetSnap>(defaultSnap);
  const snap = snapProp ?? innerSnap;

  const rootRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();

  const snapRef = useRef(snap);
  snapRef.current = snap;
  const onSnapChangeRef = useRef(onSnapChange);
  onSnapChangeRef.current = onSnapChange;
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const peekRatioRef = useRef(peekRatio);
  peekRatioRef.current = peekRatio;

  const settleCleanupRef = useRef<(() => void) | null>(null);

  const collapsedVisible = useCallback(
    () => (headRef.current?.offsetHeight ?? 0) + (probeRef.current?.offsetHeight ?? 0),
    []
  );

  const measure = useCallback((): SheetOffsets => {
    const root = rootRef.current;
    const peekVisible = peekRatioRef.current * window.innerHeight;
    return computeOffsets(root?.offsetHeight ?? 0, peekVisible, collapsedVisible());
  }, [collapsedVisible]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const head = headRef.current;
    if (!root || !head) return;
    const publish = () => root.style.setProperty('--sheet-collapsed-h', `${collapsedVisible()}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(head);
    return () => observer.disconnect();
  }, [collapsedVisible]);

  const scheduleSettle = useCallback(
    (target: SheetSnap) => {
      settleCleanupRef.current?.();
      const root = rootRef.current;
      if (!root) return;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        const offsets = measure();
        onSettleRef.current?.(target, Math.max(0, root.offsetHeight - offsets[target]));
      };
      const onEnd = (e: TransitionEvent) => {
        if (e.target === root && e.propertyName === 'transform') finish();
      };
      const timer = window.setTimeout(finish, SETTLE_FALLBACK_MS);
      const cleanup = () => {
        window.clearTimeout(timer);
        root.removeEventListener('transitionend', onEnd);
        settleCleanupRef.current = null;
      };
      root.addEventListener('transitionend', onEnd);
      settleCleanupRef.current = cleanup;
    },
    [measure]
  );

  useEffect(() => () => settleCleanupRef.current?.(), []);

  const previousSnapRef = useRef(snap);
  useEffect(() => {
    if (previousSnapRef.current === snap) return;
    previousSnapRef.current = snap;
    scheduleSettle(snap);
  }, [snap, scheduleSettle]);

  const commit = useCallback((next: SheetSnap) => {
    if (next === snapRef.current) return;
    setInnerSnap(next);
    onSnapChangeRef.current?.(next);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;

    const handle = e.currentTarget;
    const offsets = measure();
    const startOffset = offsets[snapRef.current];
    const startY = e.clientY;
    let lastY = startY;
    let lastT = e.timeStamp;
    let velocity = 0;
    let current = startOffset;
    let moved = false;

    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* Tracking simply stops at the handle's edge without capture. */
    }

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < TAP_SLOP) return;
      if (!moved) {
        moved = true;
        root.classList.add('sheet--dragging');
      }
      current = clampOffset(startOffset + (ev.clientY - startY), offsets);
      root.style.transform = `translate3d(0, ${current}px, 0)`;
      const dt = ev.timeStamp - lastT;
      if (dt > 0) velocity = 0.8 * velocity + 0.2 * ((ev.clientY - lastY) / dt);
      lastY = ev.clientY;
      lastT = ev.timeStamp;
    };

    const end = (cancelled: boolean) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* The capture may already be gone. */
      }
      root.classList.remove('sheet--dragging');
      root.style.transform = '';
      if (!moved) {
        if (!cancelled) commit(toggleSnap(snapRef.current));
        return;
      }
      const next = cancelled ? snapRef.current : resolveSnap(offsets, current, velocity);
      commit(next);
      scheduleSettle(next);
    };
    const up = () => end(false);
    const cancel = () => end(true);

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    commit(stepSnap(snapRef.current, e.key === 'ArrowUp' ? 'up' : 'down'));
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) commit(toggleSnap(snapRef.current));
  };

  const collapsed = snap === 'collapsed';
  const rootClass = ['sheet', `sheet--${snap}`, className].filter(Boolean).join(' ');

  return (
    <section
      ref={rootRef}
      className={rootClass}
      aria-label={label}
      data-snap={snap}
      style={
        {
          '--sheet-expanded': expandedRatio,
          '--sheet-peek': peekRatio,
          ...style,
        } as React.CSSProperties
      }
    >
      <div ref={headRef} className="sheet__head">
        <button
          type="button"
          className="sheet__handle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
        >
          <span className="sheet__grabber" aria-hidden="true" />
        </button>
        {summary && <div className="sheet__summary">{summary}</div>}
      </div>
      <div id={bodyId} className="sheet__body" inert={collapsed} aria-hidden={collapsed || undefined}>
        {children}
      </div>
      <div ref={probeRef} className="sheet__safe-probe" aria-hidden="true" />
    </section>
  );
};
