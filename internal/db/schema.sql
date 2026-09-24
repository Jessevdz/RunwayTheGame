-- Activate PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Clean up old Runway tables if they exist. These names are all retired: never
-- add a live table here, or a boot will drop it.
DROP TABLE IF EXISTS board_triangle_adjacencies CASCADE;
DROP TABLE IF EXISTS board_triangles CASCADE;
DROP TABLE IF EXISTS board_home_nodes CASCADE;
DROP TABLE IF EXISTS board_edges CASCADE;
DROP TABLE IF EXISTS board_nodes CASCADE;
DROP TABLE IF EXISTS game_challenge_draws CASCADE;
DROP TABLE IF EXISTS battle_pairings CASCADE;
DROP TABLE IF EXISTS capture_sessions CASCADE;
-- Retired by the waypoint/road/challenge naming unification. These three names
-- are gone for good, so the unconditional drop is a no-op after the first boot.
DROP TABLE IF EXISTS board_segments CASCADE;
DROP TABLE IF EXISTS segment_progress CASCADE;
DROP TABLE IF EXISTS team_segment_bypass CASCADE;

-- These three kept their name and renamed a column: node_id and segment_id
-- became waypoint_id and road_id. CREATE TABLE IF NOT EXISTS is a no-op against
-- a table that already exists, so a database predating the rename would keep the
-- old columns and the migration would die on the first index naming a new one.
-- The rename was a clean break, so the fix is to drop and let the CREATEs below
-- rebuild them empty. Guarded on the old column actually being present: an
-- unconditional drop here would wipe live tables on every single boot.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'challenges' AND column_name = 'node_id') THEN
        DROP TABLE challenges CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'placed_roadblocks' AND column_name = 'segment_id') THEN
        DROP TABLE placed_roadblocks CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'challenge_submissions' AND column_name = 'segment_id') THEN
        DROP TABLE challenge_submissions CASCADE;
    END IF;
END $$;

-- 1. Boards
CREATE TABLE IF NOT EXISTS boards (
    id UUID NOT NULL,
    version INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    -- Only the digest of the edit capability, the way games.host_token_hash
    -- holds the host's. The plaintext is returned exactly once, to whoever
    -- created or forked the board, and is never read back out — so there is no
    -- reason for a database dump to contain a live capability.
    edit_token_hash TEXT,
    is_listed BOOLEAN NOT NULL DEFAULT TRUE,
    -- TRUE on the frozen copy a race pins, FALSE on the draft a designer edits.
    is_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMP WITH TIME ZONE,
    base_map_style VARCHAR(255),
    bounds GEOMETRY(Polygon, 4326),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, version)
);


