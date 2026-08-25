import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { startGame, shareableApiBase, getGame, type LobbyTeam } from '../../core/api/client';
import { shareLink, canShareSheet } from '../../core/share';
import { useCopyFeedback } from '../../core/hooks/useCopyFeedback';
import { loadHostSession, type HostSession } from '../../core/game/hostSession';
import { loadTeamSession, type TeamSession } from '../../core/game/teamSession';
import { loadPlayerName, PLAYER_NAME_MAX } from '../../core/game/playerIdentity';
import { getRace, getRaceMode, lobbyPath, rememberRace, type RaceStatus } from '../../core/game/raceSession';
import { isCoinRush, type GameMode } from '../../core/projection/projectionStore';
import { useJoinTeam } from '../../core/game/useJoinTeam';
import { useLobbyMembership } from '../../core/game/useLobbyMembership';
import { slotColor, getTeamPalette } from '../../core/team/palette';
import { TeamPicker } from '../shared/TeamPicker';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import { AlphaNotice } from '../shared/AlphaNotice';
import { Button, Card, Chip, Dialog, Empty, Notice, Input, Sticker, Flap, BrandLines } from '@ds';
import './host-console.css';

/** Poll interval for refreshing lobby state (ms). */
const LOBBY_POLL_MS = 4000;

