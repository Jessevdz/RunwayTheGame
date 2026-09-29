# Runway Frontend

This directory contains the Progressive Web App (PWA) client for **Runway**.

---

## 🏗️ Architecture & Project Structure

The codebase is organized into modular directories reflecting surfaces, domain core logic, and design primitives:

```
frontend/src/
├── surfaces/         # View surfaces & routed page components
│   ├── landing/      # Home / landing page & draft manager
│   ├── editor/       # Interactive living map editor
│   ├── gallery/      # Public map discovery gallery
│   ├── host/         # Multiplayer game host launcher, lobby & GM tools
│   ├── player/       # Mobile player PWA console, capture flow & shop
│   ├── races/        # User race history & active sessions ("My Races")
│   ├── race/         # Live race participant shell & legacy redirects
│   ├── report/       # Post-race leaderboards & summary statistics
│   ├── solo/         # Single-player time trial launcher
│   ├── roadmap/      # Feature roadmap & feedback surface
│   ├── admin/        # System administration & telemetry console
│   └── shared/       # Shared chrome: page shell, top bar, global bug reporter
├── core/             # Application core domain logic & infrastructure
│   ├── analytics/    # Telemetry & surface event tracking
│   ├── api/          # HTTP API client & WebSocket connections
│   ├── diagnostics/  # Client error ring, playtest gate & bug-report context
│   ├── editor/       # Map editing state machine & geometric operations
│   ├── format/       # Time, coordinate, and metric formatting helpers
│   ├── game/         # Game engine state management & rules
│   ├── hooks/        # Core React hooks (connection, timers, viewport)
│   ├── map/          # MapLibre GL integrations & tile rendering
│   ├── player/       # GPS tracking & location smoothing
│   ├── projection/   # Client-side projection store & delta reconciliation
│   ├── pwa/          # Service worker registration & offline cache
│   ├── team/         # Team color, slot, and roster management
│   ├── ui/           # Notification toasts & UI utility helpers
│   └── util/         # Common pure utilities (math, string, array)
├── design-system/    # "Departure" component library & design primitives (@ds alias)
│   └── __gallery__/  # Visual component testbed (`/design-system` in DEV mode)
└── styles/           # Global CSS only: layer order, tokens, design-system and shell rules (`layers.css`, `tokens.css`, `app-tokens.css`)
```

---

## 🚀 Application Surfaces & Routing

The application features multiple surfaces connected via React Router:

*   **`/` — Landing Page (`LandingPage.tsx`):** The app's front door. Includes hero section, map creation CTA, local draft manager ("My Maps"), public gallery showcase, and quick launch shortcuts.
*   **`/design` & `/design/:mapId` — Living Map Editor (`DesignView.tsx`):** Interactive authoring environment for creating and modifying maps. Supports capability-based login-less editing via secret `edit_token`, auto-save, route calculation, point-of-interest markers, map forking, and share links.
*   **`/gallery` — Public Map Gallery (`GalleryPage.tsx`):** Community browser for exploring public route maps and cloning them into editable drafts.
*   **`/races` — My Races (`MyRacesPage.tsx`):** Dashboard for viewing past race participation, active host sessions, and saved race records.
*   **`/host` & `/host/:gameId` — Host Launcher & Lobby (`PlayLauncher.tsx`, `GameLobby.tsx`):** Multiplayer lobby creator and lobby management interface for configuring race settings and managing connected players.
*   **`/join/:gameId` — Join Race Lobby:** Player entry point into host-created game sessions via share code or URL.
*   **`/solo` — Solo Launcher (`SoloLauncher.tsx`):** Single-player mode launcher for running routes independently with real-time GPS tracking.
*   **`/race/:gameId` — Live Race Shell (`RaceShell.tsx`):** Real-time racing interface providing live map navigation, checkpoint validation, team status, and leaderboard updates.
*   **`/race/:gameId/report` — Post-Race Report (`RaceReportPage.tsx`):** Post-game analytics display featuring final standings, split times, and race highlights.
*   **`/roadmap` — Roadmap & Feedback (`RoadmapPage.tsx`):** Community feature roadmap, voting system, and administrative roadmap management. Curation controls appear when the browser holds an admin session.

