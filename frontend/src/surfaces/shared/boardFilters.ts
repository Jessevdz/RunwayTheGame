import { useCallback, useMemo, useState } from 'react';
import type { BoardSummary } from '../../core/api/client';

export type BandId = 'all' | 'short' | 'medium' | 'long';
export type SortId = 'recent' | 'oldest' | 'name' | 'most' | 'fewest';

/** A board list's whole narrowing state. One object, so a page holds one piece
    of state and "Reset" is a single assignment rather than three. */
export interface BoardFilters {
  query: string;
  band: BandId;
  sort: SortId;
}

export const NO_FILTERS: BoardFilters = { query: '', band: 'all', sort: 'recent' };

export interface Band {
  id: BandId;
  label: string;
  /** How the band reads as a removable tag once it is active. */
  range: string;
  covers: (waypoints: number) => boolean;
}

/** Board length filter bands measured in waypoint counts. */
export const BANDS: Band[] = [
  { id: 'all', label: 'All', range: 'Any length', covers: () => true },
  { id: 'short', label: 'Short', range: '1–6 waypoints', covers: (w) => w <= 6 },
  { id: 'medium', label: 'Medium', range: '7–14 waypoints', covers: (w) => w >= 7 && w <= 14 },
  { id: 'long', label: 'Long', range: '15+ waypoints', covers: (w) => w >= 15 },
];

export const SORTS: { id: SortId; label: string }[] = [
  { id: 'recent', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'most', label: 'Most waypoints' },
  { id: 'fewest', label: 'Fewest waypoints' },
];

export function getBand(id: string): Band {
  return BANDS.find((b) => b.id === id) || BANDS[0];
}

export function searchMatchingBands(
  boards: BoardSummary[],
  query: string
): Record<string, number> {
  const matchingQuery = searchBoards(boards, query);
  const counts: Record<string, number> = {};
  for (const band of BANDS) {
    counts[band.id] = matchingQuery.filter((b) => band.covers(b.waypoint_count)).length;
  }
  return counts;
}

/** Filters boards matching all terms in search query. */
export function boardTitle(board: BoardSummary): string {
  return board.name || 'Untitled Map';
}

export function bandById(id: BandId): Band {
  return BANDS.find((band) => band.id === id) ?? BANDS[0];
}

export function isNarrowed(filters: BoardFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.band !== NO_FILTERS.band ||
    filters.sort !== NO_FILTERS.sort
  );
}

/** Filters boards matching all terms in search query. */
export function searchBoards(boards: BoardSummary[], query: string): BoardSummary[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return boards;
  return boards.filter((board) => {
    const title = boardTitle(board).toLowerCase();
    return terms.every((term) => title.includes(term));
  });
}

export function countByBand(searched: BoardSummary[]): Record<BandId, number> {
  const counts: Record<BandId, number> = { all: 0, short: 0, medium: 0, long: 0 };
  for (const board of searched) {
    for (const band of BANDS) {
      if (band.covers(board.waypoint_count)) counts[band.id] += 1;
    }
  }
  return counts;
}

function comparator(sort: SortId): (a: BoardSummary, b: BoardSummary) => number {
  const byTitle = (a: BoardSummary, b: BoardSummary) => boardTitle(a).localeCompare(boardTitle(b));
  const byNewest = (a: BoardSummary, b: BoardSummary) =>
    Date.parse(b.updated_at) - Date.parse(a.updated_at);

  switch (sort) {
    case 'oldest':
      return (a, b) => byNewest(b, a);
    case 'name':
      return byTitle;
    // Two maps of the same length sort by name, so the order is stable enough to
    // scan twice and find the same card in the same place.
    case 'most':
      return (a, b) => b.waypoint_count - a.waypoint_count || byTitle(a, b);
    case 'fewest':
      return (a, b) => a.waypoint_count - b.waypoint_count || byTitle(a, b);
    default:
      return byNewest;
  }
}

/** Applies the band and the sort to an already-searched list. */
export function narrowBoards(
  searched: BoardSummary[],
  band: BandId,
  sort: SortId
): BoardSummary[] {
  const { covers } = bandById(band);
  return searched.filter((board) => covers(board.waypoint_count)).sort(comparator(sort));
}

export interface BoardFilterControls {
  filters: BoardFilters;
  setFilters: (next: BoardFilters) => void;
  reset: () => void;
  /** Total number of items matching each filter band. */
  counts: Record<BandId, number>;
  /** Filtered list of board summaries. */
  visible: BoardSummary[];
  narrowed: boolean;
}

/** Hook managing search and length-band filtering for board lists. */
export function useBoardFilters(boards: BoardSummary[]): BoardFilterControls {
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);

  const searched = useMemo(() => searchBoards(boards, filters.query), [boards, filters.query]);
  const counts = useMemo(() => countByBand(searched), [searched]);
  const visible = useMemo(
    () => narrowBoards(searched, filters.band, filters.sort),
    [searched, filters.band, filters.sort]
  );
  const reset = useCallback(() => setFilters(NO_FILTERS), []);

  return { filters, setFilters, reset, counts, visible, narrowed: isNarrowed(filters) };
}
