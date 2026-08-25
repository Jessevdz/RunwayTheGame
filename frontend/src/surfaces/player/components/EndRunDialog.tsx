import React from 'react';
import { Button, Dialog } from '@ds';

interface EndRunDialogProps {
  timeTrial: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Stopping a solo run short of the finish. Nothing else can stop it. */
export const EndRunDialog: React.FC<EndRunDialogProps> = ({ timeTrial, onCancel, onConfirm }) => (
  <Dialog open title="End this run?" onClose={onCancel}>
    <p className="fs-5" style={{ marginBottom: 'var(--sp-4)' }}>
      The run stops here, short of the finish.{' '}
      {timeTrial
        ? 'A run that did not finish cannot be posted to the leaderboard.'
        : 'Nothing is recorded either way.'}{' '}
      This cannot be undone.
    </p>
    <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
      <Button variant="secondary" onClick={onCancel}>
        Keep going
      </Button>
      <Button variant="primary" onClick={onConfirm}>
        End the run
      </Button>
    </div>
  </Dialog>
);
