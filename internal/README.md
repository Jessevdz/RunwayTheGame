# Runway Internal Implementation Packages

The `/internal` directory contains the core server-side packages that run Runway's location-based game engine. In accordance with Go package visibility rules, packages placed inside the `internal/` directory can only be imported by packages in the same module subtree (i.e., under the `github.com/Jessevdz/RunwayTheGame` module). This enforces a strict modular boundary, preventing external consumers from depending on private implementation details.

---

## Architecture & Data Flow Overview

Runway utilizes an **Event Sourcing** architecture to implement a narrow write path and a wide, disposable read path. 

1. **Commands (Writes)**: All mutating requests (e.g., waypoint capture, battle submission, scoring ticks) are formulated as commands and processed via a central transactional command pipeline (`internal/commands`). This pipeline performs idempotency checks, transaction management, and optimistic concurrency verification before committing state.
2. **Events (State Changes)**: A successful command appends one or more events to the `internal/eventstore` database table within a serializable database transaction. The event log represents the single append-only source of truth.
3. **Projections (Reads)**: Read models are generated dynamically via event folding (`internal/projections`). When the event stream changes, the projection engine rebuilds or incrementally updates the game state projection (ownership, standings, active battles) to broadcast to client PWAs over WebSockets (`internal/api`).
4. **Asynchronous LLM Verification**: Photo verification is processed out-of-band by a pool of stateless workers (`internal/verification`). These workers poll a Postgres outbox queue (`internal/jobs`), download submissions directly from object storage (`internal/blobstore`), run GPS/velocity heuristics, invoke Scaleway Multimodal Generative LLM APIs for rubric evaluation, and submit verdict commands back into the REST API.
5. **Closed-Vocabulary Telemetry**: Application usage and interaction events are validated and sanitized via a strict closed vocabulary (`internal/analytics`) before persistence, ensuring zero free-form strings or PII are stored.

---

## Package Directory Tour

The `/internal` directory contains the following packages:

