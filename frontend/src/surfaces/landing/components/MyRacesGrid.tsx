import React from 'react';
import type { RaceRecord } from '../../../core/game/raceSession';
import { Card, Badge, Button, IconButton, Empty, Flap } from '@ds';

interface MyRacesGridProps {
  races: RaceRecord[];
  onResume: (gameId: string) => void;
  onRemove: (gameId: string) => void;
  emptyAction?: React.ReactNode;
}

const STATUS_LABEL: Record<RaceRecord['status'], { tone: 'rust' | 'crimson' | 'neutral'; label: string }> = {
  draft: { tone: 'rust', label: 'WAITING' },
  live: { tone: 'crimson', label: 'LIVE' },
  ended: { tone: 'neutral', label: 'ENDED' },
};

const ROLE_LABEL: Record<RaceRecord['role'], string> = {
  host: 'Hosting',
  player: 'Racing',
  both: 'Hosting · Racing',
  none: 'Not joined',
};

export const MyRacesGrid: React.FC<MyRacesGridProps> = ({ races, onResume, onRemove, emptyAction }) => {
  if (races.length === 0) {
    return (
      <Empty
        icon="🏁"
        title="No races on this device"
        description="Host a race or join one with a code, and it will wait for you here even if you close the page."
        action={emptyAction}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))', gap: 'var(--sp-5)' }}>
      {races.map((race) => {
        const status = STATUS_LABEL[race.status] ?? STATUS_LABEL.draft;
        return (
          <Card
            key={race.gameId}
            className="card--pad card--interactive"
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className="t-data fs-2" style={{ color: 'var(--ink-muted)' }}>
                {new Date(race.lastSeenAt).toLocaleDateString()}
              </span>
            </div>

            <h4 className="t-announce fs-7" style={{ margin: 0, color: 'var(--ink-strong)' }}>
              {race.boardName || 'Untitled race'}
            </h4>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              {race.raceCode && <Flap value={race.raceCode} />}
              <span className="t-data fs-2" style={{ color: 'var(--ink-muted)' }}>
                {ROLE_LABEL[race.role].toUpperCase()}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'auto' }}>
              <Button variant="primary" size="sm" onClick={() => onResume(race.gameId)} style={{ flex: 1 }}>
                {race.status === 'ended' ? 'Race report' : 'Resume'}
              </Button>
              <IconButton icon="🗑️" label="Forget this race" variant="ghost" size="sm" onClick={() => onRemove(race.gameId)} />
            </div>
          </Card>
        );
      })}
    </div>
  );
};
