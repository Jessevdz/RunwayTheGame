import React, { useState } from 'react';
import { PowerupWorkshop } from './PowerupWorkshop';
import { formatDuration } from './powerups';
import type { PowerupDraft } from './powerups';
import { Button, Icon } from '@ds';

export type { PowerupDraft, PowerupEffect } from './powerups';

interface PowerupEditorProps {
  powerups: PowerupDraft[];
  isEditable: boolean;
  onChangePowerups: (updated: PowerupDraft[]) => void;
}

export const PowerupEditor: React.FC<PowerupEditorProps> = ({
  powerups,
  isEditable,
  onChangePowerups
}) => {
  const [showWorkshop, setShowWorkshop] = useState(false);

  const preview = powerups.slice(0, 6);

  return (
    <div className="deck-summary">
      <span className="t-label">POWER-UPS</span>
      <p className="deck-summary__hint">
        Set each power-up's coin cost and duration.
      </p>

      <div className="deck-summary__decks">
        <button
          className="deck-summary__deck deck-summary__deck--power"
          onClick={() => setShowWorkshop(true)}
          title="Open the Power-up Workshop"
        >
          <div className="deck-summary__deck-head">
            <span className="deck-summary__deck-name">
              <Icon name="powerup" />
              <span>Power-up Catalog</span>
            </span>
            <span className="deck-summary__count">{powerups.length}</span>
          </div>
          <ul className="deck-summary__preview">
            {preview.map((p) => (
              <li key={p.id}>
                {p.name || 'Untitled power-up'} · <Icon name="coin" /> {p.cost} ·{' '}
                <Icon name="clock" /> {formatDuration(p.duration_s)}
              </li>
            ))}
            {powerups.length > preview.length && (
              <li className="deck-summary__more">
                +{powerups.length - preview.length} more…
              </li>
            )}
          </ul>
        </button>
      </div>

      <Button
        variant="primary"
        icon={<Icon name="powerup" />}
        className="deck-summary__open"
        onClick={() => setShowWorkshop(true)}
      >
        Open Power-up Workshop
      </Button>

      {showWorkshop && (
        <PowerupWorkshop
          powerups={powerups}
          isEditable={isEditable}
          onChange={onChangePowerups}
          onClose={() => setShowWorkshop(false)}
        />
      )}
    </div>
  );
};

