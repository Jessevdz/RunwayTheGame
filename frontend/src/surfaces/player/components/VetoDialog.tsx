import React from 'react';
import { Button, Dialog } from '@ds';
import { formatClock, formatDurationWords } from '../../../core/format/clock';

interface VetoDialogProps {
  solo: boolean;
  timeTrial: boolean;
  /** What a time-trial skip adds to the clock, and what this run has paid already. */
  vetoTimePenalty: number;
  vetoPenaltyTotal: number;
  /** What a team-race skip locks out, in seconds. */
  vetoCooldown: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Dialog asking for confirmation before skipping a challenge. */
export const VetoDialog: React.FC<VetoDialogProps> = ({
  solo,
  timeTrial,
  vetoTimePenalty,
  vetoPenaltyTotal,
  vetoCooldown,
  onCancel,
  onConfirm
}) => (
  <Dialog open title="Skip this challenge?" onClose={onCancel}>
    <p className="fs-5" style={{ marginBottom: 'var(--sp-4)' }}>
      {timeTrial ? (
        <>
          Adds <b>{formatDurationWords(vetoTimePenalty)}</b> to your time
          {vetoPenaltyTotal > 0 && <> ({formatClock(vetoPenaltyTotal + vetoTimePenalty)} in penalties total)</>}.
        </>
      ) : solo ? (
        <>No photo needed, and it costs nothing.</>
      ) : (
        <>
          No photo needed, but no challenges for <b>{formatDurationWords(vetoCooldown)}</b>.
        </>
      )}
    </p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
      <Button variant="secondary" onClick={onCancel}>
        Keep the challenge
      </Button>
      <Button variant="primary" onClick={onConfirm}>
        {solo && !timeTrial ? 'Skip it' : 'Skip and take the penalty'}
      </Button>
    </div>
  </Dialog>
);
