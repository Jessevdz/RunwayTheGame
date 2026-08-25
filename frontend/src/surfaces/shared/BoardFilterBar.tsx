import React, { useEffect, useRef } from 'react';
import { Omnisearch, Tabs, Select, Tag, Button } from '@ds';
import {
  BANDS,
  SORTS,
  NO_FILTERS,
  bandById,
  type BandId,
  type BoardFilters,
  type SortId,
} from './boardFilters';

interface BoardFilterBarProps {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  /** Maps per band within the current text search — drives the tab badges. */
  counts: Record<BandId, number>;
  shown: number;
  total: number;
  narrowed: boolean;
  /** What the list is called in the search field's placeholder and label. */
  noun?: string;
}

/* Narrowing controls for any page that picks a map off the board list: a name
   search, the length bands, and the sort. Search and bands compose — the bands
   count what the search left, so the badges stay honest as you type. */
export const BoardFilterBar: React.FC<BoardFilterBarProps> = ({
  filters,
  onChange,
  counts,
  shown,
  total,
  narrowed,
  noun = 'maps',
}) => {
  const searchRef = useRef<HTMLDivElement>(null);
  const query = filters.query.trim();
  const band = bandById(filters.band);

  /* The pill prints a "/" hint, so "/" has to do something. It is ignored while
     the caret already sits in a field, otherwise typing a slash into the search
     box — or into the runner-name field beside it — would only re-focus it. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) {
        return;
      }
      const input = searchRef.current?.querySelector('input');
      if (!input) return;
      event.preventDefault();
      // Asynchronously focuses search input on keydown.
      window.setTimeout(() => input.focus(), 0);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="board-filters">
      <div className="board-filters__controls">
        <div ref={searchRef} className="board-filters__search">
          <Omnisearch
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder={`Search ${noun} by name…`}
            label={`Search ${noun} by name`}
          />
        </div>

        <Select
          label="Sort"
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as SortId })}
          className="board-filters__sort"
        >
          {SORTS.map((sort) => (
            <option key={sort.id} value={sort.id}>
              {sort.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="board-filters__facets">
        <Tabs
          className="board-filters__bands"
          items={BANDS.map((item) => ({ id: item.id, label: item.label, badge: counts[item.id] }))}
          active={filters.band}
          onChange={(id) => onChange({ ...filters, band: id as BandId })}
        />

        <div className="board-filters__status">
          <span
            className="t-data fs-2"
            aria-live="polite"
            style={{ letterSpacing: '.12em', color: 'var(--ink-muted)' }}
          >
            {shown} OF {total}
          </span>

          {query !== '' && (
            <Tag onRemove={() => onChange({ ...filters, query: '' })}>“{query}”</Tag>
          )}
          {filters.band !== 'all' && (
            <Tag onRemove={() => onChange({ ...filters, band: 'all' })}>{band.range}</Tag>
          )}
          {narrowed && (
            <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
              Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
