export type SheetSnap = 'collapsed' | 'peek' | 'expanded';

/** Snap states ordered from least to most visible. */
export const SHEET_SNAPS: readonly SheetSnap[] = ['collapsed', 'peek', 'expanded'];

/** Downward translation in px for each snap, so expanded is always 0. */
export type SheetOffsets = Record<SheetSnap, number>;

/** Pointer travel in px below which a press on the handle is a tap. */
export const TAP_SLOP = 6;

/** How far ahead in ms a release velocity is projected when picking a snap. */
const PROJECTION_MS = 160;

/** Steps one snap up (more visible) or down (less visible), stopping at the ends. */
export const stepSnap = (snap: SheetSnap, direction: 'up' | 'down'): SheetSnap => {
  const i = SHEET_SNAPS.indexOf(snap);
  const next = direction === 'up' ? i + 1 : i - 1;
  return SHEET_SNAPS[Math.min(SHEET_SNAPS.length - 1, Math.max(0, next))];
};

/** A tap folds an open sheet and opens a collapsed one to its peek height. */
export const toggleSnap = (snap: SheetSnap): SheetSnap => (snap === 'collapsed' ? 'peek' : 'collapsed');

/** Keeps a live drag position between the fully open and fully folded offsets. */
export const clampOffset = (offset: number, offsets: SheetOffsets): number =>
  Math.min(offsets.collapsed, Math.max(offsets.expanded, offset));

/** Picks the snap nearest to where the release would coast to; velocity is px/ms, positive is downward. */
export const resolveSnap = (offsets: SheetOffsets, offset: number, velocity = 0): SheetSnap => {
  const projected = clampOffset(offset + velocity * PROJECTION_MS, offsets);
  let best: SheetSnap = 'collapsed';
  let bestDistance = Infinity;
  for (const snap of SHEET_SNAPS) {
    const distance = Math.abs(offsets[snap] - projected);
    if (distance < bestDistance) {
      best = snap;
      bestDistance = distance;
    }
  }
  return best;
};

/** Builds the snap offsets from measured pixel sizes. */
export const computeOffsets = (sheetHeight: number, peekVisible: number, collapsedVisible: number): SheetOffsets => {
  const collapsed = Math.max(0, sheetHeight - collapsedVisible);
  const peek = Math.min(collapsed, Math.max(0, sheetHeight - peekVisible));
  return { expanded: 0, peek, collapsed };
};
