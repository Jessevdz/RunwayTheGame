import React from 'react';
import { Card, Button } from '@ds';

interface StartRaceOptionsProps {
  onHostTeamRace: () => void;
  onStartSoloRun: () => void;
}

interface Path {
  title: string;
  blurb: string;
  /** Exactly what happens after the button, in order — the point of this
   *  section is that neither path is a mystery before it is picked. */
  steps: string[];
  action: { label: string; icon: string; variant: 'primary' | 'secondary' };
  onSelect: (props: StartRaceOptionsProps) => void;
}

/** Team race first: it is the flagship shape of the game, and the one whose
 *  extra step (waiting for other teams) is worth knowing about up front. */
const PATHS: Path[] = [
  {
    title: 'TEAM RACE',
    blurb: 'Two or more teams race the same map at once. You hold the host tools: you start it and you settle disputes.',
    steps: [
      'Pick a map.',
      'Share the race code or invite QR from the lobby.',
      'Start the race once every team has joined.',
    ],
    action: { label: 'Host a team race', icon: '🏁', variant: 'primary' },
    onSelect: (p) => p.onHostTeamRace(),
  },
  {
    title: 'SOLO RACE',
    blurb: 'Race the clock for the leaderboard, or walk it casually.',
    steps: [
      'Pick time trial or casual.',
      'Pick a map.',
      'Start right away.',
    ],
    action: { label: 'Start a solo race', icon: '🥾', variant: 'secondary' },
    onSelect: (p) => p.onStartSoloRun(),
  },
];

/** Component displaying options for starting a hosted group race or solo run. */
export const StartRaceOptions: React.FC<StartRaceOptionsProps> = (props) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
        gap: 'var(--sp-5)',
      }}
    >
      {PATHS.map((path) => (
        <Card
          key={path.title}
          interactive
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', padding: 'var(--sp-5)' }}
        >
          <h3 className="t-announce fs-8" style={{ margin: 0, color: 'var(--ink-strong)' }}>
            {path.title}
          </h3>

          <p className="fs-5" style={{ margin: 0, color: 'var(--ink-muted)' }}>
            {path.blurb}
          </p>

          {/* Numbered by the list, not by hand: the count is the journey. */}
          <ol
            style={{
              margin: 0,
              paddingLeft: 'var(--sp-5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-2)',
            }}
          >
            {path.steps.map((step) => (
              <li key={step} className="fs-5" style={{ color: 'var(--ink)' }}>
                {step}
              </li>
            ))}
          </ol>

          {/* Pushed to the bottom edge so both cards' buttons line up however
              differently the copy wraps. Card carries no onClick by contract —
              this button is the whole click target. */}
          <div style={{ marginTop: 'auto', paddingTop: 'var(--sp-3)' }}>
            <Button
              variant={path.action.variant}
              size="lg"
              icon={path.action.icon}
              onClick={() => path.onSelect(props)}
              style={{ width: '100%' }}
            >
              {path.action.label}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
};
