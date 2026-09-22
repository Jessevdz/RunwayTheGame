import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Notice, Stat, Tabs } from '@ds';
import { getAnalyticsOverview } from '../../core/api/client';
import type { AnalyticsBreakdown, AnalyticsOverview } from '../../core/api/client';

/** Windows an operator can ask for, capped by the 90-day retention window. */
const WINDOWS = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' }
];

/** Human wording for the event names the registry declares. */
const EVENT_LABELS: Record<string, string> = {
  'app.surface_opened': 'Page opened',
  'app.design_unavailable': 'Designer blocked (mobile)',
  'app.request_failed': 'API call failed',
  'editor.session_started': 'Designer opened',
  'editor.session_ended': 'Designer closed',
  'editor.waypoint_added': 'Waypoint added',
  'editor.waypoint_moved': 'Waypoint moved',
  'editor.waypoint_deleted': 'Waypoint deleted',
  'editor.waypoint_selected': 'Waypoint selected',
  'editor.road_added': 'Road added',
  'editor.road_deleted': 'Road deleted',
  'editor.start_set': 'Start placed',
  'editor.finish_set': 'Finish placed',
  'editor.action_cancelled': 'Action cancelled',
  'editor.tool_selected': 'Tool picked',
  'editor.tab_opened': 'Editor tab opened',
  'editor.challenge_edited': 'Challenge edited',
  'editor.powerup_edited': 'Power-up edited',
  'editor.confirm_shown': 'Confirmation shown',
  'editor.confirm_resolved': 'Confirmation answered',
  'editor.import_attempted': 'Map imported',
  'editor.export_performed': 'Map exported',
  'board.saved': 'Map saved',
  'board.forked': 'Map forked',
  'board.listed': 'Gallery visibility changed',
  'board.published': 'Map published',
  'board.share_copied': 'Share link copied',
  'board.validation_issue': 'Validation problem hit',
  'board.race_launched': 'Race launched',
  'deck.editor_opened': 'Deck workshop opened',
  'deck.card_added': 'Deck card added',
  'deck.card_removed': 'Deck card removed'
};

/** Property breakdowns worth promoting above the raw event table. */
const HEADLINE_BREAKDOWNS = [
  { name: 'app.surface_opened', prop: 'surface', title: 'Where people land' },
  { name: 'app.surface_opened', prop: 'viewport', title: 'What they browse on' },
  { name: 'editor.session_ended', prop: 'duration', title: 'How long a design session lasts' },
  { name: 'board.race_launched', prop: 'mode', title: 'Race modes chosen' }
];

const eventLabel = (name: string): string => EVENT_LABELS[name] ?? name;

/** Finds one breakdown by event name and property. */
function findBreakdown(
  breakdowns: AnalyticsBreakdown[],
  name: string,
  prop: string
): AnalyticsBreakdown | null {
  return breakdowns.find((b) => b.name === name && b.prop === prop) ?? null;
}

interface BreakdownBarsProps {
  title: string;
  breakdown: AnalyticsBreakdown;
}

