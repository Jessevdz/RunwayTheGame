import React from 'react';
import { useTheme } from '../theme/useTheme';
import { Button } from '../primitives/Button';
import { Card } from '../primitives/Card';
import { Badge } from '../primitives/Badge';
import { Pin } from '../primitives/Pin';
import { Plate } from '../primitives/Plate';
import { Hex } from '../primitives/Hex';
import { Sticker } from '../primitives/Sticker';
import { Stat } from '../primitives/Stat';
import { Chip } from '../primitives/Chip';
import { Callout } from '../primitives/Callout';
import { Hero } from '../primitives/Hero';
import { Flap } from '../primitives/Flap';
import { ArcMark } from '../primitives/ArcMark';
import { RouteGlobe, type RouteGlobeVariant } from '../primitives/RouteGlobe';
import { Notice } from '../primitives/Notice';
import { Empty } from '../primitives/Empty';
import { Infobox } from '../primitives/Infobox';
import { Board } from '../primitives/Board';
import { Pass } from '../primitives/Pass';
import { LinkButton } from '../primitives/LinkButton';
import { Grid } from '../layout/Grid';
import { Omnisearch } from '../forms/Omnisearch';
import { Input } from '../forms/Input';
import { Select } from '../forms/Select';
import { Checkbox } from '../forms/Checkbox';
import { Radio } from '../forms/Radio';
import { Switch } from '../forms/Switch';
import { Tabs } from '../navigation/Tabs';
import { CardRail } from '../layout/CardRail';
import { Toast } from '../overlays/Toast';
import { Tooltip } from '../overlays/Tooltip';
import { Dialog } from '../overlays/Dialog';

const TONES = ['gold', 'rust', 'moss', 'crimson', 'neutral'] as const;

/** Map of RouteGlobe variant descriptions for gallery preview. */
const ROUTE_GLOBES: Record<RouteGlobeVariant, string> = {
  bands: 'bundled bands',
  orbit: 'one lap of the world · shipping',
  network: 'waypoints and roads',
  fan: 'one start, three finishes',
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="gallery-section">
    <h2 className="t-label fs-label gallery-section__title">{title}</h2>
    {children}
  </section>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="gallery-row">
    {children}
  </div>
);

