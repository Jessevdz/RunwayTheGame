import React from 'react';
import { Button } from '@ds';
import { type ObjectiveView } from '../objective';

/** The one card that says what to do next. Renders a view, decides nothing. */
export const ObjectiveCard: React.FC<{ objective: ObjectiveView }> = ({ objective }) => (
  // Keeps aria-live polite feedback isolated to the title element.
  <section className={`objective objective--${objective.tone}`}>
    <h2 className="objective__title" aria-live="polite">{objective.title}</h2>

    {objective.readout && (
      <p className="objective__readout" role="timer" aria-live="off">
        <b>{objective.readout.value}</b>
        <span>{objective.readout.unit}</span>
      </p>
    )}

    {objective.say && <p className="objective__say">{objective.say}</p>}

    {objective.primary && (
      <div className="objective__act">
        <Button
          variant="primary"
          icon={objective.primary.icon}
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
