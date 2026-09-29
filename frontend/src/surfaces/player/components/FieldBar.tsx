import React from 'react';
import { Button, Icon } from '@ds';
import { type GpsStatus } from '../../../core/player/gpsStatus';
import { peekUnit } from '../consoleFormat';
import { type ObjectiveView } from '../objective';
import { DirectionArrow } from './DirectionArrow';
import { GpsChip } from './GpsChip';

interface FieldBarProps {
  objective: ObjectiveView;
  gps: GpsStatus;
  /** The clock and coins, already drawn. */
  vitals: React.ReactNode;
  /** Changes each time the sheet wants attention, restarting the action pulse. */
  pulseKey: number;
  /** The last failed action as a plain sentence, kept in view even with the panel folded. */
  error: string | null;
}

/** The always-visible strip of the race panel: where to, how far, what to do, and the numbers that matter. */
export const FieldBar: React.FC<FieldBarProps> = ({ objective, gps, vitals, pulseKey, error }) => {
  const { guide, readout, status, primary } = objective;
  const unit = readout ? peekUnit(readout.unit) : '';
  const distanceText = guide ? `${Math.round(guide.distance)} metres` : undefined;

  return (
    <div className={`field-bar field-bar--${objective.tone}`}>
      <div className="field-bar__row">
        {objective.showArrow && (
          <DirectionArrow
            bearing={guide ? guide.bearing : null}
            distanceText={distanceText}
            inRange={guide?.inRange}
          />
        )}

        <div className="field-bar__where">
          <span className="field-bar__target">{objective.title}</span>
          {readout ? (
            <span className="field-bar__dist">
              {readout.value}
              {unit && <small>{unit}</small>}
            </span>
          ) : (
            status && <span className={`field-bar__status field-bar__status--${status.kind}`}>{status.text}</span>
          )}
        </div>

        {primary && (
          <div key={pulseKey} className={`field-bar__act${pulseKey > 0 ? ' field-bar__act--pulse' : ''}`}>
            <Button
              variant="primary"
              size="lg"
              icon={<Icon name={primary.icon} />}
              disabled={primary.disabled}
              onClick={primary.onClick}
            >
              {primary.label}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="field-bar__error" role="alert">
          {error}
        </p>
      )}

      <div className="field-bar__meta">
        {vitals}
        <GpsChip status={gps} />
      </div>
    </div>
  );
};
