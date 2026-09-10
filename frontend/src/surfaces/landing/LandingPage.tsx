import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMyMaps, removeMyMap } from '../../core/game/mapSession';
import type { MapRecord } from '../../core/game/mapSession';
import { listMyRaces, forgetRace, lobbyPath, racePathFor, refreshRaceStatuses, type RaceRecord } from '../../core/game/raceSession';
import { getGame } from '../../core/api/client';
import { parseJoinInput, looksLikeUrl } from '../../core/game/joinTarget';
import { GITHUB_URL } from '../../core/docs';
import { resolveJoinTarget, JoinError, type ResolvedJoin } from '../../core/game/resolveJoinTarget';
import { MyMapsGrid } from './components/MyMapsGrid';
import { MyRacesGrid } from './components/MyRacesGrid';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { Button, Input, Notice, BrandLines, RouteGlobe, Badge, LinkButton, IconGithub } from '@ds';
import { useIsDesktop } from '../../core/ui/useIsDesktop';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [localMaps, setLocalMaps] = useState<MapRecord[]>([]);
  const [myRaces, setMyRaces] = useState<RaceRecord[]>([]);
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  // Resolved join confirmation state prior to navigation.
  const [pendingJoin, setPendingJoin] = useState<ResolvedJoin | null>(null);

  useEffect(() => {
    setLocalMaps(listMyMaps());
    // Cache first so the section paints instantly, then confirm each race's
    // lifecycle with the server — one can end while this device is elsewhere.
    setMyRaces(listMyRaces());
    let cancelled = false;
    refreshRaceStatuses(getGame)
      .then((changed) => {
        if (changed && !cancelled) setMyRaces(listMyRaces());
      })
      .catch(() => {
        // Offline: the cached list is still the best answer available.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleJoinInputChange = (value: string) => {
    setJoinInput(looksLikeUrl(value) ? value : value.toUpperCase());
    setJoinError(null);
    setPendingJoin(null);
  };

  const handleJoinGame = async () => {
    const target = parseJoinInput(joinInput);
    if (!target) {
      setJoinError("That doesn't look like a race code or an invite link.");
      return;
    }
    setJoinBusy(true);
    setJoinError(null);
    try {
      const resolved = await resolveJoinTarget(target);
      // An invite pinning a different backend needs a real page load — the API
      // base is read once at module scope, so a router push would keep talking to
      // the wrong server.
      if (resolved.hardNavigateTo) {
        window.location.assign(resolved.hardNavigateTo);
        return;
      }
      // A pasted link is already an explicit choice; only a typed code gets a
      // confirmation step.
      if (target.kind === 'code') {
        setPendingJoin(resolved);
      } else {
        navigate(lobbyPath(resolved.gameId));
      }
    } catch (err) {
      setJoinError(err instanceof JoinError ? err.message : 'Could not join that race. Try again.');
    } finally {
      setJoinBusy(false);
    }
  };

  const handleSelectMap = (mapId: string) => {
    navigate(`/design/${mapId}`);
  };

  const handleRemoveMap = (mapId: string) => {
    // Forgetting a map drops the edit key with it. For a private map that is
    // just tidying up; for a published one it strands the map in the gallery
    // with nobody able to take it down, so that case gets asked about first.
    const map = localMaps.find((m) => m.mapId === mapId);
    if (map?.isListed) {
      const ok = window.confirm(
        `“${map.name || 'Untitled Map'}” is published in the public gallery.\n\n` +
        'Removing it from this device drops the edit key, and it will stay in the gallery with no way to take it down. ' +
        'Open the map and remove it from the gallery first if that is what you meant.\n\nForget it on this device anyway?'
      );
      if (!ok) return;
    }
    removeMyMap(mapId);
    setLocalMaps(listMyMaps());
  };

  const handleResumeRace = (gameId: string) => {
    const race = myRaces.find((r) => r.gameId === gameId);
    navigate(racePathFor(gameId, race?.status ?? 'draft'));
  };

  const handleForgetRace = (gameId: string) => {
    forgetRace(gameId);
    setMyRaces(listMyRaces());
  };

  // A returning player with a race in progress should not have to scroll past
  // marketing to find it — surfaced above the hero, not folded into MY RACES.
  const liveRace = myRaces.find((r) => r.status === 'live' && r.role !== 'none');

  /* One field, not six boxes: a segmented code input looks the part and fights
     paste, and half the traffic here is a pasted invite link. Hoisted out of the
     hero so mobile and desktop can order it differently without duplicating it. */
  const joinBlock = (
    <div className="landing-join-block">
      <Input
        label="RACE CODE OR INVITE LINK"
        placeholder="K7RQ2M"
        value={joinInput}
        error={joinError || undefined}
        onChange={(e) => handleJoinInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && joinInput.trim() && !joinBusy) handleJoinGame();
        }}
        autoCapitalize="characters"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
      />
      <div className="landing-join-block__btn">
        <Button
          variant={isDesktop ? 'secondary' : 'primary'}
          disabled={!joinInput.trim() || joinBusy}
          onClick={handleJoinGame}
          className="landing-join-block__full-width"
        >
          {joinBusy ? 'Finding race…' : 'Find race'}
        </Button>
      </div>

      {pendingJoin && (
        <Notice kind="info" title={pendingJoin.boardName || 'Race found'} className="landing-join-block__btn">
          <span>
            {pendingJoin.teamCount ?? 0} {pendingJoin.teamCount === 1 ? 'team' : 'teams'} ·{' '}
            {pendingJoin.status === 'live' ? 'already racing' : 'waiting to start'}
          </span>
          <div className="landing-notice-btn-wrapper">
            <Button variant="primary" onClick={() => navigate(lobbyPath(pendingJoin.gameId))}>
              Join this race
            </Button>
          </div>
        </Notice>
      )}
    </div>
  );

  return (
    <PageShell
      heroBackdrop
      navPlacement="topbar"
      topBarProps={{
        title: (
          <div className="landing-brand">
            <BrandLines size={24} />
            <span className="t-announce fs-7 landing-brand__text">
              RUNWAY
            </span>
          </div>
        ),
        /* The docs link is the TopBar's own — every header carries it. */
        actions: (
          <LinkButton
            href={GITHUB_URL}
            external
            variant="ghost"
            size="sm"
            className="btn--icon"
            title="GitHub Repository"
            aria-label="GitHub Repository"
          >
            <IconGithub />
          </LinkButton>
        ),
      }}
    >
      {/* Live race — above the hero: a race in progress outranks marketing,
          and this is the one moment a returning player should not have to
          scroll to find it. */}
      {liveRace && (
        <section className="landing-live-section">
          <div className="card landing-live-card">
            <div className="landing-brand">
              <Badge tone="crimson">LIVE</Badge>
              <span className="t-announce fs-7 landing-brand__text">
                {liveRace.boardName || 'Untitled race'}
              </span>
            </div>
            <Button variant="primary" onClick={() => handleResumeRace(liveRace.gameId)}>
              Resume race
            </Button>
          </div>
        </section>
      )}

      {/* Hero Section */}
      <section className="landing-hero">
        <h1 className="landing-hero__title">
          <span className="u-visually-hidden">Runway &mdash; design and race real-world courses</span>
          <RouteGlobe />
        </h1>

        <p className="t-narrate fs-8 landing-hero__tagline">
          Create races <em className="landing-hero__em">anywhere on Earth</em>, then play them with friends.
        </p>

        {/* Mobile puts the code field first and desktop puts it last, and that is
            not a styling preference: a phone arriving here is almost always
            holding a code somebody texted them, while a desktop arriving here is
            almost always about to design or host something. Whichever comes
            second also loses the primary button — see the variants below. */}
        {!isDesktop && joinBlock}

        <div className="landing-hero__ctas">
          {isDesktop && (
            <Button variant="primary" size="lg" onClick={() => navigate('/design')}>
              Design a Map
            </Button>
          )}
          <Button
            variant={isDesktop ? 'ghost' : 'secondary'}
            size="lg"
            onClick={() => navigate('/races')}
          >
            Start a Race
          </Button>
        </div>

        {isDesktop && joinBlock}
      </section>

      {/* My Races — above My Maps: a race in progress outranks a draft map, and
          this is the only place the host key is recoverable after a closed tab.
          Hidden entirely on a device that has never seen a race, so the landing
          page does not lead with an empty state. */}
      {myRaces.length > 0 && (
        <section className="landing-section">
          <div className="landing-section__header">
            <div>
              <h2 className="t-announce fs-d-md landing-section__title">
                MY RACES
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/races')}>
              See all
            </Button>
          </div>
          <MyRacesGrid
            races={myRaces.slice(0, 3)}
            onResume={handleResumeRace}
            onRemove={handleForgetRace}
            emptyAction={
              <Button variant="primary" onClick={() => navigate('/host')}>
                Host a race
              </Button>
            }
          />
        </section>
      )}

      {/* My Local Maps Section */}
      {isDesktop && (
        <section className="landing-section">
          <div className="landing-section__header">
            <div>
              <h2 className="t-announce fs-d-md landing-section__title">
                MY MAPS
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/design')}>
              + New Map
            </Button>
          </div>
          <MyMapsGrid maps={localMaps} onSelectMap={handleSelectMap} onRemoveMap={handleRemoveMap} />
        </section>
      )}

      <PageFooter />
    </PageShell>
  );
};