/** Game lobby view component for joining teams, viewing rosters, and launching races. */
export const GameLobby: React.FC = () => {
  const navigate = useNavigate();
  const { gameId } = useParams<{ gameId: string }>();

  const [copiedCode, copyCode] = useCopyFeedback(2000);
  const [copiedLink, copyLink] = useCopyFeedback(2000);
  // Both clipboard paths can fail (an origin that blocks it outright, a denied
  // permission). Silence would leave the host believing they had shared a code
  // they had not, so the failure is stated and the values stay selectable.
  const [copyFailed, setCopyFailed] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raceCode, setRaceCode] = useState<string>('');
  const [boardName, setBoardName] = useState<string>('');
  const [status, setStatus] = useState<RaceStatus>('draft');
  // Initial game mode state seeded from local index or default 'team'.
  const [mode, setMode] = useState<GameMode>(() => (gameId ? getRaceMode(gameId) : 'team'));
  const [roster, setRoster] = useState<LobbyTeam[]>([]);
  // Track whether lobby team roster has been fetched from server.
  const [rosterLoaded, setRosterLoaded] = useState(false);

  // Player display name prefilled from stored player identity.
  const [playerName, setPlayerName] = useState<string>(() => loadPlayerName());

  // Whoever created the race holds its host token. Without it this page can
  // still be read and joined, but it cannot start the race — that is the point.
  const hostSession = useMemo<HostSession | null>(() => (gameId ? loadHostSession(gameId) : null), [gameId]);
  // Hosting and racing are separate capabilities, and this device can hold both.
  const [teamSession, setTeamSession] = useState<TeamSession | null>(() => (gameId ? loadTeamSession(gameId) : null));
  const [gmOnly, setGmOnly] = useState<boolean>(() => (gameId ? !!getRace(gameId)?.gmOnly : false));

  const activeTeamId = teamSession?.teamId ?? null;

  /* Which squad edit is open, if any. One at a time: a lobby with three inline
     forms unfolded at once is the page this rewrite exists to get away from. */
  const [editing, setEditing] = useState<{ teamId: string; kind: 'name' | 'colour' } | null>(null);
  const [squadNameDraft, setSquadNameDraft] = useState('');
  const [renamingMe, setRenamingMe] = useState(false);
  const [myNameDraft, setMyNameDraft] = useState('');

  // Triggers transition state prior to navigating live players into the race.
  const [launching, setLaunching] = useState(false);
  useEffect(() => {
    if (!gameId || status !== 'live' || !activeTeamId) return;
    setLaunching(true);
    const timer = setTimeout(() => navigate(`/race/${gameId}?view=play`, { replace: true }), 1200);
    return () => clearTimeout(timer);
  }, [gameId, status, activeTeamId, navigate]);

  const { claimExistingTeam, busy: joinBusy, error: joinError, setError: setJoinError } = useJoinTeam(
    gameId,
    boardName || undefined
  );
  const {
    renameMe,
    switchTeam,
    editSquad,
    removeSquad,
    busy: editBusy,
    error: editError,
    setError: setEditError
  } = useLobbyMembership(teamSession);

  // Resolves target team and code parameters from invite link URL.
  const invited = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const teamId = params.get('teamId') || params.get('team');
    if (!teamId) return null;
    const code = params.get('teamCode') || params.get('code');
    return { teamId, code: code ? code.toUpperCase() : undefined };
  }, []);

  /* The lobby polls the public game route so the page works for host, player and
     new arrival alike. An ended race has nothing left to report, so the poll
     retires itself rather than billing the server every four seconds forever. */
  useEffect(() => {
    if (!gameId) return;
    const cached = getRace(gameId);
    if (cached?.raceCode) setRaceCode(cached.raceCode);
    if (cached?.boardName) setBoardName(cached.boardName);
    if (cached?.status) setStatus(cached.status);

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const read = () => {
      getGame(gameId)
        .then((game) => {
          if (cancelled) return;
          if (game.race_code) setRaceCode(game.race_code);
          if (game.board_name) setBoardName(game.board_name);
          if (game.mode) setMode(game.mode);
          setStatus(game.status);
          setRoster(game.teams || []);
          setRosterLoaded(true);
          rememberRace({
            gameId,
            raceCode: game.race_code || undefined,
            boardName: game.board_name,
            status: game.status,
            // Writing the mode back heals the index for a device that joined by
            // code, so its resume path routes on the real mode rather than the
            // 'team' fallback.
            mode: game.mode,
          });
          if (game.status === 'ended' && timer) {
            clearInterval(timer);
            timer = undefined;
          }
        })
        .catch(() => {
          // Offline, or the race is gone. Either way the question has now been
          // asked and an empty roster is the honest answer — a spinner that
          // never resolves would be a worse lie than the one above.
          if (!cancelled) setRosterLoaded(true);
        });
    };

    read();
    timer = setInterval(read, LOBBY_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [gameId]);

  const inviteUrl = useMemo(() => {
    if (!gameId) return '';
    const url = new URL(lobbyPath(gameId), window.location.origin);
    const api = shareableApiBase();
    if (api) url.searchParams.set('api', api);
    return url.toString();
  }, [gameId]);

  const teamsBySlot = useMemo(
    () => Object.fromEntries(roster.map((t) => [t.team_id, { name: t.team_name, slotIndex: t.slot_index }])),
    [roster]
  );
  const takenSlots = useMemo(() => new Set(roster.map((t) => t.slot_index)), [roster]);

  const alreadyLive = status === 'live' || status === 'ended';
  const isHost = !!hostSession;
  const isJoined = !!teamSession;
  const named = playerName.trim().length > 0;
  const busy = joinBusy || editBusy;

  const copyWithFlash = useCallback(async (text: string) => {
    const ok = await copyCode(text);
    setCopyFailed(!ok);
  }, [copyCode]);

  /* A link is for sending, so on a phone it opens the share sheet and skips the
     copy-leave-paste round trip entirely. The "Copied" flash only fires when
     something actually reached the clipboard — after a share sheet it would be
     claiming an act the player may well have cancelled. */
  const shareWithFlash = useCallback(async (url: string) => {
    const outcome = await shareLink(url, {
      title: 'Join my race on Runway',
      text: boardName ? `Race with me on ${boardName}` : undefined,
    });
    setCopyFailed(outcome === 'failed');
    if (outcome === 'copied') {
      await copyLink(url);
    }
  }, [boardName, copyLink]);

  /* Copy is the fallback path now, so the label has to follow the device rather
     than assert the clipboard on a phone that is about to open a share sheet. */
  const sendVerb = canShareSheet() ? 'Share' : 'Copy';

  const handleStart = async () => {
    if (!gameId) return;
    if (!hostSession) {
      setError(
        'This browser is not the host of this race. Only the device that created it can start it — open the lobby there, or host a new race.'
      );
      return;
    }
    setStarting(true);
    setError(null);
    try {
      await startGame(gameId, hostSession.hostToken);
      // A host who took a colour in another tab is still a racer here.
      const racing = teamSession || loadTeamSession(gameId);
      navigate(`/race/${gameId}?view=${racing ? 'play' : 'host'}`);
    } catch (err: any) {
      if (err?.status === 403) {
        setError(
          'This browser is no longer the host of this race. Only the device that created it can start it.'
        );
        setStarting(false);
        return;
      }
      setError(err.message || 'Failed to start the race');
      setStarting(false);
    }
  };

  /* One tap. Joining a squad that already exists and moving between two of them
     are the same intent from the player's side, so they are the same control —
     which of the two calls it takes is a detail of whether this device already
     holds a session. */
  const handleJoinSquad = async (team: LobbyTeam) => {
    if (!named) return;
    if (teamSession) {
      const next = await switchTeam(team.team_id);
      if (next) setTeamSession(next);
      return;
    }
    const code = invited?.teamId === team.team_id ? invited.code : undefined;
    const session = await claimExistingTeam(team.team_id, playerName, code);
    if (session) setTeamSession(session);
  };

  const handleCreateSquad = (session: TeamSession) => {
    setTeamSession(session);
    setJoinError(null);
  };

  const handleRenameMe = async () => {
    const next = await renameMe(myNameDraft);
    if (next) {
      setTeamSession(next);
      setPlayerName(next.displayName || myNameDraft.trim());
      setRenamingMe(false);
    }
  };

  const handleRenameSquad = async () => {
    const next = await editSquad({ name: squadNameDraft });
    if (next) {
      setTeamSession(next);
      setEditing(null);
    }
  };

  const handleRecolourSquad = async (slotIndex: number) => {
    const next = await editSquad({ slotIndex });
    if (next) {
      setTeamSession(next);
      setEditing(null);
    }
  };

  const handleDisband = async (team: LobbyTeam) => {
    if (!gameId) return;
    const token = teamSession?.teamToken || hostSession?.hostToken;
    if (!token) return;
    await removeSquad(gameId, team.team_id, token);
  };

  const handleGmOnly = (next: boolean) => {
    if (!gameId) return;
    setGmOnly(next);
    rememberRace({ gameId, gmOnly: next });
  };

  const brand = (
    <div className="lobby-row">
      <BrandLines size={24} />
      <span className="t-announce fs-7 lobby-brand">RUNWAY</span>
    </div>
  );

  if (!gameId) {
    return (
      <PageShell navPlacement="topbar" topBarProps={{ title: brand }}>
        <section className="lobby-container">
          <Empty
            icon="🧭"
            title="No race to show"
            description="This lobby link is missing its race id. Pick a map to host a new race instead."
            action={
              <Button variant="primary" icon="🏁" onClick={() => navigate('/host')}>
                Host a Race
              </Button>
            }
          />
        </section>
        <PageFooter />
      </PageShell>
    );
  }

  // Nobody with a team belongs in a lobby for a race that is already running.
  // The effect above owns the hand-off; this is the second it happens in.
  if (launching && teamSession) {
    return (
      <PageShell navPlacement="topbar" topBarProps={{ title: brand }}>
        <section className="lobby-container">
          <Empty
            icon="🏁"
            title="Race starting…"
            description={`${teamSession.teamName} is on the board. Taking you to ${boardName || 'the map'}.`}
          />
        </section>
      </PageShell>
    );
  }

  // Renders a squad card with member list and team controls.

  const squadCard = (team: LobbyTeam) => {
    const c = slotColor(team.slot_index);
    const mine = teamSession?.teamId === team.team_id;
    const editingThis = editing?.teamId === team.team_id;
    const canEdit = mine && !alreadyLive;
    // Nobody named is on it, so there is nothing to displace and it can go. The
    // server refuses with a 409 if a nameless device is still holding it, which
    // is a better answer than one this page tries to work out for itself.
    const canDisband = !alreadyLive && team.players.length === 0 && (isHost || isJoined);

    return (
      <div
        key={team.team_id}
        className="team-slot-card lobby-squad"
        style={{ background: c.bg, borderColor: c.color }}
      >
        <div className="lobby-row">
          <span className="team-dot" style={{ background: c.color }} />
          <span className="fs-5 lobby-row__name">{team.team_name}</span>
          {mine && <Sticker tone="amber">YOUR SQUAD</Sticker>}
          <span className="t-data fs-2 team-slot-card__meta">{c.label.toUpperCase()}</span>
        </div>

        {team.players.length > 0 ? (
          <div className="lobby-members">
            {team.players.map((p) => (
              <span key={p.player_id} className="lobby-member fs-5">
                {p.display_name}
                {p.player_id === teamSession?.playerId && (
                  <span className="t-label fs-1 lobby-member__you">YOU</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="fs-5 lobby-squad__nobody">Nobody on this squad yet.</p>
        )}

        {editingThis && editing.kind === 'name' && (
          <div className="lobby-squad__edit">
            <Input
              label="SQUAD NAME"
              value={squadNameDraft}
              onChange={(e) => setSquadNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && squadNameDraft.trim() && !busy) handleRenameSquad();
              }}
              placeholder="e.g. Red Dragons"
              enterKeyHint="done"
              autoFocus
            />
            <div className="lobby-squad__actions">
              <Button variant="primary" size="sm" disabled={busy || !squadNameDraft.trim()} onClick={handleRenameSquad}>
                Save name
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {editingThis && editing.kind === 'colour' && (
          <div className="lobby-squad__edit">
            <p className="t-label fs-label" style={{ margin: 0 }}>PICK A COLOUR</p>
            {/* Swatches, not buttons wearing a tint — see .team-pick. */}
            <div className="pane-list" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {getTeamPalette().map((slot, slotIndex) => {
                const taken = takenSlots.has(slotIndex) && slotIndex !== team.slot_index;
                return (
                  <button
                    key={slotIndex}
                    type="button"
                    className="team-pick"
                    style={{ background: slot.bg, borderColor: slot.color }}
                    disabled={busy || taken}
                    onClick={() => handleRecolourSquad(slotIndex)}
                  >
                    <span className="game-pane__dot" style={{ backgroundColor: slot.color }} />
                    <span>{slot.label}</span>
                    {taken && <span className="team-pick__hint">Taken</span>}
                  </button>
                );
              })}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        )}

        {renamingMe && mine && (
          <div className="lobby-squad__edit">
            <Input
              label="YOUR NAME"
              value={myNameDraft}
              onChange={(e) => setMyNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && myNameDraft.trim() && !busy) handleRenameMe();
              }}
              maxLength={PLAYER_NAME_MAX}
              enterKeyHint="done"
              autoFocus
            />
            <div className="lobby-squad__actions">
              <Button variant="primary" size="sm" disabled={busy || !myNameDraft.trim()} onClick={handleRenameMe}>
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRenamingMe(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!editingThis && !alreadyLive && (
          <div className="lobby-squad__actions">
            {/* Not in yet, or in and looking at somebody else's squad: one tap
                either way, and the same one. */}
            {!mine && (isJoined || named) && (
              <Button variant="secondary" size="sm" disabled={busy || !named} onClick={() => handleJoinSquad(team)}>
                {isJoined ? 'Switch to this squad' : `Join ${team.team_name}`}
              </Button>
            )}
            {canEdit && !renamingMe && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="✏️"
                  onClick={() => {
                    setEditError(null);
                    setSquadNameDraft(team.team_name);
                    setEditing({ teamId: team.team_id, kind: 'name' });
                  }}
                >
                  Rename squad
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="🎨"
                  onClick={() => {
                    setEditError(null);
                    setEditing({ teamId: team.team_id, kind: 'colour' });
                  }}
                >
                  Change colour
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="🙋"
                  onClick={() => {
                    setEditError(null);
                    setMyNameDraft(teamSession?.displayName || playerName);
                    setRenamingMe(true);
                  }}
                >
                  Rename me
                </Button>
              </>
            )}
            {canDisband && (
              <Button variant="ghost" size="sm" icon="🗑️" disabled={busy} onClick={() => handleDisband(team)}>
                Remove squad
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  /* What a player who is not in yet reads, top to bottom: name yourself, pick a
     squad, or start one. */
  const JoinCard = (
    <Card className="card--pad lobby-card">
      <div className="lobby-card__head">
        <h2 className="t-announce fs-7">JOIN THE RACE</h2>
      </div>

      {joinError && <Notice kind="stop" title="Couldn't join">{joinError}</Notice>}

      <Input
        label="YOUR NAME"
        hint="So your friends can see which squad you are on."
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        placeholder="e.g. Sam"
        maxLength={PLAYER_NAME_MAX}
        autoComplete="given-name"
        enterKeyHint="done"
      />

      {!rosterLoaded && <p className="fs-5 lobby-note">Checking who's already here…</p>}

      {rosterLoaded && roster.length > 0 && (
        <div className="lobby-group">
          <div>
            <h3 className="t-announce fs-6" style={{ margin: 0, color: 'var(--ink-strong)' }}>
              JOIN A SQUAD
            </h3>
            <p className="fs-5 lobby-note" style={{ marginTop: 'var(--sp-1)' }}>
              {named
                ? 'Tap the squad your friends are on. No code needed.'
                : 'Enter your name above, then tap the squad your friends are on.'}
            </p>
          </div>
          <div className="lobby-group" style={{ gap: 'var(--sp-2)' }}>{roster.map(squadCard)}</div>
        </div>
      )}

      <div className="lobby-group">
        <div>
          <h3 className="t-announce fs-6" style={{ margin: 0, color: 'var(--ink-strong)' }}>
            START A NEW SQUAD
          </h3>
          <p className="fs-5 lobby-note" style={{ marginTop: 'var(--sp-1)' }}>
            Name it, pick a colour, and your friends can tap straight onto it.
          </p>
        </div>
        <TeamPicker
          gameId={gameId}
          teams={teamsBySlot}
          boardName={boardName || undefined}
          displayName={playerName}
          onJoined={handleCreateSquad}
        />
      </div>
    </Card>
  );

  /* Once you are in, the lobby is one list: who is racing, and who they are
     racing with. */
  const SquadsCard = (
    <Card className="card--pad lobby-card">
      <div className="lobby-card__head">
        <h2 className="t-announce fs-7">SQUADS</h2>
        <Chip kind="challenge">{roster.length}</Chip>
      </div>

      {editError && <Notice kind="stop" title="Couldn't do that">{editError}</Notice>}
      {joinError && <Notice kind="stop" title="Couldn't join">{joinError}</Notice>}

      {!rosterLoaded ? (
        <Empty icon="📡" title="Reading the roster" description="Fetching the squads already in this lobby…" />
      ) : roster.length === 0 ? (
        <Empty
          icon="⏳"
          title="Waiting for squads"
          description="Squads appear here the moment somebody creates one or joins with the race code."
          action={
            <Button variant="secondary" size="sm" icon="🔗" onClick={() => setInviteOpen(true)}>
              Invite
            </Button>
          }
        />
      ) : (
        <div className="lobby-group" style={{ gap: 'var(--sp-2)' }}>{roster.map(squadCard)}</div>
      )}

      {/* A joined player's one outward action. The host has the full invite card
          instead — handing the race out is their job, not a player's. */}
      {isJoined && !isHost && roster.length > 0 && (
        <div className="lobby-actions">
          <Button variant="secondary" size="sm" icon="🔗" onClick={() => setInviteOpen(true)}>
            Invite someone
          </Button>
        </div>
      )}

      {/* A host who has not taken a colour decides here, in the card they are
          already reading, rather than in a card of its own. */}
      {isHost && !isJoined && !gmOnly && !alreadyLive && (
        <div className="lobby-group">
          <div>
            <span className="t-label fs-label" style={{ color: 'var(--brand-warm)' }}>RACING TOO?</span>
            <h3 className="t-announce fs-6" style={{ margin: 'var(--sp-1) 0 0 0', color: 'var(--ink-strong)' }}>
              TAKE A COLOUR
            </h3>
          </div>
          {joinError && <Notice kind="stop" title="Couldn't join">{joinError}</Notice>}
          <Input
            label="YOUR NAME"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="e.g. Alex"
            maxLength={PLAYER_NAME_MAX}
          />
          <TeamPicker
            gameId={gameId}
            teams={teamsBySlot}
            boardName={boardName || undefined}
            displayName={playerName}
            onJoined={handleCreateSquad}
          />
          <Button variant="ghost" size="sm" onClick={() => handleGmOnly(true)}>
            No — I'm just running it
          </Button>
        </div>
      )}

      {isHost && !isJoined && gmOnly && (
        <div className="lobby-row">
          <span className="fs-5" style={{ flex: 1, color: 'var(--ink-muted)' }}>Running this race as GM.</span>
          <Button variant="ghost" size="sm" onClick={() => handleGmOnly(false)}>
            Change
          </Button>
        </div>
      )}

      {!isHost && (
        <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: 0, textAlign: 'center' }}>
          {alreadyLive
            ? 'The race is currently live.'
            : 'The host will start the race once everyone is ready.'}
        </p>
      )}

      {!isHost && alreadyLive && teamSession && (
        <Button variant="secondary" onClick={() => navigate(`/race/${gameId}?view=play`)}>
          Open live race
        </Button>
      )}
    </Card>
  );

  /* One invitation, three deliveries: the code is shouted across a room, the QR
     is scanned in person, the link is pasted into a chat. The host gets it as a
     card because handing the race out is their job; everybody else gets exactly
     the same thing behind one button, because it is not. */
  const inviteBody = (
    <>
      {raceCode && (
        <div className="lobby-group">
          <p className="t-label fs-label" style={{ margin: 0 }}>RACE ENTRY CODE</p>
          <Flap value={raceCode} />
        </div>
      )}

      <p className="fs-5 lobby-note">
        Read the code out and players enter it on the home screen, or send them the link — either way
        they land here and tap straight onto a squad.
      </p>

      <div className="lobby-actions">
        {raceCode && (
          <Button variant="primary" size="sm" icon={copiedCode ? '✅' : '📋'} onClick={() => copyWithFlash(raceCode)}>
            {copiedCode ? 'Code copied' : 'Copy code'}
          </Button>
        )}
        <Button variant="secondary" size="sm" icon={copiedLink ? '✅' : '🔗'} onClick={() => shareWithFlash(inviteUrl)}>
          {copiedLink ? 'Link copied' : `${sendVerb} link`}
        </Button>
      </div>

      <div className="qr-plate">
        <QRCodeSVG value={inviteUrl} size={168} />
      </div>
    </>
  );

  const InviteCard = (
    <Card className="card--pad lobby-card">
      <div className="lobby-card__head">
        <h2 className="t-announce fs-7">INVITE</h2>
      </div>
      {inviteBody}
    </Card>
  );

  return (
    <PageShell navPlacement="topbar" topBarProps={{ title: brand }}>
      <section className="lobby-container">
        <div className="lobby-header">
          <div>
            <h1 className="t-announce fs-d-md" style={{ color: 'var(--ink-strong)', margin: 0 }}>
              {boardName || 'UNTITLED RACE'}
            </h1>
            {/* A coin rush is not won the way the lobby's audience will assume,
                so it says so before anybody picks a colour. A plain team race
                needs no label — it is the shape everyone already expects. */}
            {isCoinRush(mode) && (
              <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: 'var(--sp-2) 0 0', maxWidth: 'var(--measure)' }}>
                <strong style={{ color: 'var(--ink-strong)' }}>Coin rush.</strong> The richest team wins, not
                the fastest. Crossing the line pays a placement bonus and starts a countdown for everyone
                still out there.
              </p>
            )}
          </div>
          <span className="t-data fs-2 team-slot-card__meta">
            {alreadyLive ? (status === 'ended' ? 'ENDED' : 'LIVE') : 'WAITING'}
          </span>
        </div>

        {error && (
          <Notice kind="stop" title="Couldn't start the race" style={{ marginBottom: 'var(--sp-4)' }}>
            {error}
          </Notice>
        )}

        {copyFailed && (
          <Notice kind="warn" title="Couldn't reach the clipboard" style={{ marginBottom: 'var(--sp-4)' }}>
            This browser blocked the copy. Select the code or link on this page and copy it by hand.
          </Notice>
        )}

        {alreadyLive && (
          <Notice kind="warn" title={status === 'ended' ? 'This race is over' : 'This race is already live'} style={{ marginBottom: 'var(--sp-4)' }}>
            {status === 'ended' ? 'It can no longer be joined.' : 'New squads can still join a live race.'}
          </Notice>
        )}

        <AlphaNotice />

        {/* The host runs two things at once — handing out the invite and watching
            the roster fill — so they get two columns. Everybody else has exactly
            one job on this page, so they get one. */}
        <div className={`lobby-grid ${isHost ? 'lobby-grid--host' : 'lobby-grid--single'}`}>
          {isHost ? (
            <>
              {InviteCard}
              {SquadsCard}
            </>
          ) : isJoined ? (
            SquadsCard
          ) : (
            JoinCard
          )}
        </div>

        {/* The host's one primary action, reachable at any scroll depth. */}
        {isHost && (
          <div className="lobby-startbar">
            {alreadyLive ? (
              <Button
                variant="primary"
                icon="🏁"
                onClick={() => navigate(`/race/${gameId}?view=${teamSession ? 'play' : 'host'}`)}
              >
                {status === 'ended' ? 'Open recap' : 'Open live race'}
              </Button>
            ) : (
              <Button variant="primary" icon="🏁" disabled={starting || roster.length === 0} onClick={handleStart}>
                {starting ? 'Starting…' : roster.length === 0 ? 'Waiting for squads…' : `Start race · ${roster.length} squad${roster.length === 1 ? '' : 's'}`}
              </Button>
            )}
          </div>
        )}
      </section>

      <Dialog open={inviteOpen} title="Invite" onClose={() => setInviteOpen(false)}>
        <div className="lobby-group">{inviteBody}</div>
      </Dialog>

      <PageFooter />
    </PageShell>
  );
};

export default GameLobby;