*   **Bug reporting (`surfaces/shared/BugReporter.tsx`):** Not a surface — a floating button mounted once in `AppRoutes`, so it exists on every route including the race map. Shake the phone or press `Ctrl+Alt+B` for the same dialog. It is hidden unless the browser is marked as a playtester's: open any link with `?playtest=1` once and the flag is ingested into `localStorage` and scrubbed from the address bar, the same hygiene a board `edit_token` gets. Reports carry the route, build stamp, viewport, user-agent, and the last ten JavaScript errors from `core/diagnostics/errorBuffer`, with capability tokens redacted before they leave the device. Triage lives in the `/admin` Bugs tab.
*   **`/admin` — Admin Dashboard (`AdminPage.tsx`):** System metrics, session inspection, and administrative control panel. Sign in with the admin key, which is exchanged for a session cookie; the key itself is never carried on a URL. `/admin/:adminKey` and `?admin_key=` still work for links written before sessions existed — they spend the key on arrival and scrub it from the address bar.
*   **`/play` & `/host/:gameId/live` — Legacy Compatibility Redirects:** Backwards-compatible route handlers ensuring legacy QR codes, bookmarks, and links resolve seamlessly to current surfaces.
*   **`/design-system` — Design System Gallery (`Gallery.tsx`):** Internal component catalog for reviewing design tokens and component states (available in DEV mode).

---

## 🔒 Capability Security & Local Storage Model

Runway implements accountless capability security:

*   **Public Identification:** Map IDs (`mapId`) are public resource identifiers visible to all users.
*   **Edit Token Security:** Authoring capability is gated by a unique per-map `edit_token` UUID.
*   **Local Persistence:** Map creators automatically save `{mapId, editToken, name}` in browser `localStorage` under `runway:maps`.
*   **Collaborative Editing:** Edit capability links transmit the secret token in the URL hash (`/design/:mapId#key=<token>`). Upon loading, the application ingests the token into `localStorage` and immediately purges `#key=...` from the browser URL bar to prevent token leakage via copy/paste or referrers.
*   **Read-Only & Forking:** Visitors accessing a map without an edit token enter read-only mode, with an option to **Fork** the map to create their own editable copy with a fresh `edit_token`.

---

## 🎨 Design System & Aesthetics

The UI implements the authoritative **Departure** design system specified in [`DESIGN.md`](../DESIGN.md):

*   **Design Tokens:** CSS custom properties defined in `src/styles/tokens.css` (`--navy-900`..`--navy-050`, `--amber`, `--orange`, `--red`, `--ember`, `--indigo-700`..`--indigo-050`, `--cream`, `--signal`, `--surface`, `--ink`, etc.).
    *   **Generated mirror:** `src/design-system/theme/tokens.generated.ts` is generated, never hand-edited. `npm run tokens` runs `scripts/generate-tokens.mjs`, which parses the `:root` and `[data-theme="night"]` blocks of `tokens.css` and `app-tokens.css`, resolves every `var()` chain and writes the colour tokens as `TOKEN_FALLBACKS` (light) and `TOKEN_FALLBACKS_NIGHT`; `tokenReader.ts` uses them when the DOM cannot resolve a token (tests, SSR) and `ThemeProvider` reads the `--theme-color-*` entries for the browser chrome. After changing a colour token in either CSS file, run `npm run tokens` and commit the result; `npm run tokens:check` (part of `npm run lint`) fails when the file is stale. The generated file is the only place in `src/**` allowed to contain raw hex.
*   **Typography:** The Departure 4-voice font hierarchy:
    *   **Announce:** `Archivo Black` (`--font-announce`) for headers, plates, and badges.
    *   **Narrate:** `Playfair Display` (`--font-narrate`) for editorial framing and quotes.
    *   **UI:** `Inter` (`--font-ui`) for interface controls, dialogs, and body text.
    *   **Data:** `JetBrains Mono` (`--font-data`) for coordinates, clocks, and numeric telemetry.
