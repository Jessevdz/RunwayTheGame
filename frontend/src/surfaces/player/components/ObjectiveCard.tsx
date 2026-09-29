import React from 'react';
import { Button, Clock, Icon } from '@ds';
import { type ObjectiveView } from '../objective';
import { DirectionArrow } from './DirectionArrow';

interface ObjectiveCardProps {
  objective: ObjectiveView;
  /** True on phones, where the field bar already carries the primary button and the arrow. */
  inFieldBar: boolean;
}

/** The one card that says what to do next. Renders a view, decides nothing. */
export const ObjectiveCard: React.FC<ObjectiveCardProps> = ({ objective, inFieldBar }) => {
  const { guide, readout } = objective;
  return (
    // Keeps aria-live polite feedback isolated to the title element.
    <section className={`objective objective--${objective.tone}`}>
      <h2 className="objective__title" aria-live="polite">{objective.title}</h2>

      {(readout || (objective.showArrow && !inFieldBar)) && (
        <div className="objective__where">
          {objective.showArrow && !inFieldBar && (
            <DirectionArrow
              bearing={guide ? guide.bearing : null}
              distanceText={guide ? `${Math.round(guide.distance)} metres` : undefined}
              inRange={guide?.inRange}
            />
          )}
          {readout && readout.clockSeconds !== undefined ? (
            <Clock flap size="lg" seconds={readout.clockSeconds} caption={readout.unit} />
          ) : (
            readout && (
              <p className="objective__readout" role="timer" aria-live="off">
                <b>{readout.value}</b>
                <span>{readout.unit}</span>
              </p>
            )
          )}
        </div>
      )}

      {objective.status && (
        <p className={`objective__status objective__status--${objective.status.kind}`} role="status">
          {objective.status.text}
        </p>
      )}

      {objective.say && <p className="objective__say">{objective.say}</p>}

      {!inFieldBar && objective.primary && (
        <div className="objective__act">
          <Button
            variant="primary"
            icon={<Icon name={objective.primary.icon} />}
            disabled={objective.primary.disabled}
            onClick={objective.primary.onClick}
          >
            {objective.primary.label}
          </Button>
        </div>
      )}

      {objective.minor && (
        <div className="objective__minor">
          <Button variant="ghost" size="sm" onClick={objective.minor.onClick}>
            {objective.minor.label}
          </Button>
        </div>
      )}
    </section>
  );
};
