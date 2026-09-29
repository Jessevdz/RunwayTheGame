import React from 'react';
import { ArcMark } from '@ds';
import type { RaceReport } from '../../core/api/client';
import { formatClock, formatDurationWords } from '../../core/format/clock';
import { slotColor, getNeutralColor } from '../../core/team/palette';
import { entryMetric, heroEyebrow, ordinal, type RaceResult, type RankedStanding } from './raceResult';

const teamColor = (report: RaceReport, teamId: string): string => {
  const info = report.teams[teamId];
  return info ? slotColor(info.slot_index).color : getNeutralColor().color;
};

/** What the hero says beneath the headline, or null when the headline says it all. */
function heroDetail(report: RaceReport, result: RaceResult): string | null {
  switch (result.kind) {
    case 'winner': {
      const lead = result.leaders[0];
      return lead ? entryMetric(report.mode, lead) : null;
    }
    case 'tie':
      return 'Level on every score, so they share the win.';
    case 'no-finishers':
      return result.leaders.length > 0
        ? `Furthest along: ${result.leaders.map((l) => l.teamName).join(' and ')}.`
        : 'Nobody made it to the finish line.';
    case 'open':
      return 'The race has not ended, so this is not final.';
    case 'empty':
      return 'No team joined this race.';
    case 'solo-finished': {
      const penalty = report.clock.time_penalty_seconds;
      return penalty > 0 ? `Includes ${formatDurationWords(penalty)} of veto penalties.` : null;
    }
    case 'solo-dnf':
      return `${formatClock(report.stats.duration_seconds)} on the route before the run ended.`;
  }
}

/** The headline of the report: who won, or how the solo run went. */
export const ResultHero: React.FC<{ report: RaceReport; result: RaceResult }> = ({ report, result }) => {
  const solo = result.kind === 'solo-finished' || result.kind === 'solo-dnf';
  const detail = heroDetail(report, result);

  const headline: React.ReactNode = (() => {
    switch (result.kind) {
      case 'solo-finished':
        return <span className="race-report__hero-time">{formatClock(result.soloSeconds ?? 0)}</span>;
      case 'solo-dnf':
        return report.board_name || 'Untitled race';
      case 'empty':
        return 'Empty start line';
      case 'no-finishers':
        return 'No winner';
      case 'open':
        return result.leaders.length > 0 ? result.leaders.map((l) => l.teamName).join(' & ') : 'Race in progress';
      default:
        return result.leaders.map((l) => (
          <span key={l.teamId} className="race-report__hero-team">
            <span
              className="race-report__dot race-report__dot--lg"
              style={{ backgroundColor: teamColor(report, l.teamId) }}
              aria-hidden="true"
            />
            {l.teamName}
          </span>
        ));
    }
  })();

  return (
    <section className={`race-report__hero race-report__hero--${result.kind}`} aria-labelledby="race-report-result">
      <ArcMark className="race-report__hero-arc" animate={false} />
      <span className="t-label fs-label race-report__hero-eyebrow">{heroEyebrow(result)}</span>
      <h2 id="race-report-result" className="t-announce fs-d-md race-report__hero-title">
        {headline}
      </h2>
      {solo && result.kind === 'solo-finished' && (
        <p className="fs-5 race-report__hero-detail">{report.board_name || 'Untitled race'}</p>
      )}
      {detail && <p className="fs-5 race-report__hero-detail">{detail}</p>}

      {result.runnersUp.length > 0 && <RunnersUp report={report} entries={result.runnersUp} />}
    </section>
  );
};

const RunnersUp: React.FC<{ report: RaceReport; entries: RankedStanding[] }> = ({ report, entries }) => (
  <ol className="race-report__podium" aria-label="Runners-up">
    {entries.map((entry) => (
      <li key={entry.teamId} className="race-report__podium-row">
        <span className="t-announce fs-6 race-report__podium-place">{ordinal(entry.place)}</span>
        <span
          className="race-report__dot"
          style={{ backgroundColor: teamColor(report, entry.teamId) }}
          aria-hidden="true"
        />
        <span className="race-report__podium-name">{entry.teamName}</span>
        <span className="t-data fs-4 race-report__podium-metric">{entryMetric(report.mode, entry)}</span>
      </li>
    ))}
  </ol>
);