/** Horizontal share bars for one property's values. */
const BreakdownBars: React.FC<BreakdownBarsProps> = ({ title, breakdown }) => {
  const total = breakdown.values.reduce((sum, v) => sum + v.count, 0);
  if (total === 0) return null;

  return (
    <Card className="card--pad usage-breakdown">
      <p className="t-label fs-label usage-breakdown__title">{title}</p>
      <ul className="usage-breakdown__list">
        {breakdown.values.map((v) => {
          const share = Math.round((v.count / total) * 100);
          return (
            <li key={v.value} className="usage-breakdown__row">
              <span className="usage-breakdown__name fs-4">{v.value}</span>
              <span className="usage-breakdown__track" aria-hidden="true">
                <span className="usage-breakdown__fill" style={{ width: `${share}%` }} />
              </span>
              <span className="t-data fs-2 usage-breakdown__count">
                {v.count} · {share}%
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

/** Daily visit column chart, one column per day in the window. */
const DailyChart: React.FC<{ overview: AnalyticsOverview }> = ({ overview }) => {
  const peak = overview.daily.reduce((max, d) => Math.max(max, d.sessions), 0);
  if (peak === 0) return null;

  return (
    <Card className="card--pad usage-chart">
      <p className="t-label fs-label usage-chart__title">Visits per day</p>
      <div className="usage-chart__plot">
        {overview.daily.map((day) => (
          <span
            key={day.day}
            className="usage-chart__col"
            title={`${day.day}: ${day.sessions} visits, ${day.events} events`}
          >
            <span
              className="usage-chart__bar"
              style={{ height: `${Math.max((day.sessions / peak) * 100, day.sessions > 0 ? 4 : 0)}%` }}
            />
          </span>
        ))}
      </div>
      <div className="t-data fs-2 usage-chart__axis">
        <span>{overview.daily[0]?.day}</span>
        <span>peak {peak}</span>
        <span>{overview.daily[overview.daily.length - 1]?.day}</span>
      </div>
    </Card>
  );
};

/** Usage analytics dashboard, reading the aggregates the server folds. */
export const UsagePanel: React.FC = () => {
  const [windowDays, setWindowDays] = useState<string>('30');
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getAnalyticsOverview(Number(windowDays)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage analytics');
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const busiest = overview
    ? overview.daily.reduce(
        (best, day) => (day.sessions > best.sessions ? day : best),
        { day: '—', sessions: 0, events: 0 }
      )
    : null;

  return (
    <div>
      <div className="admin-section-bar">
        <div>
          <p className="t-label fs-label">USAGE</p>
          <h2 className="t-announce fs-8 admin-text-muted">Who is here and what they do</h2>
        </div>
        <Button variant="secondary" onClick={() => void fetchOverview()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="admin-tabs-center">
        <Tabs items={WINDOWS} active={windowDays} onChange={(id) => setWindowDays(id)} />
      </div>

      {error && <Notice kind="stop">{error}</Notice>}

      {overview && !overview.enabled && (
        <Notice kind="warn">
          This server is not recording usage events right now. Anything below is what was
          collected while recording was on.
        </Notice>
      )}

      {overview && overview.totals.events === 0 && !loading ? (
        <Empty
          icon="📈"
          title="Nothing recorded yet"
          description="No usage events landed in this window. Events arrive in batches once people browse the site, so give it a little time after enabling recording."
        />
      ) : null}

      {overview && overview.totals.events > 0 && (
        <>
          <div className="usage-stats">
            <Stat
              label="Visits"
              value={overview.totals.sessions.toLocaleString()}
              hint={`since ${overview.since}`}
              tone="hot"
            />
            <Stat
              label="Events"
              value={overview.totals.events.toLocaleString()}
              hint={`${overview.totals.active_days} of ${overview.days} days active`}
            />
            <Stat
              label="Busiest day"
              value={busiest?.day ?? '—'}
              hint={`${busiest?.sessions ?? 0} visits`}
              tone="warm"
            />
          </div>

          <DailyChart overview={overview} />

          <div className="usage-breakdowns">
            {HEADLINE_BREAKDOWNS.map(({ name, prop, title }) => {
              const breakdown = findBreakdown(overview.breakdowns, name, prop);
              return breakdown ? (
                <BreakdownBars key={`${name}.${prop}`} title={title} breakdown={breakdown} />
              ) : null;
            })}
          </div>

          <Card className="card--pad usage-events">
            <p className="t-label fs-label usage-breakdown__title">Every recorded action</p>
            <table className="usage-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Times</th>
                  <th scope="col">Visits</th>
                </tr>
              </thead>
              <tbody>
                {overview.events.map((event) => (
                  <tr key={event.name}>
                    <td>
                      <span className="fs-4">{eventLabel(event.name)}</span>
                      <span className="t-data fs-2 usage-table__raw">{event.name}</span>
                    </td>
                    <td className="t-data fs-3">{event.events.toLocaleString()}</td>
                    <td className="t-data fs-3">{event.sessions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <p className="fs-3 usage-footnote">
            A visit is one page load, not one person: the same person returning tomorrow counts
            twice, and nothing here follows anyone between visits. Events older than 90 days are
            deleted.
          </p>
        </>
      )}
    </div>
  );
};
