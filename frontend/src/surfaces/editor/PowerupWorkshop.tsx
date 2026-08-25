import React, { useCallback } from 'react';
import {
  POWERUP_EFFECTS,
  formatDuration
} from './powerups';
import type { PowerupDraft } from './powerups';
import { Dialog, Button, Input, Chip } from '@ds';
import {
  IconClock,
  IconCoin,
  IconDone,
  IconPowerup
} from './components/EditorIcons';

interface PowerupWorkshopProps {
  powerups: PowerupDraft[];
  isEditable: boolean;
  onChange: (updated: PowerupDraft[]) => void;
  onClose: () => void;
}

export const PowerupWorkshop: React.FC<PowerupWorkshopProps> = ({
  powerups,
  isEditable,
  onChange,
  onClose
}) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);

  /** Focuses the first input field within the container. */
  const focusFirstField = useCallback((waypoint: HTMLDivElement | null) => {
    waypoint?.querySelector<HTMLInputElement>('.field__input')?.focus();
  }, []);

  const patch = (id: string, changes: Partial<PowerupDraft>) => {
    onChange(powerups.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  };

  return (
    <Dialog open title="POWER-UP WORKSHOP" onClose={onClose} className="dialog--wide">
      <div className="deck-workshop">
        <div className="deck-grid">
          {powerups.map((p, idx) => {
            const isEditingCard = editingId === p.id && isEditable;
            const effectMeta = POWERUP_EFFECTS[p.effect] || POWERUP_EFFECTS.nerf;

            if (isEditingCard) {
              return (
                <div
                  key={p.id}
                  ref={focusFirstField}
                  className="deck-card deck-card--power deck-card--editing"
                >
                  <div className="deck-card__badge">
                    <IconPowerup />
                    <span>POWER-UP · #{idx + 1}</span>
                  </div>

                  <div className="deck-card__title">
                    <span>{p.name}</span>
                  </div>

                  <div className="deck-card__body">
                    {p.description}
                  </div>

                  <div className="powerup-card__fields">
                    <Input
                      label={
                        <>
                          <IconCoin /> Cost
                        </>
                      }
                      type="number"
                      value={p.cost}
                      onChange={(e) => patch(p.id, { cost: parseInt(e.target.value) || 0 })}
                    />
                    <Input
                      label={
                        <>
                          <IconClock /> Duration
                        </>
                      }
                      hint="Seconds — 0 is instant"
                      type="number"
                      value={p.duration_s}
                      onChange={(e) => patch(p.id, { duration_s: parseInt(e.target.value) || 0 })}
                    />
                  </div>

                  <div className="field">
                    <label className="field__label">Engine Effect</label>
                    <div className="field__hint">
                      <strong>{effectMeta.label}</strong> — {effectMeta.hint}
                    </div>
                  </div>

                  <div className="deck-card__actions">
                    <Button variant="primary" icon={<IconDone />} onClick={() => setEditingId(null)}>
                      Done
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={p.id}
                className={`deck-card deck-card--power ${isEditable ? 'deck-card--clickable' : ''}`}
                onClick={() => isEditable && setEditingId(p.id)}
              >
                <div className="deck-card__badge">
                  <IconPowerup />
                  <span>
                    {effectMeta.label} · #{idx + 1}
                  </span>
                </div>
                <div className="deck-card__title">
                  <span>{p.name || 'Untitled power-up'}</span>
                </div>
                <div className="deck-card__body">
                  {p.description || (isEditable ? 'Click to add a description…' : '')}
                </div>
                <div className="powerup-card__chips">
                  <Chip kind="power">
                    <IconCoin /> {p.cost}
                  </Chip>
                  <Chip>
                    <IconClock /> {formatDuration(p.duration_s)}
                  </Chip>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
};

