import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMyRaces, forgetRace, racePathFor, refreshRaceStatuses, type RaceRecord } from '../../core/game/raceSession';
import { getGame } from '../../core/api/client';
import { MyRacesGrid } from '../landing/components/MyRacesGrid';
import { StartRaceOptions } from './components/StartRaceOptions';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { Button, BrandLines } from '@ds';

export const MyRacesPage: React.FC = () => {
  const navigate = useNavigate();
  const [races, setRaces] = useState<RaceRecord[]>([]);
  // A device holding a dozen races pushes the two launchers below the fold, so
  // the header keeps a one-click way down to them.
  const startRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Paint from cache first — this list has to be instant and work offline.
    setRaces(listMyRaces());
    // Then confirm with the server: a race can end while this device is looking
    // elsewhere, and a stale LIVE badge here is a lie about where to go next.
    let cancelled = false;
    refreshRaceStatuses(getGame)
      .then((changed) => {
        if (changed && !cancelled) setRaces(listMyRaces());
      })
      .catch(() => {
        // Offline: the cached list is still the best answer available.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRemove = (gameId: string) => {
    forgetRace(gameId);
    setRaces(listMyRaces());
  };

  const handleResume = (gameId: string) => {
    const race = races.find((r) => r.gameId === gameId);
    navigate(racePathFor(gameId, race?.status ?? 'draft'));
  };

  const hasRaces = races.length > 0;

  const startOptions = (
    <StartRaceOptions
      onHostTeamRace={() => navigate('/host')}
      onStartSoloRun={() => navigate('/solo')}
    />
  );

  return (
    <PageShell
      navPlacement="topbar"
      topBarProps={{
        title: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <BrandLines size={24} />
            <span className="t-announce fs-7" style={{ letterSpacing: '0.04em', color: 'var(--ink-strong)' }}>
              RUNWAY
            </span>
          </div>
        ),
      }}
    >
      {/* Saved races — the reason someone comes back to this URL, so it stays at
          the top whenever there is anything to show. A device that has never
          raced skips straight to the two launchers instead: an empty state and a
          "start a race" section stacked together say the same thing twice. */}
      {hasRaces && (
        <section style={{ maxWidth: 'var(--wrap-content)', margin: '0 auto var(--sp-7)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
            <div>
              <p className="t-label fs-label" style={{ marginBottom: 'var(--sp-1)' }}>
                SAVED ON THIS DEVICE
              </p>
              <h1 className="t-announce fs-d-md" style={{ color: 'var(--ink-strong)' }}>
                MY RACES
              </h1>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Start a new race
            </Button>
          </div>

          <MyRacesGrid races={races} onResume={handleResume} onRemove={handleRemove} />
        </section>
      )}

      {/* The journey out of this page. Two paths, each stating what the next
          three screens will ask for, because the difference between them is a
          rules difference — a lobby and other teams, or a clock and nobody —
          not a preference. */}
      <section ref={startRef} style={{ maxWidth: 'var(--wrap-content)', margin: '0 auto var(--sp-7)' }}>
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <h1 className="t-announce fs-d-md" style={{ color: 'var(--ink-strong)' }}>
            START A RACE
          </h1>
        </div>

        {startOptions}

        {/* The third way into a race is somebody else's code, and the field that
            takes one lives on the home screen. Quiet, but named — a player who
            closed the tab should not have to guess where it went. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-3)',
            flexWrap: 'wrap',
            marginTop: 'var(--sp-5)',
          }}
        >
          <span className="fs-5" style={{ color: 'var(--ink-muted)' }}>
            Someone already sent you a race code or an invite link?
          </span>
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            Join a race
          </Button>
        </div>
      </section>

      <PageFooter />
    </PageShell>
  );
};

export default MyRacesPage;
