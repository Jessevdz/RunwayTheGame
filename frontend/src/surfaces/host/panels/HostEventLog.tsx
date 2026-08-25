import React, { useMemo, useState } from 'react';
import type { GameState } from '../../../core/projection/projectionStore';
import { Card, Badge, Empty, Tabs, type TabItem } from '@ds';

interface HostEventLogProps {
  gameState: GameState;
}

type Filter = 'all' | 'gm' | 'disputes' | 'arrivals';

function classify(line: string): 'gm' | 'arrival' | 'dispute' | 'other' {
  if (line.startsWith('[GM]')) return 'gm';
  if (line.includes('flagged for review')) return 'arrival';
  if (line.startsWith('Dispute')) return 'dispute';
  return 'other';
}

export const HostEventLog: React.FC<HostEventLogProps> = ({ gameState }) => {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const entries = gameState.logs.map((line, index) => ({ line, index, kind: classify(line) }));
    if (filter === 'all') return entries;
    if (filter === 'gm') return entries.filter((e) => e.kind === 'gm');
    if (filter === 'disputes') return entries.filter((e) => e.kind === 'dispute');
    return entries.filter((e) => e.kind === 'arrival');
  }, [gameState.logs, filter]);

  // Calculates log counts per event type before filtering.
  const counts = useMemo(() => {
    const kinds = gameState.logs.map(classify);
    return {
      all: kinds.length,
      gm: kinds.filter((k) => k === 'gm').length,
      disputes: kinds.filter((k) => k === 'dispute').length,
      arrivals: kinds.filter((k) => k === 'arrival').length
    };
  }, [gameState.logs]);

  // The same Tabs the console itself switches on — a second, hand-rolled pill
  // row was the one control on this surface that did not look like the rest.
  const chips: TabItem[] = [
    { id: 'all', label: 'All', badge: counts.all },
    { id: 'gm', label: 'GM', badge: counts.gm },
    { id: 'disputes', label: 'Disputes', badge: counts.disputes },
    { id: 'arrivals', label: 'Arrivals', badge: counts.arrivals }
  ];

  return (
    <div className="host-event-log">
      <Tabs
        items={chips}
        active={filter}
        onChange={(id) => setFilter(id as Filter)}
        className="host-event-log__filters"
      />

      {filtered.length === 0 ? (
        <Empty icon="📜" title="Nothing to show" description="No events match this filter yet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {filtered
            .slice()
            .reverse()
            .map(({ line, index, kind }) => (
              <Card key={index} className="host-event-log__entry">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
                  {kind === 'gm' && <Badge tone="gold">GM</Badge>}
                  {kind === 'arrival' && <Badge tone="rust">FLAGGED</Badge>}
                  {kind === 'dispute' && <Badge tone="crimson">DISPUTE</Badge>}
                  <span className="t-data fs-4">{line}</span>
                </div>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
};
export default HostEventLog;
