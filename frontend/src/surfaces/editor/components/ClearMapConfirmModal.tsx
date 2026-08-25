import React from 'react';
import { Dialog, Button } from '@ds';

interface ClearMapConfirmModalProps {
  waypointCount: number;
  roadCount: number;
  /** Already on the server: clearing only empties the editor until the next save. */
  savedToServer: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Confirmation for throwing the whole design away and starting from a blank map. */
export const ClearMapConfirmModal: React.FC<ClearMapConfirmModalProps> = ({
  waypointCount,
  roadCount,
  savedToServer,
  onConfirm,
  onCancel
}) => (
  <Dialog open title="🗑️ CLEAR MAP" onClose={onCancel}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div>
        <p style={{ margin: '0 0 var(--sp-2) 0', fontSize: '1rem', fontWeight: 600 }}>
          Start this design over from scratch?
        </p>
        <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
          This removes {plural(waypointCount, 'waypoint')} and {plural(roadCount, 'road')}, along
          with the map name, its challenges and its power-up prices. This action cannot be undone.
        </p>
        {savedToServer && (
          <p style={{ margin: 'var(--sp-2) 0 0 0', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
            The saved version stays on the server until you save the empty map over it.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onConfirm}
          style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
        >
          Clear Map
        </Button>
      </div>
    </div>
  </Dialog>
);
