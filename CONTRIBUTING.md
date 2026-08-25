# Contributing to Runway

Thanks for wanting to help. Runway is a fan-made, independent project, not
affiliated with, endorsed by, or associated with Jet Lag: The Game, Wendover
Productions, or Half as Interesting. Please keep that true in anything you
contribute: no logos, wordmarks, card art, typography, or transcribed challenge
text from the show or any other copyrighted source.

This project is **alpha**. Rules, data formats, and APIs change without notice.
Expect to rebase.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you write code

**Open an issue first for anything non-trivial.** A typo fix or an obvious bug
can go straight to a PR. A new game mechanic, a schema change, a new surface, or
anything touching scoring should start as a discussion.

If you are looking for somewhere to start, see the issues labelled
`good first issue`.


## Development setup

The full walkthrough is in the [README](README.md#quick-start).


## Running the tests

### Backend

```bash
docker compose up -d db
```

```bash
RUNWAY_REQUIRE_DB=1 go test -count=1 ./cmd/... ./internal/...
```

- **`RUNWAY_REQUIRE_DB=1`** — `internal/testsupport` *skips* database tests when
  Postgres is unreachable, so a plain `go test` with Docker down prints `ok` for
  every package while proving nothing. This variable turns that skip into a
  failure. Leave it unset when you deliberately want to run only the pure logic
  tests with Docker off.
- **`-count=1`** — without it, Go replays cached results, including results from
  an earlier run made while Docker was down.


**Never hand-roll a `db.Config` in a test.** Get a database with
`testsupport.DB(t, "<pkg>")`. Each package gets its own `runway_test_<pkg>`
database, created on first use and truncated at the start of each run.

### Frontend

```bash
cd frontend
npm run lint
npm test
npm run build
```

`lint` chains oxlint (`--deny-warnings`), an ESLint config that enforces design
system adherence, and stylelint.

`npm test` runs the Vitest unit and component test suite (`npm run test:watch` starts the interactive watcher).


### Documentation Site

The public documentation site lives under `docs-site/` (built with Astro & Starlight):

```bash
npm --prefix docs-site run dev     # or `npm run dev:docs` from frontend/
npm --prefix docs-site run build   # or `npm run build:docs` from frontend/
```

## Architectural rules a PR can violate

### The event log is append-only and immutable

Events are the single source of truth and old ones are replayed forever.

- **Never change the meaning of an existing event type.** Add a new one and keep
  handling the old shape in `internal/projections`.
- Never edit or delete rows in the event store to fix state. Append a corrective
  event.
- Commands validate; events record. Anything non-deterministic (clock reads,
  random values, LLM verdicts) is resolved in the command and *written into* the
  event, so a replay years later produces the same result.

### `internal/rules` is pure

No database calls, no HTTP, no clock reads, no I/O. It takes state and inputs and
returns decisions. This is what makes the scoring testable and replayable. Pass anything external in as an argument.

### `DESIGN.md` is binding for UI work

[`DESIGN.md`](DESIGN.md) is the authoritative spec for the "Departure" design
system: colour tokens, the four-voice typography system, the 4px grid, elevation,
shapes, and component patterns. Read it before writing UI.

### Location and photo code deserves extra care

A live race broadcasts every team's GPS position to other participants, and
capture photos are uploaded to object storage and sent to a third-party LLM
provider for grading. If your change affects who can see position data, how long
photos live, or what leaves the device, say so explicitly in the PR description.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE), the same terms that cover the project. Do not contribute
code, text, or assets you do not have the right to relicense — that includes
material from other games, books, or paid courses.