*   **Touch Targets:** Outdoor ergonomic standard enforced via `--min-tap-target` (`48px` minimum tap height/width, defined in `src/styles/app-tokens.css`) for reliable touchscreen operation on the move.
*   **CSS Loading & Layers:** `src/main.tsx` imports only the global sheets (`layers.css`, `fonts.css`, `tokens.css`, `app-tokens.css`, `components.css`, `ds-components.css`, `ds-mobile.css`, `shells.css`, `index.css`, `pwa-shell.css`). Everything screen-specific lives next to the code that uses it and is imported by that module, so Vite ships it with the lazy chunk (`surfaces/editor/editor.css` and `editor-pane.css`, `surfaces/host/host-console.css`, `surfaces/report/race-report.css`, `core/map/map.css`, and so on). New screen or component styles go beside the component, never into the global sheets.
    *   `src/styles/layers.css` declares the cascade order once: `vendor, base, tokens, components, utilities, surfaces`. Wrap each sheet's rules in the matching `@layer` block: global sheets use `base`, `tokens`, `components` or `utilities`, and per-surface sheets use `surfaces`. A later layer beats an earlier one regardless of specificity, and unlayered rules beat every layer.
    *   MapLibre's stylesheet is imported from `core/map/map.css` into the `vendor` layer, so it only loads with a map.
*   **Breakpoints:** One convention, in `rem` so it follows the user's font size: phone-first with `@media (min-width: 48rem)` for tablet and desktop (768px at the default size), `40rem` for a small step and `64rem` for wide desktop. Phone-only overrides use the exact complement `@media (width < 48rem)`, so the two sets never both apply. JS mirrors the same values in `core/ui/useIsDesktop.ts` (`DESKTOP_QUERY`, `MOBILE_QUERY`).
*   **Lint guardrails:** Stylelint (`.stylelintrc.json`) rejects raw hex, px of 2 or more in `margin`, `padding`, `gap`, `inset`, `top`/`right`/`bottom`/`left` and `border-radius` (use `--sp-*`, `--sp-q`, `--sp-h`, `--r-*`), border or outline widths above 3px, and any `font-size` that is not `var(--fs-*)` (or another token, `inherit`, or a relative `em`/`%`). The ESLint adherence config (`eslint.adherence.config.js`) rejects number-valued inline styles such as `style={{ width: 12 }}` (unitless properties like `opacity`, `zIndex`, `flex` and `lineHeight` are exempt; pass a token string or use a class) and raw `fontSize` literals. Add new type-scale or sizing values as tokens instead of suppressing the rule.
*   **Hover:** Hover-only styling goes inside `@media (hover: hover)` so it never sticks after a tap; animate `transform` and `opacity` only, never `box-shadow` or `transition: all`.
*   **Component Testing:** Previews available via `/design-system` route when running in development mode.

---

## 🛠️ Development & Build Commands

```bash
# Start Vite development server
npm run dev

# Run TypeScript compilation and build production bundle
npm run build

# Regenerate src/design-system/theme/tokens.generated.ts from the token CSS
npm run tokens

# Run multi-stage code quality check (token drift check + Oxlint + ESLint + Stylelint)
npm run lint

# Run unit & component test suite (Vitest)
npm test

# Run tests in interactive watch mode
npm run test:watch

# Preview production build locally
npm run preview
```

### 📚 Working on Documentation

`npm run dev` serves `/docs` from prebuilt static assets located at `docs-site/dist`. To develop and hot-reload documentation content live:

```bash
# Start Astro dev server for documentation site (runs on http://localhost:4321)
npm run dev:docs
```

To direct in-app documentation links to your live Astro dev server, add the following to `frontend/.env` and restart `npm run dev`:

```env
VITE_DOCS_BASE_URL=http://localhost:4321/docs/
```

To update the static production documentation build served by Vite and packaged into Nginx:

```bash
# Rebuild static documentation site (runs type checks via astro check)
npm run build:docs
```
