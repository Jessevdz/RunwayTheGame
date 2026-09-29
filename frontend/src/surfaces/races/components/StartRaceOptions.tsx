import React from 'react';
import { Card, Button, Icon, type IconName } from '@ds';

interface StartRaceOptionsProps {
  onHostTeamRace: () => void;
  onStartSoloRun: () => void;
}

interface Path {
  title: string;
  blurb: string;
  action: { label: string; icon: IconName; variant: 'primary' | 'secondary' };
  onSelect: (props: StartRaceOptionsProps) => void;
}

/** Team race first: it is the flagship shape of the game, and the one whose
 *  extra step (waiting for other teams) is worth knowing about up front. */
const PATHS: Path[] = [
  {
    title: 'TEAM RACE',
    blurb: 'Teams race the same map. You host: start the race and settle disputes.',
    action: { label: 'Host a team race', icon: 'flag', variant: 'primary' },
    onSelect: (p) => p.onHostTeamRace(),
  },
  {
    title: 'SOLO RACE',
    blurb: 'Race the clock for the leaderboard, or walk it casually.',
    action: { label: 'Start a solo race', icon: 'route', variant: 'secondary' },
    onSelect: (p) => p.onStartSoloRun(),
  },
];

/** Component displaying options for starting a hosted group race or solo run. */
export const StartRaceOptions: React.FC<StartRaceOptionsProps> = (props) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(18rem, 100%), 1fr))',
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

          {/* Pushed to the bottom edge so both cards' buttons line up however
              differently the copy wraps. Card carries no onClick by contract —
              this button is the whole click target. */}
          <div style={{ marginTop: 'auto', paddingTop: 'var(--sp-3)' }}>
            <Button
              variant={path.action.variant}
              size="lg"
              icon={<Icon name={path.action.icon} />}
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