| Package | Purpose & Primary Responsibilities | Key Files / Entry Points |
| :--- | :--- | :--- |
| **[`analytics`](analytics)** | Defines a closed-vocabulary schema, sanitizes event properties against PII/free-form strings, and buckets numeric attributes for privacy-preserving telemetry. | [`analytics.go`](analytics/analytics.go), [`buckets.go`](analytics/buckets.go), [`registry.go`](analytics/registry.go) |
| **[`api`](api)** | Exposes REST HTTP endpoints and maintains the realtime WebSocket hub to broadcast projection updates to active games. Handles authentication (capability tokens, admin sessions), rate limiting, real IP resolution, game lifecycle, boards, roadmaps, retention, and analytics ingestion. | [`api.go`](api/api.go), [`adminsession.go`](api/adminsession.go), [`auth.go`](api/auth.go), [`boards.go`](api/boards.go), [`challenges.go`](api/challenges.go), [`games.go`](api/games.go), [`realtime.go`](api/realtime.go), [`ratelimit.go`](api/ratelimit.go), [`realip.go`](api/realip.go), [`retention.go`](api/retention.go), [`report.go`](api/report.go), [`roadmap.go`](api/roadmap.go) (+ `game_*.go` & `board_*.go` handlers) |
| **[`blobstore`](blobstore)** | Mints short-lived, presigned PUT upload URLs using AWS SigV4 query signing (built on standard Go libraries to run SDK-free), enforces SSRF key validation, and manages photo downloads/deletions with MinIO/S3. | [`blobstore.go`](blobstore/blobstore.go), [`presign.go`](blobstore/presign.go) |
| **[`commands`](commands)** | Orchestrates command execution in serializable database transactions via `CommandProcessor`, checking request idempotency, executing outbox job hooks, and triggering realtime broadcast hooks. | [`commands.go`](commands/commands.go) |
| **[`config`](config)** | Centralized environment variable resolution with typed fallbacks (`EnvOr`, `EnvIntOr`). | [`env.go`](config/env.go) |
| **[`db`](db)** | Wraps the `pgxpool.Pool` connection pool and implements automated Postgres database schema migrations utilizing embedded SQL (`//go:embed`). | [`db.go`](db/db.go), [`schema.sql`](db/schema.sql) |
| **[`eventstore`](eventstore)** | Provides sequential event insertion with optimistic concurrency checks (`sequence` mismatch protection) and event stream retrieval. | [`events.go`](eventstore/events.go), [`types.go`](eventstore/types.go) |
| **[`geo`](geo)** | Houses graph-based geographic computation helpers including 3-cycle (triangle) enumeration, PostGIS area math, triangle adjacency, geodesic/haversine math, and board publishing validation. | [`geo.go`](geo/geo.go), [`publish.go`](geo/publish.go), [`validation.go`](geo/validation.go) |
| **[`jobs`](jobs)** | Defines Postgres-backed outbox queue entries and scheduler helpers for background tasks (e.g., photo verification jobs). | [`jobs.go`](jobs/jobs.go) |
| **[`logger`](logger)** | Implements structured JSON logging with support for context-propagated trace IDs (`X-Trace-ID`). | [`logger.go`](logger/logger.go) |
| **[`projections`](projections)** | Computes in-memory read models (`GameStateProjection`) by replaying the event stream for a specific game sequence, enforcing tracker-off position privacy filters. | [`rebuild.go`](projections/rebuild.go), [`derive.go`](projections/derive.go), [`state.go`](projections/state.go), [`board.go`](projections/board.go) + `fold_*.go` |
| **[`rules`](rules)** | Implements pure domain logic for game mechanics (waypoint reachability BFS, majority-of-corners triangle ownership, score compilation, Coin Rush mechanics, GPS validation, and battle resolution). | [`engine.go`](rules/engine.go), [`types.go`](rules/types.go), [`gps.go`](rules/gps.go) |
| **[`scheduler`](scheduler)** | Drives background timers (scoring tick intervals, battle timeout checks, Coin Rush intervals) by polling live games and injecting commands into the processor. | [`scheduler.go`](scheduler/scheduler.go) |
| **[`testsupport`](testsupport)** | Provides isolated per-package test database provisioning (`runway_test_<pkg>`), fixture setup, and cleanup utilities for parallel integration testing. | [`testsupport.go`](testsupport/testsupport.go) |
| **[`verification`](verification)** | Orchestrates asynchronous rubric validation, including EXIF and GPS-velocity heuristics, Scaleway/Gemini API calls, auto-escalation, and verdict submission. | [`worker.go`](verification/worker.go), [`scaleway.go`](verification/scaleway.go), [`heuristics.go`](verification/heuristics.go), [`types.go`](verification/types.go) |

---

## Component Interaction & Data Flow

The diagram below details the components' interactions and dependencies:

