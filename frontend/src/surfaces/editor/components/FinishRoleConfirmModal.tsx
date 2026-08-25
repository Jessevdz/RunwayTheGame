import React from 'react';
import { Dialog, Button } from '@ds';

export interface PendingFinishRole {
  waypointId: string;
  name: string;
  /** The prompt the waypoint is currently carrying, quoted back so the
   *  designer can see exactly what they are about to lose. */
  prompt: string;
}

interface FinishRoleConfirmModalProps {
  target: PendingFinishRole;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation modal when assigning finish role to a waypoint with an existing challenge. */
export const FinishRoleConfirmModal: React.FC<FinishRoleConfirmModalProps> = ({
  target,
  onConfirm,
  onCancel
}) => (
  <Dialog open title="🏁 MAKE THIS THE FINISH" onClose={onCancel}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div>
        <p style={{ margin: '0 0 var(--sp-2) 0', fontSize: '1rem', fontWeight: 600 }}>
          <strong>{target.name || 'This waypoint'}</strong> has a challenge on it.
        </p>
        <p style={{ margin: '0 0 var(--sp-2) 0', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
          The finish line has no challenge — arriving there is the objective, and the arrival is all
          that gets logged. Making this the finish deletes its challenge.
        </p>
        {target.prompt.trim() && (
          <p
            style={{
              margin: 0,
              padding: 'var(--sp-2)',
              background: 'var(--surface-2)',
              border: '0.0625rem solid var(--line)',
              borderRadius: 'var(--r-sm)',
              color: 'var(--ink-muted)',
              fontSize: '0.9rem'
            }}
          >
            “{target.prompt.trim()}”
          </p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Keep the challenge
        </Button>
        <Button variant="primary" size="sm" onClick={onConfirm}>
          Make it the finish
        </Button>
      </div>
    </div>
  </Dialog>
);
