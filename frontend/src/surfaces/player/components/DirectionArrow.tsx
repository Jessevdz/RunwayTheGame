import React, { useRef } from 'react';
import { arrowRotation, compassName, nearestAngle } from '../../../core/player/bearing';
import { useDeviceHeading } from '../../../core/player/useDeviceHeading';

interface DirectionArrowProps {
  /** Compass bearing to the target in degrees, or null while there is no fix. */
  bearing: number | null;
  /** Says how far off the target is, for the spoken label. */
  distanceText?: string;
  /** Tints the arrow when the player is already inside the arrival zone. */
  inRange?: boolean;
}

/** Arrow pointing at the next stop; turns with the phone when it has a compass and otherwise points from north. */
export const DirectionArrow: React.FC<DirectionArrowProps> = ({ bearing, distanceText, inRange = false }) => {
  const rotationRef = useRef(0);
  // Read here so a turning phone re-renders only the arrow, never the whole console.
  const heading = useDeviceHeading(bearing !== null);

  if (bearing === null) {
    return (
      <span className="dir-arrow dir-arrow--none" role="img" aria-label="Direction unknown, waiting for GPS">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="dir-arrow__icon">
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      </span>
    );
  }

  rotationRef.current = nearestAngle(rotationRef.current, arrowRotation(bearing, heading));
  const where = heading === null ? compassName(bearing) : 'the way the arrow points';
  const label = `${inRange ? 'In the arrival zone. ' : ''}Head ${where}${distanceText ? `, ${distanceText}` : ''}`;

  return (
    <span
      className={`dir-arrow${inRange ? ' dir-arrow--here' : ''}`}
      role="img"
      aria-label={label}
      style={{ '--arrow-rot': `${rotationRef.current}deg` } as React.CSSProperties}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="dir-arrow__icon">
        <path d="M12 3 19 20 12 16 5 20Z" fill="currentColor" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
    </span>
  );
};