-- 2. Board Waypoints (replaces board_nodes)
CREATE TABLE IF NOT EXISTS board_waypoints (
    id UUID NOT NULL,
    board_id UUID NOT NULL,
    board_version INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    location GEOMETRY(Point, 4326) NOT NULL,
    arrival_radius_m DOUBLE PRECISION NOT NULL DEFAULT 40,
    is_start BOOLEAN NOT NULL DEFAULT FALSE,
    is_finish BOOLEAN NOT NULL DEFAULT FALSE,
    challenge_id UUID, -- Link to challenges
    PRIMARY KEY (board_id, board_version, id),
    FOREIGN KEY (board_id, board_version) REFERENCES boards(id, version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_board_waypoints_location ON board_waypoints USING GIST(location);

-- 3. Board Roads (replaces board_segments)
CREATE TABLE IF NOT EXISTS board_roads (
    id UUID NOT NULL,
    board_id UUID NOT NULL,
    board_version INTEGER NOT NULL,
    waypoint_id_a UUID NOT NULL,
    waypoint_id_b UUID NOT NULL,
    length_m DOUBLE PRECISION NOT NULL DEFAULT 0,
    challenge_id UUID,  -- optional gating challenge for this stretch of road
    PRIMARY KEY (board_id, board_version, id),
    FOREIGN KEY (board_id, board_version) REFERENCES boards(id, version) ON DELETE CASCADE
);

-- 4. Challenges (linked to board_waypoints)
CREATE TABLE IF NOT EXISTS challenges (
    id UUID NOT NULL,
    board_id UUID NOT NULL,
    board_version INTEGER NOT NULL,
    waypoint_id UUID, -- NULL for road challenges, which are attached through board_roads.challenge_id
    prompt TEXT NOT NULL,
    rubric JSONB NOT NULL,     -- must_show[], fails_if[], acceptable_ambiguity
    coin_reward INTEGER NOT NULL DEFAULT 10,
    veto_penalty_seconds INTEGER NOT NULL DEFAULT 900,
    PRIMARY KEY (board_id, board_version, id),
    FOREIGN KEY (board_id, board_version) REFERENCES boards(id, version) ON DELETE CASCADE
);

-- 5. Board Roadblock Cards
-- Card ids are only unique within a board: two boards built from the same
-- default deck legitimately carry the same card id, so the key is board-scoped.
CREATE TABLE IF NOT EXISTS board_roadblock_cards (
    id UUID NOT NULL,
    board_id UUID NOT NULL,
    board_version INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (board_id, board_version, id),
    FOREIGN KEY (board_id, board_version) REFERENCES boards(id, version) ON DELETE CASCADE
);

-- 6. Board Curse Cards
CREATE TABLE IF NOT EXISTS board_curse_cards (
    id UUID NOT NULL,
    board_id UUID NOT NULL,
    board_version INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (board_id, board_version, id),
    FOREIGN KEY (board_id, board_version) REFERENCES boards(id, version) ON DELETE CASCADE
);

-- 7. Board Powerup Costs
CREATE TABLE IF NOT EXISTS board_powerup_costs (
    board_id UUID NOT NULL,
    board_version INTEGER NOT NULL,
    powerup VARCHAR(100) NOT NULL,
    cost INTEGER NOT NULL,
    PRIMARY KEY (board_id, board_version, powerup),
    FOREIGN KEY (board_id, board_version) REFERENCES boards(id, version) ON DELETE CASCADE
);

-- 7b. Board Powerups (custom, editable powerup definitions)
-- The id is a semantic string (e.g. "nerf", "powerup-<ts>-<rand>") so the game
-- engine can keep routing behaviour by id; board_powerup_costs is kept in sync as
-- a derived id->cost view for readers that only care about pricing.
CREATE TABLE IF NOT EXISTS board_powerups (
    board_id UUID NOT NULL,
    board_version INTEGER NOT NULL,
    id VARCHAR(100) NOT NULL,
    icon VARCHAR(16) NOT NULL DEFAULT '',
    name VARCHAR(120) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    cost INTEGER NOT NULL DEFAULT 0,
    duration_s INTEGER NOT NULL DEFAULT 0,
    effect VARCHAR(60) NOT NULL DEFAULT 'generic',
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (board_id, board_version, id),
    FOREIGN KEY (board_id, board_version) REFERENCES boards(id, version) ON DELETE CASCADE
);

-- 8. Event Store (Append-only per-game sequence)
CREATE TABLE IF NOT EXISTS events (
    game_id UUID NOT NULL,
    sequence INTEGER NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    trace_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_events_game_seq ON events(game_id, sequence ASC);

-- 9. Job Queue (Postgres-backed queue)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID NOT NULL PRIMARY KEY,
    game_id UUID,
    job_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    run_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by VARCHAR(255),
    error_message TEXT,
    trace_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_poll ON jobs(status, run_at) WHERE status = 'pending';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS game_id UUID;
CREATE INDEX IF NOT EXISTS idx_jobs_game_id ON jobs(game_id);

-- 10. Idempotent Commands
-- A cached result is scoped to its game, principal, command and key, and is only
-- replayed when the caller repeats the same payload.
CREATE TABLE IF NOT EXISTS idempotent_commands (
    key VARCHAR(255) NOT NULL,
    game_id UUID NOT NULL,
    principal_id TEXT NOT NULL DEFAULT 'system',
    command_type TEXT NOT NULL DEFAULT '',
    payload_hash TEXT NOT NULL DEFAULT '',
    response_body JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, principal_id, command_type, key)
);

-- Older caches could contain live join/host credentials in the serialized
-- response. Keep the non-secret result fields so upgraded handlers can issue a
-- replacement capability on replay, and erase the copied credentials.
UPDATE idempotent_commands
SET response_body = jsonb_set(
    response_body,
    '{response_body}',
    COALESCE(response_body->'response_body', '{}'::jsonb) - 'join_token' - 'host_token' - 'join_code',
    FALSE
)
WHERE COALESCE(response_body->'response_body'->>'join_token', '') <> ''
   OR COALESCE(response_body->'response_body'->>'host_token', '') <> ''
   OR COALESCE(response_body->'response_body'->>'join_code', '') <> '';

ALTER TABLE idempotent_commands ADD COLUMN IF NOT EXISTS principal_id TEXT NOT NULL DEFAULT 'system';
ALTER TABLE idempotent_commands ADD COLUMN IF NOT EXISTS command_type TEXT NOT NULL DEFAULT '';
ALTER TABLE idempotent_commands ADD COLUMN IF NOT EXISTS payload_hash TEXT NOT NULL DEFAULT '';

-- 11. Games (lifecycle: draft → live → ended)
CREATE TABLE IF NOT EXISTS games (
    id UUID NOT NULL PRIMARY KEY,
    board_id UUID NOT NULL,
    board_version INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, live, ended
    ruleset JSONB NOT NULL,
    winner_team_id UUID,
    -- Host/GM capability. Only the SHA-256 of the token is stored: the plaintext
    -- is returned exactly once, to whoever created the game.
    host_token_hash TEXT,
    -- Short code a player types to find this race. Unlike game_teams.join_code,
    -- which is always looked up as (game_id, join_code), this one IS the lookup
    -- key — so it has to be globally unique. The index lives with the ALTERs at
    -- the bottom, for the same reason join_code's does.
    race_code VARCHAR(12),
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Extra host capabilities issued when a tokenless idempotency-cache response is
-- replayed. The original hash stays valid so concurrent retries cannot revoke
-- a capability another retry has just returned.
CREATE TABLE IF NOT EXISTS game_host_tokens (
    token_hash TEXT NOT NULL PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_host_tokens_game ON game_host_tokens(game_id);

-- Backfill after games exists so this migration also works on a fresh database.
UPDATE jobs j
   SET game_id = g.id
  FROM games g
 WHERE j.game_id IS NULL
   AND j.payload->>'game_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND g.id::text = j.payload->>'game_id';

-- 12. Game Teams (one row per team per game)
CREATE TABLE IF NOT EXISTS game_teams (
    id UUID NOT NULL PRIMARY KEY,        -- team_id
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slot_index INTEGER NOT NULL,
    -- Short code the team (or the host) reads out so a teammate can claim the
    -- same team. A join token is never echoed to an unauthenticated caller —
    -- knowing a team_id must not be enough to impersonate the team.
    join_code VARCHAR(12),
    UNIQUE(game_id, slot_index)
);

-- 12b. Team capabilities
--
-- One row per device that speaks for a team, holding only the SHA-256 of its
-- join token. The token itself used to live in game_teams in plaintext, which
-- made a database dump a set of live capabilities rather than digests.
--
-- A team has many of these because a team has many phones: a teammate claiming
-- the same team with the join code is issued its own capability rather than
-- handed a copy of somebody else's, which is also what makes one device's
-- capability revocable without ending the others'.
CREATE TABLE IF NOT EXISTS team_tokens (
    token_hash TEXT NOT NULL PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES game_teams(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_tokens_lookup ON team_tokens(game_id, token_hash);
-- The join_code index lives with the ALTERs at the bottom: on an existing
-- database the CREATE TABLE above is a no-op, so the column does not exist yet
-- at this point in the file.

-- 13. Team Coins (runtime)
CREATE TABLE IF NOT EXISTS team_coins (
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, team_id)
);

-- 14. Team Powerups Inventory (runtime)
CREATE TABLE IF NOT EXISTS team_powerups (
    id UUID NOT NULL PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    powerup VARCHAR(100) NOT NULL,
    acquired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    used_at TIMESTAMP WITH TIME ZONE
);

-- 15. Road Progress (runtime)
CREATE TABLE IF NOT EXISTS road_progress (
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    road_id UUID NOT NULL,
    completed_by UUID, -- team_id
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, road_id)
);

-- 16. Team Road Bypass (runtime: veto or challenge skip)
CREATE TABLE IF NOT EXISTS team_road_bypass (
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    road_id UUID NOT NULL,
    reason VARCHAR(50) NOT NULL, -- 'veto' or 'skip'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, team_id, road_id)
);

-- 17. Team Effects (runtime: freeze, tracker off, active curses)
CREATE TABLE IF NOT EXISTS team_effects (
    id UUID NOT NULL PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    kind VARCHAR(50) NOT NULL, -- 'freeze', 'tracker_off', 'veto_penalty', 'curse'
    until TIMESTAMP WITH TIME ZONE NOT NULL,
    meta JSONB, -- stores card text, source, etc.
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 18. Placed Roadblocks (runtime)
CREATE TABLE IF NOT EXISTS placed_roadblocks (
    id UUID NOT NULL PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    road_id UUID NOT NULL,
    placed_by UUID NOT NULL, -- team_id
    card_id UUID NOT NULL,
    challenge_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 19. Team Positions (runtime: last-write-wins GPS, not event-sourced)
CREATE TABLE IF NOT EXISTS team_positions (
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    accuracy_m DOUBLE PRECISION NOT NULL,
    reported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, team_id)
);

-- 20. Challenge Submissions (runtime: replaces capture_sessions)
CREATE TABLE IF NOT EXISTS challenge_submissions (
    id UUID NOT NULL PRIMARY KEY,        -- submission_id
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id UUID NOT NULL,
    road_id UUID NOT NULL,
    waypoint_id UUID,
    challenge_id UUID NOT NULL,
    blob_ref TEXT NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    kind VARCHAR(20) NOT NULL DEFAULT 'challenge', -- challenge, roadblock
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, pass, fail
    client_captured_at TIMESTAMP WITH TIME ZONE,
    server_received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenge_submissions_game_road ON challenge_submissions(game_id, road_id);

-- 21. Community Roadmap
CREATE TABLE IF NOT EXISTS roadmap_items (
    id          UUID NOT NULL PRIMARY KEY,
    title       VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      VARCHAR(30) NOT NULL DEFAULT 'PROPOSED', -- PROPOSED, PLANNED, IN_PROGRESS, SHIPPED
    vote_count  INTEGER NOT NULL DEFAULT 0,
    flag_count  INTEGER NOT NULL DEFAULT 0,
    is_hidden   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roadmap_items_status_votes ON roadmap_items(status, vote_count DESC, created_at DESC) WHERE is_hidden = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadmap_items_title ON roadmap_items (LOWER(title));

CREATE TABLE IF NOT EXISTS roadmap_votes (
    item_id    UUID NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    voter_id   UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (item_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_roadmap_votes_voter ON roadmap_votes(voter_id);

CREATE TABLE IF NOT EXISTS roadmap_flags (
    item_id    UUID NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    voter_id   UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (item_id, voter_id)
);

-- Migration safety for existing installations
-- Existing boards were listed unconditionally, so the column arrives TRUE for
-- them. New boards start private: listing is now a deliberate act by the
-- designer, not a side effect of pressing Save.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE boards ALTER COLUMN is_listed SET DEFAULT FALSE;
ALTER TABLE board_waypoints ADD COLUMN IF NOT EXISTS challenge_id UUID;
ALTER TABLE board_roads ADD COLUMN IF NOT EXISTS challenge_id UUID;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS waypoint_id UUID;
ALTER TABLE challenges ALTER COLUMN waypoint_id DROP NOT NULL;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS kind VARCHAR(50) DEFAULT 'gating';
ALTER TABLE challenges ALTER COLUMN kind SET DEFAULT 'gating';
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS veto_penalty_seconds INTEGER NOT NULL DEFAULT 3600;
-- A veto now costs 15 minutes by default, matching the map designer's default
-- and the time-trial clock penalty. Existing rows keep whatever they were saved
-- with; only the fallback for a challenge inserted without one moves.
ALTER TABLE challenges ALTER COLUMN veto_penalty_seconds SET DEFAULT 900;
ALTER TABLE challenges DROP COLUMN IF EXISTS difficulty;

-- Older road challenges stored the road UUID in waypoint_id. Normalize rows
-- reached through board_roads.challenge_id to NULL unless the same challenge
-- is also attached to a waypoint; this keeps road targets out of the waypoint
-- uniqueness key and avoids UUID collisions across the two target types.
UPDATE challenges c
SET waypoint_id = NULL
FROM board_roads road
WHERE road.board_id = c.board_id
  AND road.board_version = c.board_version
  AND road.challenge_id = c.id
  AND c.waypoint_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM board_waypoints wp
      WHERE wp.board_id = c.board_id
        AND wp.board_version = c.board_version
        AND wp.challenge_id = c.id
  );

-- Keep all historical challenge rows, but detach duplicate waypoint targets
-- before enforcing one challenge per waypoint. Prefer the challenge already
-- referenced by that waypoint (or road); ties are resolved by stable UUID order.
DO $$
BEGIN
    CREATE TEMP TABLE challenge_target_dedup ON COMMIT DROP AS
    SELECT board_id, board_version, waypoint_id, duplicate_id, canonical_id
    FROM (
        SELECT c.board_id, c.board_version, c.waypoint_id, c.id AS duplicate_id,
               FIRST_VALUE(c.id) OVER target_order AS canonical_id,
               ROW_NUMBER() OVER target_order AS duplicate_order
        FROM challenges c
        WHERE c.waypoint_id IS NOT NULL
        WINDOW target_order AS (
            PARTITION BY c.board_id, c.board_version, c.waypoint_id
            ORDER BY
                CASE WHEN EXISTS (
                    SELECT 1 FROM board_waypoints wp
                    WHERE wp.board_id = c.board_id
                      AND wp.board_version = c.board_version
                      AND wp.id = c.waypoint_id
                      AND wp.challenge_id = c.id
                ) THEN 0 ELSE 1 END,
                CASE WHEN EXISTS (
                    SELECT 1 FROM board_roads road
                    WHERE road.board_id = c.board_id
                      AND road.board_version = c.board_version
                      AND road.id = c.waypoint_id
                      AND road.challenge_id = c.id
                ) THEN 0 ELSE 1 END,
                c.id
        )
    ) ranked
    WHERE duplicate_order > 1;

    -- Preserve active challenge references by pointing any duplicate links at
    -- the selected canonical row before the duplicate target IDs are cleared.
    UPDATE board_waypoints wp
    SET challenge_id = duplicate.canonical_id
    FROM challenge_target_dedup duplicate
    WHERE wp.board_id = duplicate.board_id
      AND wp.board_version = duplicate.board_version
      AND wp.id = duplicate.waypoint_id
      AND wp.challenge_id = duplicate.duplicate_id;

    UPDATE board_roads road
    SET challenge_id = duplicate.canonical_id
    FROM challenge_target_dedup duplicate
    WHERE road.board_id = duplicate.board_id
      AND road.board_version = duplicate.board_version
      AND road.id = duplicate.waypoint_id
      AND road.challenge_id = duplicate.duplicate_id;

    UPDATE challenges c
    SET waypoint_id = NULL
    FROM challenge_target_dedup duplicate
    WHERE c.board_id = duplicate.board_id
      AND c.board_version = duplicate.board_version
      AND c.id = duplicate.duplicate_id;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_one_per_waypoint
    ON challenges (board_id, board_version, waypoint_id)
    WHERE waypoint_id IS NOT NULL;

ALTER TABLE games ADD COLUMN IF NOT EXISTS ruleset JSONB NOT NULL DEFAULT '{}';
ALTER TABLE games ADD COLUMN IF NOT EXISTS winner_team_id UUID;
ALTER TABLE games ADD COLUMN IF NOT EXISTS host_token_hash TEXT;
-- Spectating is gone: a race is followed by the host and the teams racing in it,
-- and by nobody else. The read-only capability that existed only to let a
-- stranger watch goes with it, so the live position feed has no anonymous door.
ALTER TABLE games DROP COLUMN IF EXISTS spectator_token;
ALTER TABLE game_teams ADD COLUMN IF NOT EXISTS join_code VARCHAR(12);
CREATE INDEX IF NOT EXISTS idx_game_teams_join_code ON game_teams(game_id, join_code);

-- The race code is the only thing a joiner needs to type, so it must resolve to
-- exactly one game. Partial index: legacy games predate the column and keep a
-- NULL code, and NULLs must not collide with each other.
ALTER TABLE games ADD COLUMN IF NOT EXISTS race_code VARCHAR(12);
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_race_code ON games(race_code) WHERE race_code IS NOT NULL;

-- How a game is played: 'team', 'solo_time_trial', or 'solo_casual' (see
-- rules.ModeTeam and friends). Every game that predates the column is a team
-- race, which is exactly what the default backfills it to.
ALTER TABLE games ADD COLUMN IF NOT EXISTS mode VARCHAR(32) NOT NULL DEFAULT 'team';

-- Finished solo time trials, ranked per board. This is the one table in the
-- schema that outlives its game: everything else about a race is derivable from
-- the event log, but a leaderboard has to survive being read long after nobody
-- is looking at that particular run.
--
-- game_id is UNIQUE, which is what makes posting a time idempotent — a
-- double-tapped "post my time" cannot produce two rows. elapsed_seconds is
-- computed server-side from the event log (rules.RunElapsed); a client never
-- supplies its own time.
--
-- Ranking is per board across every version. The version each time was set on is
-- kept so a leaderboard can say that a row predates the current route.
CREATE TABLE IF NOT EXISTS solo_runs (
    id                   UUID NOT NULL PRIMARY KEY,
    game_id              UUID NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
    board_id             UUID NOT NULL,
    board_version        INTEGER NOT NULL,
    runner_name          VARCHAR(64) NOT NULL,
    elapsed_seconds      INTEGER NOT NULL,
    veto_count           INTEGER NOT NULL DEFAULT 0,
    skip_count           INTEGER NOT NULL DEFAULT 0,
    veto_penalty_seconds INTEGER NOT NULL DEFAULT 0,
    coins                INTEGER NOT NULL DEFAULT 0,
    finished_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- How the run's evidence was graded and the effective ruleset at posting
    -- time, copied rather than joined at read time.
    --
    -- It is recorded rather than used to filter. A trust-graded run is a real
    -- walk somebody took and belongs on the board; what would be dishonest is
    -- listing it next to a graded one with nothing to tell them apart, so every
    -- row carries how it was judged and the client says so.
    verification         VARCHAR(16) NOT NULL DEFAULT 'llm',
    ruleset              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_solo_runs_board ON solo_runs(board_id, elapsed_seconds);

-- Existing leaderboards predate the choice, and every time on them was set under
-- the model — which is exactly what the column default says.
ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS verification VARCHAR(16) NOT NULL DEFAULT 'llm';
ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS ruleset JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS skip_count INTEGER NOT NULL DEFAULT 0;

-- Separate purchased skips from actual vetoes in both existing and new rows.
-- Older versions emitted an adjacent PowerupUsed + ChallengeVetoed pair for a
-- purchased skip, so use that sequence and the pinned board effect to repair
-- historical leaderboard counts.
WITH legacy_skips AS (
    SELECT veto.game_id, veto.sequence
    FROM events veto
    JOIN events used
      ON used.game_id = veto.game_id
     AND used.sequence = veto.sequence - 1
     AND used.event_type = 'PowerupUsed'
    JOIN games g ON g.id = veto.game_id
    LEFT JOIN board_powerups pu
      ON pu.board_id = g.board_id
     AND pu.board_version = g.board_version
     AND pu.id = used.payload->>'powerup'
    WHERE veto.event_type = 'ChallengeVetoed'
      AND COALESCE(NULLIF(pu.effect, ''), used.payload->>'powerup') = 'challenge_skip'
), run_counts AS (
    SELECT sr.game_id,
           (SELECT COUNT(*) FROM events e
            WHERE e.game_id = sr.game_id AND e.event_type = 'ChallengeSkipped')
           + (SELECT COUNT(*) FROM legacy_skips s WHERE s.game_id = sr.game_id) AS skips,
           (SELECT COUNT(*) FROM events e
            WHERE e.game_id = sr.game_id AND e.event_type = 'ChallengeVetoed'
              AND NOT EXISTS (
                  SELECT 1 FROM legacy_skips s
                  WHERE s.game_id = e.game_id AND s.sequence = e.sequence
              )) AS vetoes
    FROM solo_runs sr
)
UPDATE solo_runs sr
SET skip_count = rc.skips,
    veto_count = rc.vetoes
FROM run_counts rc
WHERE sr.game_id = rc.game_id;

-- Preserve the effective rules that governed existing runs while their game
-- rows are still present. Older stored rulesets are normalized when read.
UPDATE solo_runs sr
SET ruleset = g.ruleset
FROM games g
WHERE sr.game_id = g.id
  AND sr.ruleset = '{}'::jsonb;

-- The game row may already have expired for an older leaderboard entry; keep
-- its preserved verification choice as the seed for the default ruleset.
UPDATE solo_runs
SET ruleset = jsonb_build_object('verification', verification)
WHERE ruleset = '{}'::jsonb;

-- Photo submissions now come in two kinds. 'challenge' is a waypoint challenge
-- and settles road progress and coins; 'roadblock' is a team working off a
-- roadblock card and settles nothing but that team's right to use the road.
-- The verdict handler branches on this, so it must never be NULL.
ALTER TABLE challenge_submissions ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'challenge';
ALTER TABLE challenge_submissions ADD COLUMN IF NOT EXISTS waypoint_id UUID;
UPDATE challenge_submissions s
SET waypoint_id = NULLIF(e.payload->>'waypoint_id', '')::uuid
FROM events e
WHERE s.waypoint_id IS NULL
  AND e.game_id = s.game_id
  AND e.event_type = 'SubmissionCreated'
  AND e.payload->>'submission_id' = s.id::text
  AND e.payload->>'waypoint_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Board elements (waypoints, roads, challenges, roadblock/curse cards) used to have
-- global primary keys on (id). When importing a map or reusing IDs across boards/versions,
-- saving collided on the pkey. Re-key these tables on (board_id, board_version, id).
DO $$
DECLARE
    t TEXT;
    pk_cols TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['board_waypoints', 'board_roads', 'challenges', 'board_roadblock_cards', 'board_curse_cards'] LOOP
        SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO pk_cols
        FROM pg_constraint c
        JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conrelid = t::regclass AND c.contype = 'p';

        IF pk_cols IS DISTINCT FROM 'board_id,board_version,id' THEN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_pkey');
            EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (board_id, board_version, id)', t);
        END IF;
    END LOOP;
END $$;

-- Boards created before edit tokens were enforced have no token at all, which
-- used to mean "anyone may edit". Give them a digest nobody can produce a
-- preimage for, so authorization stays unconditional and such a board is
-- read-only rather than world-writable. (It used to be backfilled with a fresh
-- plaintext token, which was the same outcome by accident — nobody holds a token
-- they were never shown — and is now the outcome by construction.)
ALTER TABLE boards ADD COLUMN IF NOT EXISTS edit_token_hash TEXT;

-- The edit capability is stored as a digest now, like games.host_token_hash. Any
-- board still holding a plaintext token is converted in place: the token keeps
-- working, because the digest of the token the designer holds is what the check
-- compares against.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boards' AND column_name = 'edit_token'
    ) THEN
        UPDATE boards
           SET edit_token_hash = encode(sha256(edit_token::text::bytea), 'hex')
         WHERE edit_token IS NOT NULL AND edit_token_hash IS NULL;
        ALTER TABLE boards DROP COLUMN edit_token;
    END IF;
END $$;

UPDATE boards SET edit_token_hash = encode(sha256(gen_random_uuid()::text::bytea), 'hex')
 WHERE edit_token_hash IS NULL;
-- No is_listed backfill here: this file runs on every boot, and re-listing every
-- unlisted board would undo the removal the designer performed on their device.

-- Legacy games predate the host capability and have no host_token_hash, so every
-- GM route fails closed for them. That is deliberate: a NULL hash must never be
-- readable as "no host token required".

-- The arrival radius decides how close a player must actually be to a waypoint.
-- It arrives from an unauthenticated board save, so an unbounded value here is
-- an off switch for the whole physical-presence check. Clamp anything already
-- stored outside the range the rules engine honours, then constrain the column
-- so a future write cannot reintroduce it. Bounds mirror
-- rules.MinArrivalRadiusM / rules.MaxArrivalRadiusM.
UPDATE board_waypoints SET arrival_radius_m = 500 WHERE arrival_radius_m > 500;
UPDATE board_waypoints SET arrival_radius_m = 5 WHERE arrival_radius_m > 0 AND arrival_radius_m < 5;
UPDATE board_waypoints SET arrival_radius_m = 25 WHERE arrival_radius_m <= 0;

ALTER TABLE board_waypoints DROP CONSTRAINT IF EXISTS board_waypoints_arrival_radius_range;
ALTER TABLE board_waypoints ADD CONSTRAINT board_waypoints_arrival_radius_range
    CHECK (arrival_radius_m >= 5 AND arrival_radius_m <= 500);

-- roadmap_votes.voter_id and roadmap_flags.voter_id are UUIDs the client picks
-- for itself, so "three distinct voters" cost an attacker three calls to
-- uuid.New(). voter_fingerprint is derived server-side from the request (see
-- api.voterFingerprint) and is what the counts are actually keyed on; voter_id
-- stays as the client's own handle so a browser can still see which items it
-- voted for.
ALTER TABLE roadmap_votes ADD COLUMN IF NOT EXISTS voter_fingerprint TEXT;
ALTER TABLE roadmap_flags ADD COLUMN IF NOT EXISTS voter_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_votes_fingerprint
    ON roadmap_votes(item_id, voter_fingerprint) WHERE voter_fingerprint IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_flags_fingerprint
    ON roadmap_flags(item_id, voter_fingerprint) WHERE voter_fingerprint IS NOT NULL;

-- The fix a submission was taken at. It used to exist only for the moment the
-- verification job was queued, so a re-grade (a player dispute) had nothing to
-- send the worker and passed a fabricated (0, 0) with perfect accuracy — a
-- position that trivially satisfies every GPS heuristic. Recording it means a
-- second pass is graded against where the photo was actually taken.
ALTER TABLE challenge_submissions ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE challenge_submissions ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;
ALTER TABLE challenge_submissions ADD COLUMN IF NOT EXISTS accuracy_m DOUBLE PRECISION;

-- When the photo behind this submission was destroyed, either by the team asking
-- for it back or by the 30-day sweep. The row survives its own photograph on
-- purpose: the verdict it carries is part of how the race was scored, and the
-- event log records it either way, so deleting the row would rewrite the result
-- rather than remove a picture. blob_ref is blanked alongside this, which is
-- what stops anything ever presigning a URL for an object that is gone.
ALTER TABLE challenge_submissions ADD COLUMN IF NOT EXISTS blob_deleted_at TIMESTAMP WITH TIME ZONE;

-- When a purge most recently started on this race. It is set before the purge
-- looks at what photographs exist and it closes the race to new evidence,
-- that lands between "here is the list of photos to destroy" and "here are the
-- rows to delete" is a photograph nothing will ever come back for: the row that
-- named it goes with the cascade and the object stays in the bucket forever.
--
-- It is never cleared. Failed purges refresh it and record an attempt count so
-- retention can back off before retrying. A race being deleted cannot accept
-- new evidence.
ALTER TABLE games ADD COLUMN IF NOT EXISTS purging_at TIMESTAMP WITH TIME ZONE;
-- Failed retention purges are postponed with bounded backoff. The sweep keeps
-- the error for diagnosis and prioritizes never-attempted games before retries.
ALTER TABLE games ADD COLUMN IF NOT EXISTS purge_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS purge_last_error TEXT;

-- Migrate old command caches without rebuilding their primary key on every boot.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'idempotent_commands'::regclass
          AND contype = 'p'
          AND pg_get_constraintdef(oid) = 'PRIMARY KEY (game_id, principal_id, command_type, key)'
    ) THEN
        ALTER TABLE idempotent_commands DROP CONSTRAINT IF EXISTS idempotent_commands_pkey;
        ALTER TABLE idempotent_commands ADD PRIMARY KEY (game_id, principal_id, command_type, key);
    END IF;
END $$;

-- Team capabilities moved out of game_teams and into team_tokens, hashed.
--
-- game_teams.join_token held the live token in plaintext, so a database dump was
-- a set of working capabilities. Existing tokens are carried across as digests —
-- every phone already holding one keeps playing — and the plaintext column then
-- goes. A team can now hold several capabilities, which is what lets a teammate
-- claim the same team without being handed the first device's token.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'game_teams' AND column_name = 'join_token'
    ) THEN
        INSERT INTO team_tokens (token_hash, game_id, team_id)
        SELECT encode(sha256(join_token::bytea), 'hex'), game_id, id
          FROM game_teams
         WHERE join_token IS NOT NULL AND join_token <> ''
        ON CONFLICT (token_hash) DO NOTHING;
        DROP INDEX IF EXISTS idx_game_teams_token;
        ALTER TABLE game_teams DROP COLUMN join_token;
    END IF;
END $$;

-- A person in a lobby.
--
-- team_tokens has always been one row per device; these two columns give that row
-- a face, so the lobby can answer the question it could not answer before: which
-- of my friends is on which squad. Nothing else changes shape — the event log,
-- the projection, standings, the race log and the race report all stay keyed by
-- team, and no capability is derived from a player. This is lobby identity and
-- nothing more.
--
-- It lives here rather than in a table of its own because team_tokens.team_id is
-- already the answer to "which squad is this device on": switching squads is one
-- UPDATE, the capability follows the player because authorizeSubscriber re-reads
-- the column per request, and ON DELETE CASCADE on game_id means purgeGame and
-- the retention sweep already destroy these names with everything else.
--
-- Both stay nullable. A device that joined before this existed has no name, and
-- the roster omits it rather than inventing one.
ALTER TABLE team_tokens ADD COLUMN IF NOT EXISTS player_id UUID;
ALTER TABLE team_tokens ADD COLUMN IF NOT EXISTS display_name VARCHAR(40);

-- The roster query reads every player in a game grouped by squad, which the
-- (game_id, token_hash) capability index cannot serve.
CREATE INDEX IF NOT EXISTS idx_team_tokens_roster ON team_tokens(game_id, team_id);

-- ============================================================================
-- 22. Analytics: raw client-reported events
-- ============================================================================
--
-- Design telemetry only — the map editor and the surfaces around it. Nothing
-- about a race is ever written here. Races are folded from the event log
-- instead, because the write path is the only trustworthy source and because
-- attaching a session id to location-adjacent behaviour is precisely what
-- PRIVACY.md rules out.
--
-- Deliberately absent, and a patch adding any of them is a policy change rather
-- than a schema change: ip, user_agent, referer, lat, lon, board_id, game_id,
-- team_id, player_id, and any free-text column at all. The property allowlist in
-- internal/analytics is what keeps `props` closed, and
-- TestAnalyticsEventsHasNoIdentifyingColumns in internal/api asserts this column
-- list has not grown.
--
-- Recording is off unless the operator sets RUNWAY_ANALYTICS=1. A self-hoster's
-- copy of PRIVACY.md says there is no analytics, and an upgrade must not make
-- their published policy false while they are not looking.
CREATE TABLE IF NOT EXISTS analytics_events (
    -- The UTC day, materialised rather than derived. Both the daily fold and the
    -- 90-day prune filter on it, and storing it costs four bytes to keep either
    -- from casting a timezone over a million rows.
    occurred_on DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'utc')::date),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- namespace.action, from the allowlist in internal/analytics. A name this
    -- server has never heard of is dropped at ingest, not stored.
    name VARCHAR(48) NOT NULL,
    -- The page load, and nothing more durable than that. It is minted into a
    -- JavaScript variable and never written to localStorage, sessionStorage, a
    -- cookie or IndexedDB — enforced by a lint rule over
    -- frontend/src/core/analytics. That is what keeps this app inside "strictly
    -- necessary" storage under ePrivacy Art. 5(3), and it is the reason the app
    -- shows no cookie banner. It is not an implementation detail.
    session_id UUID NOT NULL,
    -- Allowlisted scalar properties only: each value is a member of a closed
    -- string set, a boolean, or a bucket label. Never a number, never a name.
    props JSONB NOT NULL DEFAULT '{}'
);

-- No primary key and no surrogate id on purpose. Nothing here is identified,
-- updated or referenced, and unlike `events` — whose (game_id, sequence) key
-- exists because order *is* the model — sequence carries no meaning at all.
CREATE INDEX IF NOT EXISTS idx_analytics_events_day_name
    ON analytics_events(occurred_on, name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_at
    ON analytics_events(occurred_at);

-- Playtester bug reports. A separate table from roadmap_items on purpose: a
-- roadmap post is public content other people vote on, while a bug report is
-- private correspondence with the operator that nobody but an admin ever reads.
CREATE TABLE IF NOT EXISTS bug_reports (
    id          UUID NOT NULL PRIMARY KEY,
    -- What the tester typed. This is the only free-text the app accepts outside
    -- a roadmap post, and it is shown to admins verbatim, never to players.
    summary     VARCHAR(200) NOT NULL,
    details     TEXT NOT NULL DEFAULT '',
    severity    VARCHAR(20) NOT NULL DEFAULT 'NORMAL', -- BLOCKER, NORMAL, COSMETIC
    status      VARCHAR(20) NOT NULL DEFAULT 'NEW',    -- NEW, TRIAGED, FIXED, WONTFIX
    -- Diagnostic context captured by the client: the route pattern, a viewport
    -- bucket, the user-agent, and the last few JavaScript errors. Kept as a
    -- closed-shape JSONB rather than columns because it is read by a human
    -- during triage and never queried or aggregated.
    context     JSONB NOT NULL DEFAULT '{}',
    -- The reporter's own handle, reused from the roadmap voter id, so a tester
    -- can be asked a follow-up question through the same browser. It is a
    -- random UUID the client minted for itself and identifies no person.
    reporter_id UUID,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status_created
    ON bug_reports(status, created_at DESC);

-- A race pins one board version and reads waypoints, roads and challenges out of
-- it for as long as the race exists, so that version has to be frozen. It used
-- to be frozen in place: publishing stamped published_at on the designer's own
-- draft and every later save was refused, which meant racing a map once made it
-- permanently uneditable. A race now pins a snapshot copy instead.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_snapshot BOOLEAN NOT NULL DEFAULT FALSE;

-- Games created under the old model still point at the draft. Move each one onto
-- a snapshot of exactly the content it raced, then leave the draft editable.
DO $$
DECLARE
    r RECORD;
    v INTEGER;
BEGIN
    FOR r IN
        SELECT DISTINCT g.board_id, g.board_version
        FROM games g
        JOIN boards b ON b.id = g.board_id AND b.version = g.board_version
        WHERE b.is_snapshot = FALSE
    LOOP
        SELECT MAX(version) + 1 INTO v FROM boards WHERE id = r.board_id;

        INSERT INTO boards (id, version, name, edit_token_hash, is_listed, is_snapshot,
                            published_at, base_map_style, bounds, created_at, updated_at)
        SELECT id, v, name, NULL, FALSE, TRUE, COALESCE(published_at, NOW()),
               base_map_style, bounds, NOW(), updated_at
        FROM boards WHERE id = r.board_id AND version = r.board_version;

        INSERT INTO board_waypoints (board_id, board_version, id, name, location,
                                     arrival_radius_m, is_start, is_finish, challenge_id)
        SELECT board_id, v, id, name, location, arrival_radius_m, is_start, is_finish, challenge_id
        FROM board_waypoints WHERE board_id = r.board_id AND board_version = r.board_version;

        INSERT INTO board_roads (board_id, board_version, id, waypoint_id_a, waypoint_id_b, length_m, challenge_id)
        SELECT board_id, v, id, waypoint_id_a, waypoint_id_b, length_m, challenge_id
        FROM board_roads WHERE board_id = r.board_id AND board_version = r.board_version;

        INSERT INTO challenges (board_id, board_version, id, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
        SELECT board_id, v, id, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds
        FROM challenges WHERE board_id = r.board_id AND board_version = r.board_version;

        INSERT INTO board_roadblock_cards (board_id, board_version, id, text)
        SELECT board_id, v, id, text
        FROM board_roadblock_cards WHERE board_id = r.board_id AND board_version = r.board_version;

        INSERT INTO board_curse_cards (board_id, board_version, id, text)
        SELECT board_id, v, id, text
        FROM board_curse_cards WHERE board_id = r.board_id AND board_version = r.board_version;

        INSERT INTO board_powerup_costs (board_id, board_version, powerup, cost)
        SELECT board_id, v, powerup, cost
        FROM board_powerup_costs WHERE board_id = r.board_id AND board_version = r.board_version;

        INSERT INTO board_powerups (board_id, board_version, id, icon, name, description,
                                    cost, duration_s, effect, sort_order)
        SELECT board_id, v, id, icon, name, description, cost, duration_s, effect, sort_order
        FROM board_powerups WHERE board_id = r.board_id AND board_version = r.board_version;

        UPDATE games SET board_version = v
         WHERE board_id = r.board_id AND board_version = r.board_version;
        UPDATE solo_runs SET board_version = v
         WHERE board_id = r.board_id AND board_version = r.board_version;
    END LOOP;
END $$;