export const Gallery: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = React.useState('tab1');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [radio, setRadio] = React.useState('a');
  const [checked, setChecked] = React.useState(true);
  const [enabled, setEnabled] = React.useState(true);
  const [text, setText] = React.useState('');
  const [choice, setChoice] = React.useState('one');

  return (
    <div className="gallery-shell">
      <div className="gallery-header">
        <h1 className="t-announce fs-10">Departure Design System</h1>
        <Button variant="secondary" onClick={toggleTheme}>
          Theme: {theme}
        </Button>
      </div>

      <Section title="Buttons">
        <Row>
          <LinkButton href="#" variant="secondary" size="sm">Link Button</LinkButton>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
        </Row>
      </Section>

      <Section title="Chips, badges & callouts">
        <Row>
          <Badge tone="neutral">NEUTRAL</Badge>
          <Badge tone="crimson">CRIMSON</Badge>
          <Badge tone="rust">RUST</Badge>
          <Badge tone="moss">MOSS</Badge>
          <Badge tone="gold">GOLD</Badge>
          <Chip kind="rule">Rule</Chip>
          <Chip kind="power">Powerup</Chip>
          <Chip kind="curse">Curse</Chip>
          <Chip kind="challenge">Challenge</Chip>
          <Chip kind="veto">Veto</Chip>
          <Chip kind="live">Live</Chip>
        </Row>
        <div className="gallery-grid-sm gallery-mt-3">
          <Callout kind="rule"><span className="fs-5">Scoring tick runs every 60 seconds.</span></Callout>
          <Callout kind="curse"><span className="fs-5">Your next capture is blocked.</span></Callout>
          <Callout kind="power"><span className="fs-5">Double points active.</span></Callout>
          <Callout kind="veto"><span className="fs-5">Challenge vetoed by the host.</span></Callout>
        </div>
      </Section>

      <Section title="Toasts — every tone">
        <div className="gallery-grid-sm">
          {TONES.map((tone) => (
            <Toast key={tone} tone={tone}>Toast in the {tone} tone.</Toast>
          ))}
        </div>
      </Section>

      <Section title="Cards & card rail">
        <CardRail>
          <Card className="card--pad">
            <h3 className="fs-7 gallery-mb-2">Standard Card</h3>
            <p className="fs-5 ink-muted">Surface container.</p>
          </Card>
          <Card className="card--pad" interactive>
            <h3 className="fs-7 gallery-mb-2">Interactive Card</h3>
            <p className="fs-5 ink-muted">Hover lift. The click lives on a child button.</p>
            <div className="gallery-mt-3">
              <Button variant="secondary" size="sm">Open</Button>
            </div>
          </Card>
          <Card className="card--pad">
            <Stat label="Total Points" value="1,420" hint="+15% this match" />
          </Card>
        </CardRail>
      </Section>

      <Section title="Forms">
        <div className="gallery-grid-md">
          <Input label="Username" placeholder="Enter username…" hint="Unique player handle" value={text} onChange={(e) => setText(e.target.value)} />
          <Input label="Invite code" placeholder="ABC-123" error="That code has expired." value="" onChange={() => {}} />
          <Select label="Basemap" value={choice} onChange={(e) => setChoice(e.target.value)} hint="Follows the theme by default">
            <option value="one">Auto</option>
            <option value="two">Default</option>
            <option value="three">Dark</option>
          </Select>
          <Row>
            <Checkbox label="Remember me" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <Switch label="Notifications" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          </Row>
          <Row>
            <Radio name="g" label="Option A" checked={radio === 'a'} onChange={() => setRadio('a')} />
            <Radio name="g" label="Option B" checked={radio === 'b'} onChange={() => setRadio('b')} />
          </Row>
        </div>
      </Section>

      <Section title="Navigation & overlays">
        <div className="gallery-grid-md">
          <Tabs
            items={[
              { id: 'tab1', label: 'Overview' },
              { id: 'tab2', label: 'Challenges', badge: 3 },
              { id: 'tab3', label: 'Route' },
            ]}
            active={activeTab}
            onChange={setActiveTab}
          />
          <Row>
            <Tooltip label="Opens a modal dialog">
              <Button variant="primary" onClick={() => setDialogOpen(true)}>Open Dialog</Button>
            </Tooltip>
          </Row>
        </div>
        <Dialog open={dialogOpen} title="Dialog Title" onClose={() => setDialogOpen(false)}>
          <p className="fs-5">
            Escape closes, the scrim closes, focus is trapped inside, and the body is scroll-locked.
          </p>
        </Dialog>
      </Section>

      <Section title="Notices & empty state">
        <div className="gallery-grid-sm">
          <Notice title="Scoring tick">Standings refresh every 60 seconds.</Notice>
          <Notice kind="warn" title="Weak GPS">Your last fix was 40 metres off.</Notice>
          <Notice kind="stop" title="Road locked">Clear the roadblock before advancing.</Notice>
        </div>
        <div className="gallery-mt-4">
          <Empty
            icon="🗺️"
            title="No local maps saved"
            description="Create a new map or edit a public one to keep it on this device."
            action={<Button variant="primary" size="sm">Create a map</Button>}
          />
        </div>
      </Section>

      <Section title="Boarding pass & grid">
        <Grid cols={2}>
          <Pass
            title="Antwerp Dockside Sprint"
            from="ANR"
            to="FIN"
            stubValue="6"
            stubLabel="Waypoints"
          />
          <Pass
            title="Ghent Canal Loop"
            from="GNE"
            to="GNE"
            stubValue="12"
            stubLabel="Waypoints"
          />
        </Grid>
      </Section>

      <Section title="Standings board">
        <Board
          columns={[
            { key: 'team', header: 'Team', who: true, render: (r) => <><Pin tone="gold">{r.pos}</Pin>{r.team}</> },
            { key: 'cp', header: 'Waypoints', numeric: true, render: (r) => r.cp },
            { key: 'pts', header: 'Points', numeric: true, render: (r) => r.pts },
          ]}
          rows={[
            { pos: 1, team: 'Red Kite', cp: 5, pts: 1420 },
            { pos: 2, team: 'Blue Heron', cp: 4, pts: 1180 },
            { pos: 3, team: 'Moss Fox', cp: 4, pts: 990 },
          ]}
          rowKey={(r) => r.team}
          isLeader={(_, i) => i === 0}
        />
      </Section>

      <Section title="Infobox">
        <div className="gallery-grid-lg">
          <Infobox
            title="Match Rules"
            rows={[
              { term: 'Tick', detail: 'Every 60 seconds' },
              { term: 'Teams', detail: '2 – 6' },
              { term: 'Verify', detail: 'Photo + GPS heuristics' },
            ]}
          />
          <Omnisearch placeholder="Search maps…" shortcut="/" />
        </div>
      </Section>

      <Section title="Split-flap & sunset arc">
        <Row>
          <Flap value="04:21" />
          <Flap value="1420" />
        </Row>
        <div className="gallery-mt-4">
          <ArcMark />
        </div>
      </Section>

      {/* All four route treatments side by side — this is where they get compared. */}
      <Section title="Route globe variants">
        <div className="gallery-grid-auto">
          {(Object.entries(ROUTE_GLOBES) as [RouteGlobeVariant, string][]).map(([variant, note]) => (
            <figure key={variant} className="gallery-fig">
              <RouteGlobe variant={variant} style={{ width: '100%' }} />
              <figcaption className="t-label fs-label gallery-figcaption">
                {variant} — {note}
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title="Brand motifs">
        <Row>
          <Plate><span className="t-announce fs-7">Plate</span></Plate>
          <Hex size="sm" num="3" />
          <Hex num="12" kicker="LEAD" />
          <Hex size="lg" variant="player" num="7" kicker="PLAYER" />
          <Hex variant="seek" num="!" kicker="SEEK" />
          <Sticker><span className="fs-4">AMBER</span></Sticker>
          <Sticker tone="red"><span className="fs-4">RED</span></Sticker>
        </Row>
        <div className="gallery-mt-4">
          <Hero>
            <span className="t-label fs-label">DESIGN · SHARE · RACE</span>
            <h3 className="t-announce fs-d-md">Departure</h3>
          </Hero>
        </div>
      </Section>

      <Section title="Type scale">
        <div className="gallery-grid-sm">
          <span className="t-announce fs-d-lg">Announce · d-lg</span>
          <span className="t-narrate fs-9">Narrate · fs-9</span>
          <span className="t-data fs-4">Data · fs-4</span>
          <span className="t-label fs-label">Label · fs-label</span>
        </div>
      </Section>
    </div>
  );
};
