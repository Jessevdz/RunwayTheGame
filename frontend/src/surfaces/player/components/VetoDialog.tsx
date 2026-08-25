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
          You will not have to photograph anything here, but{' '}
          <b>{formatDurationWords(vetoTimePenalty)}</b> goes onto your recorded time.
          {vetoPenaltyTotal > 0 && (
            <> That would make {formatClock(vetoPenaltyTotal + vetoTimePenalty)} of penalties on this run.</>
          )}
        </>
      ) : solo ? (
        <>
          You will not have to photograph anything here, and the road out opens straight away. Nothing
          is timed on a casual walk, so this costs you nothing.
        </>
      ) : (
        <>
          You will not have to photograph anything here and the road out opens straight away, but you
          cannot take on <i>any</i> challenge for <b>{formatDurationWords(vetoCooldown)}</b> — so no coins in
          that time. Rivals keep moving.
        </>
      )}
    </p>
    <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
      <Button variant="secondary" onClick={onCancel}>
        Keep the challenge
      </Button>
      <Button variant="primary" onClick={onConfirm}>
        {solo && !timeTrial ? 'Skip it' : 'Skip and take the penalty'}
      </Button>
    </div>
  </Dialog>
);
