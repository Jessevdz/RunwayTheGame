import React from 'react';
import { formatClock } from '../../../core/format/clock';

interface EffectChipsProps {
  vetoLeft: number;
  trackerLeft: number;
  /** Indicates if the veto cooldown chip should be rendered. */
  showVetoChip: boolean;
}

/** Active effect status chips component for player console. */
export const EffectChips: React.FC<EffectChipsProps> = ({ vetoLeft, trackerLeft, showVetoChip }) => {
  /* Curses are inactive for the current PoC. When they come back this is where
     they render — a chip per curse, each with a Resolve button that opens the
     shop, which is the only place a curse can be paid off. */
  if (!showVetoChip && trackerLeft <= 0) return null;

  return (
    <div className="effects">
      {showVetoChip && (
        <div className="effect effect--warn">
          <span className="effect__text">⏳ Skipped a challenge — no new challenges until this lapses</span>
          <span className="effect__time">{formatClock(vetoLeft)}</span>
        </div>
      )}
      {trackerLeft > 0 && (
        <div className="effect effect--warn">
          <span className="effect__text">👁️ Tracker off — rivals cannot see you</span>
          <span className="effect__time">{formatClock(trackerLeft)}</span>
        </div>
      )}
    </div>
  );
};
