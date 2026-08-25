import React from 'react';
import { Callout, Button } from '@ds';

interface ReadOnlyBannerProps {
  mapName: string;
  onFork: () => void;
  isForking?: boolean;
}

export const ReadOnlyBanner: React.FC<ReadOnlyBannerProps> = ({ mapName, onFork, isForking }) => {
  return (
    <Callout kind="power" style={{ borderRadius: 0, borderWidth: '0 0 0.0625rem 0', padding: 'var(--sp-2) var(--sp-5)', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <span className="fs-7">👁️</span>
        <span className="fs-4">
          <strong>Read-Only Mode:</strong> You are viewing <em>{mapName || 'this map'}</em>. Changes cannot be saved directly.
        </span>
      </div>
      <Button variant="primary" size="sm" disabled={isForking} onClick={onFork}>
        {isForking ? 'Forking Map...' : '🍴 Fork to Edit'}
      </Button>
    </Callout>
  );
};