```mermaid
flowchart TD
    subgraph Client ["Client Tier (PWA)"]
        pwa["PWA Client"]
        s3_put["Direct-to-S3 Upload"]
    end

    subgraph Internal ["Internal Packages (Go Server)"]
        direction TB
        api["api (REST & WebSocket Hub)"]
        analytics["analytics (Privacy Telemetry)"]
        cmd["commands (Pipeline & Idempotency)"]
        rules["rules (Pure Domain Logic)"]
        proj["projections (Read-Model Builder)"]
        eventsvc["eventstore (Append-Only Log)"]
        scheduler["scheduler (Scoring & Timeouts)"]
        geo["geo (Geographic & PostGIS Math)"]
        db["db (Postgres Pool & Migrator)"]
        blob["blobstore (Presigner & Fetcher)"]
        jobs["jobs (Outbox Table Queue)"]
        verify["verification (LLM Worker)"]
        testsupport["testsupport (Isolated Test DBs)"]
    end

    subgraph Storage ["Storage Tier"]
        pg[("PostgreSQL + PostGIS")]
        minio[("MinIO / S3 Storage")]
    end

    subgraph LLM ["External LLM API"]
        scw["Scaleway API"]
    end

    %% Client and external interactions
    pwa -->|REST & Telemetry Requests| api
    pwa -.->|WebSocket Delta Streams| api
    pwa -->|Presigned Upload| s3_put
    s3_put -->|Upload bytes| minio
    
    %% API Command & Telemetry Flow
    api -->|1. Process Command| cmd
    api -->|Sanitize Events| analytics
    analytics -->|Store Telemetry| pg
    scheduler -->|Periodic Command| cmd
    
    %% Command execution pipeline
    cmd -->|2. Check Rules| rules
    rules -->|3. Geo Math| geo
    cmd -->|4. Append Events| eventsvc
    cmd -->|5. Queue Worker Job| jobs
    
    %% Projections
    eventsvc -->|Replay Log| proj
    proj -.->|Publish Updates| api
    
    %% Worker flow
    verify -->|Poll Job outbox| pg
    verify -->|Download Photo| blob
    blob -->|GET Image| minio
    verify -->|Verify Image & Rubric| scw
    verify -->|Submit Verdict Command| api
    
    %% DB layer & Test isolation
    eventsvc --- pg
    proj --- pg
    jobs --- pg
    db --- pg
    testsupport -.->|Provision Isolated Test DBs| pg
```

---

## Design Principles & Patterns

1. **State Machine Purity**:
   The `rules` engine is a pure function of state, command, ruleset, and time:
   `RulesEngine(currentProjection, command, ruleset, clock) -> (events, error)`
   It performs no file I/O, database queries, clock reads, or random number generation. This ensures that the engine is highly testable and deterministic.

2. **Command/Event Separation**:
   Mutating actions must never be written directly to the database or intermediate projections. Mutating requests must undergo the full verification loop by submitting a command to the REST API, validating it in the rules engine, and appending it to the Event Store. The projection builder is the sole updater of read state.

3. **Direct-to-Object-Storage Uploads**:
   Heavy assets (like photographic evidence) do not transit the game server. The client requests a presigned URL via the REST API (generated by `internal/blobstore`), uploads the image directly to MinIO/S3, and sends only the metadata and a `blob_ref` to the API.

4. **Self-Contained SQL Migration (Embedded)**:
   The `internal/db` package embeds the database schema using Go's `//go:embed` directive and automatically performs migrations on pool initialization.

5. **Closed-Vocabulary Privacy & Telemetry (`internal/analytics`)**:
   All recorded telemetry must be processed through `internal/analytics`, which strictly prohibits free-form string properties, enforces an allowlist of event names and enum properties, and automatically buckets numeric values to guarantee zero PII or free text storage.

6. **Defense in Depth & Security Controls**:
   - **Capability Token Auth**: Host capability tokens are hashed at rest (`api/auth.go`), while join tokens are validated via capability checks.
   - **SSRF Hardening**: Object keys in `internal/blobstore` are strictly validated before issuance or retrieval.
   - **Real-IP & Rate Limiting**: Request origins are resolved via `internal/api/realip.go` and rate-limited via `internal/api/ratelimit.go`.
   - **Automated Retention**: Retention sweeps (`internal/api/retention.go`) clean up old data, deleting blob storage objects before database row removal.

---

## Testing Guidelines

Each package houses corresponding Go tests (e.g., `engine_test.go`, `projections_test.go`, `analytics_test.go`).
- Run all tests within the internal folder using:
  ```bash
  go test -v ./internal/...
  ```
- Automated database test isolation is managed via `internal/testsupport`, which provisions isolated test databases (`runway_test_<pkg>`) to ensure clean state and avoid lock contention during parallel package runs.
- Because package logic in `internal/rules` is a pure function of state, complex game mechanics (such as GPS reachability, boundary severing, and score recalculations) are verified with zero external database dependencies.


