import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getRaceReport,
  deleteRace,
  deleteMyEvidence,
  type RaceReport,
  type ReportEvidence,
} from '../../core/api/client';
import { loadHostSession } from '../../core/game/hostSession';
import { loadTeamSession } from '../../core/game/teamSession';
import { forgetRace } from '../../core/game/raceSession';
import { slotColor, getNeutralColor } from '../../core/team/palette';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { Badge, Board, Button, Card, Dialog, Empty, Flap, Notice, Select, Stat, Icon, type BoardColumn } from '@ds';
import { ResultHero } from './ResultHero';
import {
  buildStatTiles,
  computeRaceResult,
  ordinal,
  retentionNotice,
  type RankedStanding,
  type RaceResult,
  type StatTile,
} from './raceResult';
import './race-report.css';

/** Post-race summary report page displaying completed race evidence and stats. */
export const RaceReportPage: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();

  const hostSession = useMemo(() => (gameId ? loadHostSession(gameId) : null), [gameId]);
  const teamSession = useMemo(() => (gameId ? loadTeamSession(gameId) : null), [gameId]);
  // Use host token if available, otherwise fall back to team token.
  const token = hostSession?.hostToken || teamSession?.teamToken || '';

  const [report, setReport] = useState<RaceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [teamFilter, setTeamFilter] = useState('all');
  const [verdictFilter, setVerdictFilter] = useState('all');
  const [lightbox, setLightbox] = useState<ReportEvidence | null>(null);

  const [confirming, setConfirming] = useState<'all' | 'mine' | null>(null);
  const [erasing, setErasing] = useState(false);
  const [erased, setErased] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    if (!gameId || !token) return;
    setLoading(true);
    try {
      setReport(await getRaceReport(gameId, token));
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'That report could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [gameId, token]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const handleDeleteAll = async () => {
    if (!gameId || !hostSession) return;
    setErasing(true);
    try {
      await deleteRace(gameId, hostSession.hostToken);
      // The keys to a race that no longer exists are dead weight, and leaving
      // them in local storage would keep it on My Races as a row that 404s.
      forgetRace(gameId);
      navigate('/races', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Nothing was deleted. Try again.');
      setConfirming(null);
    } finally {
      setErasing(false);
    }
  };

  const handleDeleteMine = async () => {
    if (!gameId || !teamSession) return;
    setErasing(true);
    try {
      const res = await deleteMyEvidence(gameId, teamSession.teamToken);
      setErased(
        res.photos_deleted === 1
          ? 'Photo and last known position deleted.'
          : `${res.photos_deleted} photos and last known position deleted.`
      );
      setConfirming(null);
      await fetchReport();
    } catch (err: any) {
      setError(err?.message || 'Your photos were not deleted. Try again.');
      setConfirming(null);
    } finally {
      setErasing(false);
    }
  };

  const visible = useMemo(() => {
    if (!report) return [];
    return report.evidence.filter(
      (e) =>
        (teamFilter === 'all' || e.team_id === teamFilter) &&
        (verdictFilter === 'all' || e.status === verdictFilter)
    );
  }, [report, teamFilter, verdictFilter]);

  const result = useMemo(() => (report ? computeRaceResult(report) : null), [report]);
  const tiles = useMemo(() => (report ? buildStatTiles(report) : null), [report]);
  const retention = useMemo(() => (report ? retentionNotice(report, Date.now()) : null), [report]);

  if (!gameId) {
    return (
      <PageShell navPlacement="topbar" topBarProps={{}}>
        <Empty
          icon={<Icon name="compass" />}
          title="No race to report on"
          description="This link is incomplete. Try My Races."
          action={
            <Button variant="primary" onClick={() => navigate('/races')}>
              My Races
            </Button>
          }
        />
      </PageShell>
    );
  }

  // No capability on this device. Not an error — it is the ordinary state of a
  // link opened somewhere else, and it has a real answer.
  if (!token) {
    return (
      <PageShell navPlacement="topbar" topBarProps={{}}>
        <Empty
          icon={<Icon name="key" />}
          title="This device wasn't in that race"
          description="Reports open only on the device that played or hosted. On a new device, rejoin your team with the race code and team code."
          action={
            <Button variant="primary" onClick={() => navigate('/')}>
              Join with a code
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      navPlacement="topbar"
      topBarProps={{}}
      loading={loading && !report}
      error={report ? null : error}
      onRetry={fetchReport}
    >
      {report && result && tiles && (
        <div className="race-report">
          <header className="race-report__head">
            <div className="race-report__head-lead">
              <h1 className="t-announce fs-9 race-report__title">{report.board_name || 'UNTITLED RACE'}</h1>
              <p className="fs-4 race-report__when">{describeWhen(report)}</p>
            </div>
            <div className="race-report__badges">
              {report.race_code && <Flap value={report.race_code} />}
              <Badge tone="neutral">{MODE_LABEL[report.mode] ?? 'RACE'}</Badge>
              <Badge tone={report.verification === 'trust' ? 'rust' : 'gold'}>
                {GRADING_LABEL[report.verification]}
              </Badge>
            </div>
          </header>

          {/* Errors from an action, once the report itself is on screen. A failed
              deletion must not replace the page it was pressed on. */}
          {error && (
            <Notice kind="stop" title="That didn't go through">
              {error}
            </Notice>
          )}
          {erased && (
            <Notice kind="info" title="Deleted">
              {erased}
            </Notice>
          )}

          <ResultHero report={report} result={result} />

          {retention && (
            <Notice kind={retention.kind} title={retention.title}>
              {' '}
              {retention.body}
            </Notice>
          )}

          {result.ranked.length > 1 && (
            <section className="race-report__section">
              <h2 className="t-announce fs-6 race-report__section-title">FINAL STANDINGS</h2>
              <Card className="card--pad">
                <StandingsBoard report={report} result={result} />
              </Card>
            </section>
          )}

          <section className="race-report__section">
            <h2 className="t-announce fs-6 race-report__section-title">THE RACE IN NUMBERS</h2>
            <StatGrid tiles={tiles} />
          </section>

          <section className="race-report__section">
            <h2 className="t-announce fs-6 race-report__section-title">THE EVIDENCE</h2>
            <p className="fs-4" style={{ color: 'var(--ink-muted)', margin: 0, maxWidth: '68ch' }}>
              {EVIDENCE_BLURB[report.verification]}
            </p>

            {report.evidence.length > 0 && (
              <div className="race-report__filters">
                <Select label="Team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                  <option value="all">Everyone</option>
                  {Object.entries(report.teams).map(([id, info]) => (
                    <option key={id} value={id}>
                      {info.name}
                    </option>
                  ))}
                </Select>
                <Select label="Verdict" value={verdictFilter} onChange={(e) => setVerdictFilter(e.target.value)}>
                  <option value="all">Any verdict</option>
                  <option value="pass">Approved</option>
                  <option value="fail">Rejected</option>
                  <option value="pending">Never graded</option>
                </Select>
                <span className="race-report__filter-count">
                  {visible.length} OF {report.evidence.length}
                </span>
              </div>
            )}

            {report.evidence.length === 0 ? (
              <Empty
                icon={<Icon name="camera" />}
                title="No photos were taken"
              />
            ) : visible.length === 0 ? (
              <Empty
                icon={<Icon name="search" />}
                title="Nothing matches"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setTeamFilter('all');
                      setVerdictFilter('all');
                    }}
                  >
                    Show everything
                  </Button>
                }
              />
            ) : (
              <div className="race-report__wall">
                {visible.map((item) => (
                  <EvidenceCard key={item.submission_id} item={item} report={report} onOpen={setLightbox} />
                ))}
              </div>
            )}
          </section>

          {report.timeline.length > 0 && (
            <section className="race-report__section">
              <h2 className="t-announce fs-6 race-report__section-title">WHAT HAPPENED</h2>
              <Card className="card--pad">
                <ul className="race-report__timeline">
                  {report.timeline.map((line, i) => (
                    <li key={i} className="t-data fs-4">
                      {line}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          <EraseSection
            canDeleteAll={!!hostSession}
            canDeleteMine={!hostSession && !!teamSession}
            onConfirm={setConfirming}
          />

          <PageFooter />
        </div>
      )}

      {lightbox && <Lightbox item={lightbox} report={report} onClose={() => setLightbox(null)} />}

      {confirming && (
        <Dialog
          open
          title={confirming === 'all' ? 'Delete this race?' : 'Delete your photos?'}
          onClose={() => (erasing ? undefined : setConfirming(null))}
        >
          <p className="fs-5" style={{ marginTop: 0 }}>
            {confirming === 'all'
              ? 'Every photo, position, log entry and standing, for all teams. This cannot be undone.'
              : 'Your photos and last known position are deleted now. Verdicts and the race log stay.'}
          </p>
          {confirming === 'all' && report?.mode === 'solo_time_trial' && (
            <Notice kind="warn" title="Your leaderboard time goes too">
              The run's leaderboard entry is removed.
            </Notice>
          )}
          <div className="race-report__erase-actions" style={{ marginTop: 'var(--sp-4)' }}>
            <Button
              variant="primary"
              disabled={erasing}
              onClick={() => void (confirming === 'all' ? handleDeleteAll() : handleDeleteMine())}
            >
              {erasing ? 'Deleting…' : confirming === 'all' ? 'Delete everything' : 'Delete my photos'}
            </Button>
            <Button variant="ghost" disabled={erasing} onClick={() => setConfirming(null)}>
              Keep it
            </Button>
          </div>
        </Dialog>
      )}
    </PageShell>
  );
};

const MODE_LABEL: Record<string, string> = {
  team: 'TEAM RACE',
  coin_rush: 'COIN RUSH',
  solo_time_trial: 'TIME TRIAL',
  solo_casual: 'CASUAL RUN',
};

const GRADING_LABEL: Record<string, string> = {
  llm: 'AI REFEREE',
  host: 'HOST GRADED',
  trust: 'HONOUR SYSTEM',
};

const EVIDENCE_BLURB: Record<string, string> = {
  llm: 'Graded by AI, which can be wrong.',
  host: 'Graded by the host.',
  trust: 'Nothing was checked.',
};

const VERDICT: Record<string, { tone: 'moss' | 'crimson' | 'neutral'; label: string }> = {
  pass: { tone: 'moss', label: 'Approved' },
  fail: { tone: 'crimson', label: 'Rejected' },
  pending: { tone: 'neutral', label: 'Never graded' },
};

/** The date line under the title, the result itself is the hero's job. */
function describeWhen(report: RaceReport): string {
  const ended = report.ended_at ? new Date(report.ended_at).toLocaleString() : null;
  if (report.status !== 'ended') return `Still open · started ${new Date(report.started_at ?? report.created_at).toLocaleString()}`;
  return ended ?? new Date(report.created_at).toLocaleString();
}

/** Four tiles that matter, with the remainder behind an expander. */
const StatGrid: React.FC<{ tiles: { key: StatTile[]; more: StatTile[] } }> = ({ tiles }) => (
  <>
    <div className="race-report__stats">
      {tiles.key.map((t) => (
        <StatTileView key={t.id} tile={t} />
      ))}
    </div>
    {tiles.more.length > 0 && (
      <details className="race-report__more">
        <summary className="race-report__more-toggle">
          <span className="race-report__more-open">More stats</span>
          <span className="race-report__more-close">Fewer stats</span>
        </summary>
        <div className="race-report__stats">
          {tiles.more.map((t) => (
            <StatTileView key={t.id} tile={t} />
          ))}
        </div>
      </details>
    )}
  </>
);

const StatTileView: React.FC<{ tile: StatTile }> = ({ tile }) => (
  <Stat
    label={tile.label}
    value={tile.coin ? <><Icon name="coin" /> {tile.value}</> : tile.value}
    hint={tile.hint}
    tone={tile.tone}
  />
);

const StandingsBoard: React.FC<{ report: RaceReport; result: RaceResult }> = ({ report, result }) => {
  const coinRush = report.mode === 'coin_rush';

  const coinsColumn: BoardColumn<RankedStanding> = {
    key: 'coins',
    header: 'Coins',
    numeric: true,
    render: (row) =>
      row.coinsVisible ? <><Icon name="coin" /> {row.coins}</> : <span aria-label="Coin balance hidden">Hidden</span>,
  };

  const columns: BoardColumn<RankedStanding>[] = [
    {
      key: 'team',
      header: 'Team',
      who: true,
      render: (row) => {
        const info = report.teams[row.teamId];
        const color = info ? slotColor(info.slot_index).color : getNeutralColor().color;
        return (
          <>
            <span className="t-data race-report__place">{ordinal(row.place)}</span>
            <span className="race-report__dot" style={{ backgroundColor: color }} />
            <span className="race-report__team-name">{row.teamName}</span>
          </>
        );
      },
    },
    // Coins lead in a coin rush, because that column is the result.
    ...(coinRush
      ? [
        coinsColumn,
        {
          key: 'placed',
          header: 'Finish',
          numeric: true,
          render: (row: RankedStanding) => <>{row.finishRank ? `${ordinal(row.finishRank)} · +${row.finishBonus}` : 'DNF'}</>,
        } as BoardColumn<RankedStanding>,
      ]
      : []),
    { key: 'waypoints', header: 'Waypoints', numeric: true, render: (row) => <>{row.waypoints}</> },
    ...(coinRush ? [] : [coinsColumn]),
    {
      key: 'photos',
      header: 'Photos',
      numeric: true,
      render: (row) => <>{report.evidence.filter((e) => e.team_id === row.teamId).length}</>,
    },
  ];

  return (
    <div className="race-report__board" role="region" aria-label="Final standings">
      <Board columns={columns} rows={result.ranked} rowKey={(row) => row.teamId} isLeader={(row) => row.place === 1} />
    </div>
  );
};

const EvidenceCard: React.FC<{
  item: ReportEvidence;
  report: RaceReport;
  onOpen: (item: ReportEvidence) => void;
}> = ({ item, report, onOpen }) => {
  const info = report.teams[item.team_id];
  const color = info ? slotColor(info.slot_index).color : getNeutralColor().color;
  const verdict = VERDICT[item.status] ?? VERDICT.pending;

  return (
    <Card className="race-report__shot">
      {item.photo_url ? (
        <button type="button" className="race-report__frame" onClick={() => onOpen(item)}>
          <img src={item.photo_url} alt={`Evidence from ${item.team_name}`} loading="lazy" />
        </button>
      ) : (
        <div className="race-report__frame race-report__frame--empty">
          {item.photo_deleted_at ? 'This photo has been deleted.' : 'Photo failed to load.'}
        </div>
      )}

      <div className="race-report__shot-head">
        <span className="race-report__dot" style={{ backgroundColor: color }} />
        <span className="fs-4" style={{ fontWeight: 600 }}>
          {item.team_name || 'Unknown team'}
        </span>
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        {item.disputed && <Badge tone="rust">Disputed</Badge>}
      </div>

      <p className="race-report__shot-where">
        {item.kind === 'roadblock'
          ? 'Roadblock'
          : item.road_name || item.waypoint_name || 'Waypoint'}
      </p>

      <div className="race-report__meta">
        <span>{new Date(item.submitted_at).toLocaleString()}</span>
        {item.accuracy_m !== undefined && <span>±{Math.round(item.accuracy_m)}M</span>}
      </div>
    </Card>
  );
};

const Lightbox: React.FC<{ item: ReportEvidence; report: RaceReport | null; onClose: () => void }> = ({
  item,
  report,
  onClose,
}) => {
  const verdict = VERDICT[item.status] ?? VERDICT.pending;

  return (
    <Dialog
      open
      title={item.kind === 'roadblock' ? 'Roadblock' : item.road_name || item.waypoint_name || 'Waypoint'}
      onClose={onClose}
    >
      <div className="race-report__lightbox">
        {item.photo_url && <img src={item.photo_url} alt={`Evidence from ${item.team_name}`} />}
        <dl>
          <dt>Team</dt>
          <dd>{item.team_name || item.team_id}</dd>
          <dt>Verdict</dt>
          <dd>
            {verdict.label}
            {item.source && ` · ${GRADING_LABEL[item.source]?.toLowerCase() ?? item.source}`}
            {item.confidence ? ` · ${Math.round(item.confidence * 100)}% confident` : ''}
          </dd>
          {item.prompt && (
            <>
              <dt>The challenge</dt>
              <dd>{item.prompt}</dd>
            </>
          )}
          {item.rationale && (
            <>
              <dt>Reason</dt>
              <dd>{item.rationale}</dd>
            </>
          )}
          {item.disputed && (
            <>
              <dt>Dispute</dt>
              <dd>{item.dispute_status === 'overturned' ? 'Raised and overturned' : item.dispute_status === 'upheld' ? 'Raised and upheld' : 'Raised, never resolved'}</dd>
            </>
          )}
          <dt>Submitted</dt>
          <dd>{new Date(item.submitted_at).toLocaleString()}</dd>
          {item.client_captured_at && (
            <>
              <dt>Shot at</dt>
              <dd>{new Date(item.client_captured_at).toLocaleString()}</dd>
            </>
          )}
          {item.lat !== undefined && item.lon !== undefined && (
            <>
              <dt>Position</dt>
              <dd>
                {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                {item.accuracy_m !== undefined && ` (±${Math.round(item.accuracy_m)}m)`}
              </dd>
            </>
          )}
          {report && (
            <>
              <dt>Race</dt>
              <dd>{report.board_name}</dd>
            </>
          )}
        </dl>
      </div>
    </Dialog>
  );
};

const EraseSection: React.FC<{
  canDeleteAll: boolean;
  canDeleteMine: boolean;
  onConfirm: (what: 'all' | 'mine') => void;
}> = ({ canDeleteAll, canDeleteMine, onConfirm }) => {
  if (!canDeleteAll && !canDeleteMine) return null;

  return (
    <section className="race-report__section race-report__erase">
      <div className="race-report__erase-actions">
        {canDeleteAll && (
          <Button variant="secondary" icon={<Icon name="trash" />} onClick={() => onConfirm('all')}>
            Delete this race now
          </Button>
        )}
        {canDeleteMine && (
          <Button variant="secondary" icon={<Icon name="trash" />} onClick={() => onConfirm('mine')}>
            Delete my photos
          </Button>
        )}
      </div>
    </section>
  );
};

export default RaceReportPage;
