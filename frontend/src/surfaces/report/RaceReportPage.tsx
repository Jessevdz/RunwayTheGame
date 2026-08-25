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
import { formatClock, formatDurationWords } from '../../core/format/clock';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { Badge, Board, Button, Card, Dialog, Empty, Flap, Notice, Select, Stat, BrandLines, IconCoin, type BoardColumn } from '@ds';
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
          ? 'Your photo is gone, along with your last known position.'
          : `Your ${res.photos_deleted} photos are gone, along with your last known position.`
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

  if (!gameId) {
    return (
      <PageShell navPlacement="topbar" topBarProps={{ title: <ReportBrand /> }}>
        <Empty
          icon="🧭"
          title="No race to report on"
          description="This link is missing its race id. Find the race in My Races."
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
      <PageShell navPlacement="topbar" topBarProps={{ title: <ReportBrand /> }}>
        <Empty
          icon="🔑"
          title="This device wasn't in that race"
          description="A report is only readable by the people who raced it, so it opens on the phone that played or hosted. On a new device, rejoin your team with the race code and your team code — the report comes with it."
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
      topBarProps={{ title: <ReportBrand /> }}
      loading={loading && !report}
      error={report ? null : error}
      onRetry={fetchReport}
    >
      {report && (
        <div className="race-report">
          <header className="race-report__head">
            <div>
              <h1 className="t-announce fs-d-md" style={{ color: 'var(--ink-strong)' }}>
                {report.board_name || 'UNTITLED RACE'}
              </h1>
              <p className="fs-4" style={{ color: 'var(--ink-muted)', margin: 'var(--sp-2) 0 0' }}>
                {describeResult(report)}
              </p>
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

          <RetentionLine report={report} />

          <section className="race-report__section">
            <h2 className="t-announce fs-6 race-report__section-title">THE RACE IN NUMBERS</h2>
            <StatGrid report={report} />
          </section>

          {report.standings.length > 1 && (
            <section className="race-report__section">
              <h2 className="t-announce fs-6 race-report__section-title">FINAL STANDINGS</h2>
              <Card className="card--pad">
                <StandingsBoard report={report} />
              </Card>
            </section>
          )}

          <section className="race-report__section">
            <h2 className="t-announce fs-6 race-report__section-title">THE EVIDENCE</h2>
            <p className="fs-4" style={{ color: 'var(--ink-muted)', margin: 0, maxWidth: '68ch' }}>
              {EVIDENCE_BLURB[report.verification]} Every photo anyone in this race submitted is here, with what
              it was taken for and what decided it. If something looks wrong, this is what you argue with.
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
                icon="📷"
                title="No photos were taken"
                description="Nobody submitted evidence in this race, so there is nothing to look back at."
              />
            ) : visible.length === 0 ? (
              <Empty
                icon="🔍"
                title="Nothing matches"
                description="No photo in this race fits that team and verdict."
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
              ? 'Every photo, every position, the whole log, the standings and the teams — for all the teams, not just yours. It happens now and it cannot be undone.'
              : 'Your photos and your last known position, deleted now. The verdicts and the race log stay: they are the result everyone else played for, and they hold no picture of you.'}
          </p>
          {confirming === 'all' && report?.mode === 'solo_time_trial' && (
            <Notice kind="warn" title="Your leaderboard time goes too">
              A posted time belongs to the run behind it, so deleting the run takes the entry off the board.
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

const ReportBrand: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
    <BrandLines size={24} />
    <span className="t-announce fs-7" style={{ letterSpacing: '0.04em', color: 'var(--ink-strong)' }}>
      RUNWAY
    </span>
  </div>
);

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
  llm: 'A model graded these, and a model can be wrong.',
  host: 'A person graded these, one photo at a time.',
  trust: 'Nothing checked these — the honour system was the referee.',
};

const VERDICT: Record<string, { tone: 'moss' | 'crimson' | 'neutral'; label: string }> = {
  pass: { tone: 'moss', label: 'Approved' },
  fail: { tone: 'crimson', label: 'Rejected' },
  pending: { tone: 'neutral', label: 'Never graded' },
};

/** "1st", "2nd", "3rd" — teens excepted (11th, not 11st). */
const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

const isSolo = (mode: string) => mode === 'solo_time_trial' || mode === 'solo_casual';

/** The one-line answer to "how did it go", in the vocabulary of the mode. */
function describeResult(report: RaceReport): string {
  const when = report.ended_at ? new Date(report.ended_at).toLocaleString() : new Date(report.created_at).toLocaleString();
  if (report.status !== 'ended') {
    return `Still open · started ${when}`;
  }
  if (isSolo(report.mode)) {
    const elapsed = report.clock.finished_at && report.clock.started_at
      ? Math.max(0, Math.round((Date.parse(report.clock.finished_at) - Date.parse(report.clock.started_at)) / 1000)) +
      report.clock.time_penalty_seconds
      : report.stats.duration_seconds;
    return `${formatClock(elapsed)} · ${when}`;
  }
  return report.winner_name ? `${report.winner_name} won · ${when}` : `No winner recorded · ${when}`;
}

/** How long this race has left, and what that means. */
const RetentionLine: React.FC<{ report: RaceReport }> = ({ report }) => {
  const expires = new Date(report.retention.expires_at);
  const daysLeft = Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86_400_000));

  return (
    <Notice
      kind={daysLeft <= 3 ? 'warn' : 'info'}
      title={daysLeft === 0 ? 'This report expires today' : `This report is deleted in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}
    >
    </Notice>
  );
};

const StatGrid: React.FC<{ report: RaceReport }> = ({ report }) => {
  const s = report.stats;
  const solo = isSolo(report.mode);

  return (
    <div className="race-report__stats">
      <Stat label="Photos taken" value={s.submissions} tone="bright" hint={s.photos_deleted > 0 ? `${s.photos_deleted} since deleted` : undefined} />
      <Stat label="Approved" value={s.passed} />
      <Stat label="Rejected" value={s.failed} />
      {s.pending > 0 && <Stat label="Never graded" value={s.pending} hint="the race ended first" />}
      <Stat label="Waypoints" value={s.waypoints_reached} />
      <Stat label="Skipped" value={s.vetoes} hint={solo && report.clock.time_penalty_seconds > 0 ? `+${formatDurationWords(report.clock.time_penalty_seconds)}` : undefined} />
      <Stat label="Coins earned" value={<><IconCoin /> {s.coins_earned}</>} />
      <Stat label="Coins spent" value={<><IconCoin /> {s.coins_spent}</>} />
      {s.finish_bonuses > 0 && <Stat label="Paid at the line" value={<><IconCoin /> {s.finish_bonuses}</>} />}
      {s.powerups_used > 0 && <Stat label="Powerups used" value={s.powerups_used} hint={`${s.powerups_bought} bought`} />}
      {s.roadblocks_placed > 0 && <Stat label="Roadblocks" value={s.roadblocks_placed} />}
      {s.curses_played > 0 && <Stat label="Curses" value={s.curses_played} />}
      {!solo && (
        <Stat
          label="Disputes"
          value={s.disputes}
          hint={s.disputes > 0 ? `${s.disputes_overturned} overturned` : undefined}
        />
      )}
      {s.gm_overrides > 0 && <Stat label="Host overrides" value={s.gm_overrides} />}
      {/* Flagged arrivals are recorded and never decisive, so they are stated
          quietly rather than as an accusation — but stated, because a race
          settled by argument should not hide the one signal that fired. */}
      {s.flagged_arrivals > 0 && (
        <Stat label="Odd arrivals" value={s.flagged_arrivals} hint="flagged, not judged" />
      )}
      <Stat label="On the route" value={formatClock(s.duration_seconds)} />
    </div>
  );
};

interface StandingRowView {
  teamId: string;
  teamName: string;
  waypoints: number;
  coins: number;
  finishRank: number;
  finishBonus: number;
}

const StandingsBoard: React.FC<{ report: RaceReport }> = ({ report }) => {
  const coinRush = report.mode === 'coin_rush';

  const columns: BoardColumn<StandingRowView>[] = [
    {
      key: 'team',
      header: 'Team',
      who: true,
      render: (row) => {
        const info = report.teams[row.teamId];
        const color = info ? slotColor(info.slot_index).color : getNeutralColor().color;
        return (
          <>
            <span className="race-report__dot" style={{ backgroundColor: color }} />
            <span>{row.teamName}</span>
          </>
        );
      },
    },
    // Coins lead in a coin rush, because that column is the result.
    ...(coinRush
      ? [
        { key: 'coins', header: 'Coins', numeric: true, render: (row: StandingRowView) => <><IconCoin /> {row.coins}</> } as BoardColumn<StandingRowView>,
        {
          key: 'placed',
          header: 'Finish',
          numeric: true,
          render: (row: StandingRowView) => <>{row.finishRank ? `${ordinal(row.finishRank)} · +${row.finishBonus}` : 'DNF'}</>,
        } as BoardColumn<StandingRowView>,
      ]
      : []),
    { key: 'waypoints', header: 'Waypoints', numeric: true, render: (row) => <>{row.waypoints}</> },
    ...(coinRush
      ? []
      : [{ key: 'coins', header: 'Coins', numeric: true, render: (row: StandingRowView) => <><IconCoin /> {row.coins}</> } as BoardColumn<StandingRowView>]),
    {
      key: 'photos',
      header: 'Photos',
      numeric: true,
      render: (row) => <>{report.evidence.filter((e) => e.team_id === row.teamId).length}</>,
    },
  ];

  const rows: StandingRowView[] = report.standings.map((s) => ({
    teamId: s.team_id,
    teamName: s.team_name,
    waypoints: s.waypoints_reached,
    coins: s.coins,
    finishRank: s.finish_rank ?? 0,
    finishBonus: s.finish_bonus ?? 0,
  }));

  return (
    <div className="race-report__board">
      <Board columns={columns} rows={rows} rowKey={(row) => row.teamId} isLeader={(_, i) => i === 0} />
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
          {item.photo_deleted_at ? 'This photo has been deleted.' : 'This photo could not be loaded.'}
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
        {item.kind === 'roadblock' ? 'Roadblock' : item.waypoint_name || 'Waypoint'}
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
    <Dialog open title={item.waypoint_name || (item.kind === 'roadblock' ? 'Roadblock' : 'Waypoint')} onClose={onClose}>
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
          <Button variant="secondary" icon="🗑️" onClick={() => onConfirm('all')}>
            Delete this race data now.
          </Button>
        )}
        {canDeleteMine && (
          <Button variant="secondary" icon="🗑️" onClick={() => onConfirm('mine')}>
            Delete my photos
          </Button>
        )}
      </div>
    </section>
  );
};

export default RaceReportPage;
