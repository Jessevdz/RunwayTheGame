import React, { useEffect, useRef } from 'react';
import { ArcMark, Button, Icon } from '@ds';
import type { PendingCelebration } from '../../core/game/useRaceMoments';
import { vibrateFor } from '../../core/player/vibrate';
import './celebration.css';

interface CelebrationOverlayProps {
  celebration: PendingCelebration;
  onContinue: () => void;
}

/** Full-screen "Cleared!" moment with the Sunset arc, what it unlocked, and where to go next. */
export const CelebrationOverlay: React.FC<CelebrationOverlayProps> = ({ celebration, onContinue }) => {
  const { moment, copy } = celebration;
  const actionsRef = useRef<HTMLDivElement>(null);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useEffect(() => {
    vibrateFor(moment.kind);
    actionsRef.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onContinueRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moment.key, moment.kind]);

  return (
    <div
      className={`celebration celebration--${moment.kind}`}
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
    >
      <div className="celebration__body">
        <ArcMark animate={false} className="celebration__arc" />
        <p className="celebration__eyebrow">{copy.eyebrow}</p>
        <h2 className="celebration__title">{copy.title}</h2>
        {copy.detail && <p className="celebration__detail">{copy.detail}</p>}

        {(copy.unlocked || copy.next || copy.coins) && (
          <ul className="celebration__facts">
            {copy.coins && (
              <li className="celebration__fact celebration__fact--coins">
                <Icon name="coin" /> {copy.coins}
              </li>
            )}
            {copy.unlocked && <li className="celebration__fact">{copy.unlocked}</li>}
            {copy.next && <li className="celebration__fact celebration__fact--next">{copy.next}</li>}
          </ul>
        )}
      </div>

      <div className="celebration__actions" ref={actionsRef}>
        <Button variant="primary" size="lg" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
};
