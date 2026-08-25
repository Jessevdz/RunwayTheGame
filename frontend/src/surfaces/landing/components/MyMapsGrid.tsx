import React from 'react';
import type { MapRecord } from '../../../core/game/mapSession';
import { Card, Badge, Button, IconButton, Empty } from '@ds';

interface MyMapsGridProps {
  maps: MapRecord[];
  onSelectMap: (mapId: string) => void;
  onRemoveMap: (mapId: string) => void;
}

export const MyMapsGrid: React.FC<MyMapsGridProps> = ({ maps, onSelectMap, onRemoveMap }) => {
  if (maps.length === 0) {
    return (
      <Empty
        icon="🗺️"
        title="No local maps saved"
        description="Create a new map or edit a public map to keep it accessible here on this device."
      />
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))', gap: 'var(--sp-5)' }}>
      {maps.map((map) => (
        <Card key={map.mapId} className="card--pad card--interactive" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Every map here is saved on this device; the badge answers the
                other question — whether anyone else can see it. */}
            <Badge tone={map.isListed ? 'moss' : 'rust'}>{map.isListed ? 'IN GALLERY' : 'PRIVATE'}</Badge>
            <span className="t-data fs-2" style={{ color: 'var(--ink-muted)' }}>
              {new Date(map.updatedAt).toLocaleDateString()}
            </span>
          </div>

          <h4 className="t-announce fs-7" style={{ margin: 0, color: 'var(--ink-strong)' }}>
            {map.name || 'Untitled Map'}
          </h4>

          <div className="t-data fs-2" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', color: 'var(--ink-muted)' }}>
            <span>START</span>
            <i style={{ flex: 1, height: 1, background: 'repeating-linear-gradient(90deg, var(--line-strong) 0 var(--sp-1), transparent var(--sp-1) var(--sp-2))' }} />
            <span>FINISH</span>
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
            <Button variant="secondary" size="sm" onClick={() => onSelectMap(map.mapId)} style={{ flex: 1 }}>
              Edit Map
            </Button>
            <IconButton icon="🗑️" label="Remove local map" variant="ghost" size="sm" onClick={() => onRemoveMap(map.mapId)} />
          </div>
        </Card>
      ))}
    </div>
  );
};
