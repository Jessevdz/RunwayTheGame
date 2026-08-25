# Package `api`

`internal/api` contains the HTTP REST API server, handlers, middleware, and real-time WebSocket hub for Runway.

---

## High-Level File Overview

### Server Core, Routing & Middleware
* **[`api.go`](api.go)** — `Server` struct initialization (`NewServer`), global Chi router setup, middleware registration (`TraceMiddleware`, `RequestLoggerMiddleware`), JSON response helpers (`writeJSON`), and server options.
* **[`adminsession.go`](adminsession.go)** — Admin session exchange (`POST /api/admin/session`), HttpOnly session cookies, CSRF tokens (`X-Admin-CSRF`), rate-limited brute-force protection, and SameSite configuration.
* **[`auth.go`](auth.go)** — Capability token authorization middlewares (`requireHost`, `requireParticipant`), bearer token hashing, join code validation, and origin checking.
* **[`config.go`](config.go)** — Runtime configuration handler (`GET /api/config`) serving client feature flags and public server settings.
* **[`ratelimit.go`](ratelimit.go)** — In-memory token-bucket rate limiting logic per IP and action key.
* **[`realip.go`](realip.go)** — Trusted proxy-aware client IP extraction middleware (`X-Forwarded-For`).
* **[`realtime.go`](realtime.go)** — WebSocket connection upgrader, real-time client state broadcast engine (`Hub`), and subscription handling.

### Board Management
* **[`boards.go`](boards.go)** — Central API route registration (`setupRoutes`), board DTOs, and admin verification handler.
* **[`board_crud.go`](board_crud.go)** — Handlers for board creation, listing, retrieval, update, deletion, and visibility toggling.
* **[`board_decks.go`](board_decks.go)** — Deck configuration endpoints for roadblock, curse, powerup, and challenge cards.
* **[`board_snapshot.go`](board_snapshot.go)** — Freezes the copy of a board a race pins, and guards design writes against a version some game already runs on.
* **[`board_gallery.go`](board_gallery.go)** — Public board gallery listing, publishing, versioning, cloning/forking, and thumbnail endpoints.
* **[`board_validation.go`](board_validation.go)** — Structural validation rules for board waypoints, roads, challenges, and card decks.
* **[`challenges.go`](challenges.go)** — Challenge deck manipulation handlers for draft boards.

### Game Sessions & Gameplay Handlers
* **[`games.go`](games.go)** — Game router setup (`setupGameRoutes`), game loader helpers (`loadGame`, `resolveGameAndTeam`), and public state fetching.
* **[`game_lifecycle.go`](game_lifecycle.go)** — Game session creation, solo runs, starting/finishing games, ending sessions, and verification mode settings.
* **[`game_lobby.go`](game_lobby.go)** — Player joining/leaving, lobby roster queries, and participant state management.
* **[`game_teams.go`](game_teams.go)** — Team setup, creation, squad edits, and team assignments.
* **[`game_movement.go`](game_movement.go)** — Dice rolling, position updates, movement validation, and tile arrival actions.
* **[`game_capture.go`](game_capture.go)** — Photo proof upload presigned URLs, challenge submission, gating, and photo vetoes.
* **[`game_verdict.go`](game_verdict.go)** — Automated AI referee worker callback (`POST /api/games/{game_id}/verdict`), verdict application, and road conflict settlement.
* **[`game_disputes.go`](game_disputes.go)** — Dispute escalation, referee grading, and dispute voting/verdicts.
* **[`game_hazards.go`](game_hazards.go)** — Dynamic map hazards, roadblock placement, and curse card interactions.
* **[`game_shop.go`](game_shop.go)** — In-game powerup shop purchasing and item activation.
* **[`game_overrides.go`](game_overrides.go)** — Admin and referee state overrides (position forcing, score adjustments, debug edits).
* **[`coinrush.go`](coinrush.go)** — Coin Rush game mode logic, coin spawning/collection, and game settlement timers.

### Analytics, Social & Data Lifecycle
* **[`analytics.go`](analytics.go)** — Map editor usage telemetry ingestion and metrics retrieval handlers.
* **[`leaderboard.go`](leaderboard.go)** — Solo run leaderboards, high scores, and player rank queries.
* **[`report.go`](report.go)** — End-of-race reporting, match timelines, evidence summaries, and game statistics.
* **[`retention.go`](retention.go)** — Data retention policies, game state purging, and automated inactive session cleanup.
* **[`review.go`](review.go)** — Board ratings/reviews, host review queues, and media access URLs.
* **[`roadmap.go`](roadmap.go)** — Feature roadmap submissions, community voting, moderation flagging, and roadmap administration.
* **[`bugreports.go`](bugreports.go)** — Playtester bug reports: a public rate-limited POST, and admin-gated listing, triage, and deletion. The attached diagnostic context is unmarshalled into a closed struct and re-marshalled before storage, so a client cannot add fields.

---

## Where to Find Specific Functionality

| Functionality | Primary Files |
| :--- | :--- |
| **Server Setup, Auth & Admin Sessions** | [`api.go`](api.go), [`adminsession.go`](adminsession.go), [`auth.go`](auth.go), [`realip.go`](realip.go), [`ratelimit.go`](ratelimit.go) |
| **Real-time WebSockets** | [`realtime.go`](realtime.go) |
| **Board Editor & Gallery** | [`board_crud.go`](board_crud.go), [`board_gallery.go`](board_gallery.go), [`board_decks.go`](board_decks.go), [`board_validation.go`](board_validation.go) |
| **Game State & Lobbies** | [`games.go`](games.go), [`game_lifecycle.go`](game_lifecycle.go), [`game_lobby.go`](game_lobby.go), [`game_teams.go`](game_teams.go) |
| **In-Game Action Handlers** | [`game_movement.go`](game_movement.go), [`game_hazards.go`](game_hazards.go), [`game_shop.go`](game_shop.go), [`coinrush.go`](coinrush.go) |
| **Photo Proof & Verification** | [`game_capture.go`](game_capture.go), [`game_verdict.go`](game_verdict.go), [`game_disputes.go`](game_disputes.go), [`review.go`](review.go) |
| **Leaderboards & Reports** | [`leaderboard.go`](leaderboard.go), [`report.go`](report.go) |
| **Data Cleanup & Maintenance** | [`retention.go`](retention.go) |
| **Feature Roadmap & Feedback** | [`roadmap.go`](roadmap.go), [`analytics.go`](analytics.go) |
| **Playtester Bug Reports** | [`bugreports.go`](bugreports.go) |

---

## Test Suite

Tests are co-located in `*_test.go` files, covering authorization rules (`authorization_test.go`), full game flow scenarios (`fullrace_test.go`, `solorun_test.go`), rate limiting, real IP resolution, and individual game mechanics.
