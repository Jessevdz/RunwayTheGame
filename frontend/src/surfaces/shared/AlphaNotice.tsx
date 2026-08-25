/**
 * Alpha disclaimer — temporary, and meant to be deleted.
 *
 * Shown on the two doors into a race: hosting one and joining one. It appears
 * once per device and dismissing it anywhere silences it everywhere, so nobody
 * reads the same warning on the launcher and then again in the lobby.
 *
 * WHEN RUNWAY LEAVES ALPHA: delete this file and the two `<AlphaNotice />`
 * usages — `PlayLauncher.tsx` and `GameLobby.tsx`. Nothing else references it,
 * and it owns its own storage key, so there is no shared state left behind.
 */
import React, { useState } from 'react';
import { Button, Notice } from '@ds';
import { getString, setString } from '../../core/util/storage';

const DISMISSED_KEY = 'runway:alpha-notice';

export const AlphaNotice: React.FC = () => {
  // Read once on mount: a device that has already acknowledged this never
  // renders it again, and a browser that blocks storage simply sees it again
  // rather than losing the page.
  const [dismissed, setDismissed] = useState(() => getString(DISMISSED_KEY) === 'seen');

  if (dismissed) return null;

  const dismiss = () => {
    setString(DISMISSED_KEY, 'seen');
    setDismissed(true);
  };

  return (
    <Notice title="Runway is in alpha" style={{ marginBottom: 'var(--sp-5)' }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-4)',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ flex: 1, minWidth: '16rem', color: 'var(--ink-muted)' }}>
          Expect some jankiness and the odd bug.
        </span>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </Notice>
  );
};
