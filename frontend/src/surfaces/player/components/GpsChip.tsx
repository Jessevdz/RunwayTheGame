import React from 'react';
import { type GpsStatus } from '../../../core/player/gpsStatus';

/** Small chip saying whether the phone has a usable position: searching, accuracy, lost or blocked. */
export const GpsChip: React.FC<{ status: GpsStatus }> = ({ status }) => (
  <span className={`gps-chip gps-chip--${status.tone}`} role="status">
    <span className="gps-chip__dot" aria-hidden="true" />
    {status.label}
  </span>
);
