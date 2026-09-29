---
name: Departure
colors:
  primitives:
    navy-900: '#101A24'
    navy-800: '#182533'
    navy-700: '#202F40'
    navy-600: '#2B3D50'
    navy-500: '#3C5064'
    navy-450: '#465A6E'
    navy-400: '#5A6E82'
    navy-300: '#8794A2'
    navy-250: '#A3AEBA'
    navy-200: '#B9C2CB'
    navy-100: '#DCE1E6'
    navy-050: '#EFF2F4'
    amber: '#FFBF40'
    amber-deep: '#E5A21F'
    amber-text: '#8A5B08'
    orange: '#F57A3C'
    red: '#EB3539'
    ember: '#C0272D'
    indigo-700: '#372DA8'
    indigo-600: '#4338CA'
    indigo-300: '#A5A0EE'
    indigo-100: '#DDDBF8'
    indigo-050: '#EEEDFB'
    moss: '#4E7A52'
    moss-bright: '#86B98C'
    cream: '#FCFBF9'
    cream-2: '#F6F3EE'
    signal: '#F0F0F0'
    line-light: '#E5E5E5'
  semantics:
    terminal:
      surface: 'var(--cream)'
      surface-2: 'var(--cream-2)'
      surface-inverse: 'var(--navy-700)'
      ink: 'var(--navy-700)'
      ink-strong: 'var(--navy-900)'
      ink-muted: 'var(--navy-450)'
      ink-inverse: 'var(--signal)'
      line: 'var(--line-light)'
      line-strong: 'var(--navy-200)'
      accent: 'var(--indigo-600)'
      accent-hover: 'var(--indigo-700)'
      accent-wash: 'var(--indigo-050)'
      focus: 'var(--indigo-600)'
      danger-text: 'var(--ember)'
      warn-text: 'var(--amber-text)'
      scrim: 'rgba(16, 26, 36, .72)'
      shadow-soft: '0 1px 2px rgba(0, 0, 0, .08)'
      on-accent: '#FFFFFF'
      moss: '#4E7A52'
    night:
      surface: 'var(--navy-900)'
      surface-2: 'var(--navy-800)'
      surface-inverse: 'var(--signal)'
      ink: 'var(--signal)'
      ink-strong: '#FFFFFF'
      ink-muted: 'var(--navy-250)'
      ink-inverse: 'var(--navy-900)'
      line: 'rgba(240, 240, 240, .14)'
      line-strong: 'rgba(240, 240, 240, .42)'
      accent: 'var(--indigo-300)'
      accent-hover: '#C4C1F4'
      accent-wash: 'rgba(165, 160, 238, .12)'
      focus: 'var(--indigo-300)'
      danger-text: '#FF8A8D'
      warn-text: 'var(--amber)'
      scrim: 'rgba(0, 0, 0, .72)'
      shadow-soft: '0 1px 2px rgba(0, 0, 0, .40)'
      on-accent: 'var(--navy-900)'
      moss: 'var(--moss-bright)'
radii:
  r-xs: '2px'
  r-sm: '6px'
  r-md: '12px'
  r-lg: '20px'
  r-xl: '32px'
  r-pill: '999px'
font-scale:
  fs-1: '12px'
  fs-2: '12px'
  fs-3: '13px'
  fs-4: '14px'
  fs-5: '15px'
  fs-6: '16px'
  fs-7: '18px'
  fs-8: '20px'
  fs-9: '24px'
  fs-10: '32px'
  fs-11: '40px'
  fs-label: 'var(--fs-2)'
  fs-data: 'var(--fs-4)'
  fs-body: 'var(--fs-6)'
  fs-d-md: 'clamp(1.8rem, 3.6vw, 2.75rem)'
  fs-d-lg: 'clamp(2.4rem, 6.5vw, 5rem)'
  fs-d-hero: 'clamp(3.2rem, 11vw, 10rem)'
  fs-stat: 'clamp(1.8rem, 3vw, 2.4rem)'
  fs-lead: 'clamp(1.05rem, 1.6vw, 1.3rem)'
  fs-glance-clock: 'clamp(2.5rem, 12vw, 3.5rem)'
  fs-glance-distance: 'clamp(2.25rem, 10vw, 3rem)'
  fs-glance-coin: 'clamp(1.5rem, 6vw, 2rem)'
  ls-label: '.14em'
  ls-label-tight: '.08em'
spacing:
  base: '4px'
  sp-q: '2px'
  sp-h: '6px'
  sp-1: '4px'
  sp-2: '8px'
  sp-3: '12px'
  sp-4: '16px'
  sp-5: '24px'
  sp-6: '32px'
  sp-7: '48px'
  sp-8: '64px'
  sp-9: '96px'
  sp-10: '128px'
  sp-11: '160px'
  page-pad: '16px, 32px from 48rem'
  wrap: '1320px (desktop ceiling only)'
  wrap-content: '62.5rem'
  wrap-narrow: '33.75rem'
  measure: '68ch'
  rail: '180px (desktop nav rail, 48rem and up)'
sizing:
  min-tap-target: '48px'
  tap-large: '56px'
  tap-compact: '32px (pointer: fine only)'
  bottomnav-h: '72px'
  safe-top: 'env(safe-area-inset-top)'
  safe-bottom: 'env(safe-area-inset-bottom)'
motion:
  dur-1: '120ms'
  dur-2: '220ms'
  dur-3: '400ms'
  dur-4: '700ms'
  dur-5: '1000ms'
  ease-premium: 'cubic-bezier(.22,1,.36,1)'
  ease-exit: 'cubic-bezier(.4,0,1,1)'
z-index:
  z-sticky: '40'
  z-shell: '50'
  z-modal: '100'
  z-toast: '120'
breakpoints:
  sm: '40rem'
  md: '48rem'
  lg: '64rem'
cascade-layers: 'vendor, base, tokens, components, utilities, surfaces'
---

## Brand & Style

The design system embodies a "Travel-Sophisticated" personality, blending the high-stakes energy of a broadcast game show with the structured utilitarianism of aviation wayfinding. It is designed for "Skimmability under pressure," catering to a target audience that demands information-dense data presented with editorial flair.

The visual style is **Corporate / Modern** with a distinct **Tactile** edge. It utilizes travel metaphors—boarding passes, flight paths, and transit signage—to structure information. The aesthetic balances deep, reliable "Navy" tones with a vibrant "Sunset" palette, creating a "Broadcast Editorial" atmosphere that feels both professional and adventurous. Key brand identifiers include "Sticker" elements with slight rotations and the "Sunset Arc" motif.

## Colors

The design system employs a sophisticated dual-theme strategy: **Terminal** (Light Mode) and **Night Flight** (Dark Mode).

- **Terminal (Default):** Uses `--cream` for the primary surface and `--navy-700` for primary ink.
- **Night Flight:** Flips to `--navy-900` for surfaces and `--signal` for ink.
- **Interactivity:** Uses "Beacon Indigo," shifting from `--indigo-600` in light mode to `--indigo-300` in dark mode to maintain a 5.7:1 contrast ratio.
- **Brand Core:** The "Sunset" arc colors (`--red`, `--orange`, `--amber`) are immutable across themes to ensure consistent brand identity.
- **Selection:** Text selection must use an `--amber` background with `--navy-900` text.
- **Sunlight mode:** A third, high-contrast variant of each theme for use outdoors. See [Field](#field-mobile-first-rules).

## Typography

The system uses a four-voice typographic hierarchy:
1. **Announce (Archivo Black):** High-impact shouting text. Use for hero titles and season plates.
2. **Narrate (Playfair Display):** Editorial voice. Reserved for pull quotes and episode intros.
3. **UI (Inter):** Functional interface voice. The "Quality Floor" for all body copy, constrained to a `68ch` measure for readability.
4. **Data/Label (JetBrains Mono):** Utilitarian voice. Used for technical metrics, coordinates, and small metadata labels with tracking (`--ls-label`, `.14em`; `--ls-label-tight`, `.08em`). Tracking was eased from the original `.24em`-`.30em` so small caps stay legible in sunlight.

Always implement `font-variant-numeric: tabular-nums` for Data roles to ensure alignment in flight boards and clocks.

## Layout & Spacing

The design system is built on a strict **4px base grid** and is **mobile-first**: base styles describe the phone layout, and wider screens add rules inside `@media (min-width: 48rem)`. Layouts are fluid with a `--page-pad` gutter (16px on phones, 32px from `48rem` up); the `1320px` `--wrap` is only a desktop ceiling on `.page-shell__main`, never a target width.

- **The Rail:** On desktop (`48rem` and up) `Rail` is a fixed `180px` navigation sidebar rendered by `PageShell` when `navPlacement` is `rail` (the default). It holds the brand, the primary destinations, a host call to action and the theme toggle. It is not a metadata column and it does not reflow into a horizontal bar: below `48rem` it is hidden (`display: none`) and navigation moves to `BottomNav` plus the header menu. Surfaces that set `navPlacement="topbar"` render no Rail at all.
- **Measure:** Prose content must never exceed a `68ch` width to preserve reading rhythm.
- **Vertical Rhythm:** Use `--sp-8` through `--sp-11` for large section breathing room on desktop; phones use `--sp-4` through `--sp-6`.
- **Responsive:** Display typography uses CSS `clamp()` for fluid scaling. Grid minimums use `min(18rem, 100%)` so nothing overflows at 320px.

## Elevation & Depth

Depth in this design system is "earned, not given." The baseline is flat, using **Low-contrast outlines** (1px hairlines) to define basic boundaries.

- **Tonal Layers:** Surfaces use `--cream-2` (Light) or `--navy-800` (Dark) to create containment without shadows.
- **Shadows:** Only used to signal state or high-altitude overlays. 
    - **Hover:** A large, soft "Indigo Glow" (`48px` blur) is applied to interactive cards, only where a real hover exists (`@media (hover: hover)`). Touch gets a pressed state instead.
    - **Modals:** A heavy, deep-drop shadow (`80px` blur) represents maximum elevation.
- **Atmospheric Depth:** "Hero" sections utilize semi-transparent mesh gradients (10-16% opacity) using Indigo and Orange to create a sense of environmental light.

## Shapes

The shape language combines utility with high-brand geometric markers.

- **The Plate:** A specific component shape featuring `--r-lg` (20px) corners and a 4px inset border.
- **Stickers:** Small rectangular containers for tags, rotated at `-3.5deg` (Amber) or `+2.5deg` (Red) to mimic physical adhesive labels.
- **Focus States:** A 3px solid `--focus` outline with a 3px offset.

## Components

- **Buttons:** Fully pill-shaped (`--r-pill`; icon-only buttons use `--r-sm`). Use `--accent` (Indigo) for primary actions. Transitions use `--ease-premium` at `--dur-2` (220ms); the pressed state (`:active`) drops to `--dur-1` (120ms) so it responds instantly.
- **Chips & Tags:** Use `--r-pill` for standard tags and `--r-xs` (2px) for "Sticker" style labels. Sticker tags must include the signature rotation.
- **Cards:** Defined by a 1px hairline border (`--line-strong`) on `--surface-2`. Interactive cards lift with the "Indigo Glow" shadow on hover (hover-capable devices only, `--dur-3`, 400ms) and press in (`scale(.985)`, `--dur-1`) on `:active`.
- **Input Fields:** Use `--r-sm` (6px) for a more structured, utilitarian feel.
- **Arc Dividers:** Custom triple-banded SVG waves (Red/Orange/Amber) used to separate major page sections, mimicking flight paths.
- **Split-Flap Tiles:** Used for countdowns or dynamic data, using `--r-xs` corners and `JetBrains Mono` typography.
- **Icons:** One system: the `Icon` component, wayfinding style, 24-unit grid with a `2.2` stroke, drawn in `currentColor`. Icons should not stand alone without a text label or an accessible name (`IconButton` requires `label`; `Icon` takes an optional `label`).

## The Component API Contract

Every surface composes `src/design-system/`, imported through the barrel (`@ds`). The prop shapes below are **frozen** — `frontend/eslint.adherence.config.js` errors on any other prop appearing on these elements. Adding a prop means editing that config deliberately, not incidentally.

| Component | Props |
| :-- | :-- |
| `Button` | `variant` (`primary\|secondary\|ghost`), `size` (`sm\|md\|lg`), `icon`, `disabled`, `children`, `onClick`, `title` |
| `IconButton` | `icon`, `label`, `variant`, `size`, `onClick` |
| `Icon` | `name` (`IconName`), `size` (`sm\|md\|lg`), `label` |
| `Card` | `interactive`, `children`, `style` |
| `Badge` | `tone` (`gold\|rust\|moss\|crimson\|neutral`), `children` |
| `Tag` | `children`, `onRemove` |
| `Input` | `label`, `hint`, `error`, `type`, `placeholder`, `value`, `onChange`, `onKeyDown`, `readOnly`, `disabled`, `maxLength`, `id`, `inputMode`, `autoCapitalize`, `autoComplete`, `autoCorrect`, `spellCheck`, `enterKeyHint`, `autoFocus` |
| `Select` | `label`, `hint`, `value`, `onChange`, `children` |
| `Checkbox` / `Switch` | `label`, `checked`, `onChange` |
| `Radio` | `name`, `label`, `checked`, `onChange` |
| `Tabs` | `items`, `active`, `onChange` |
| `Dialog` | `open`, `presentation` (`center\|sheet\|fullscreen`), `title`, `children`, `onClose` |
| `Sheet` | `snap`, `defaultSnap` (`collapsed\|peek\|expanded`), `onSnapChange`, `onSettle`, `summary`, `children`, `label`, `peekRatio`, `expandedRatio` |
| `ConfirmSheet` | `open`, `title`, `children`, `confirmLabel`, `cancelLabel`, `danger`, `hideCancel`, `onConfirm`, `onCancel` |
| `ActionBar` | `position` (`sticky\|fixed`), `children` |
| `Toast` | `tone`, `children` |
| `ToastRegion` | `position` (`top\|bottom`) |
| `Tooltip` | `label`, `children` |
| `Skeleton` | `variant` (`text\|block\|circle`), `lines`, `width`, `height`, `label` |
| `Progress` | `value`, `max`, `label`, `valueText`, `variant` (`bar\|sunset\|arc`) |
| `Clock` | `seconds`, `flap`, `size` (`md\|lg\|xl`), `caption`, `ariaLabel` |
| `BrandMark` | `size` (`sm\|md\|lg`), `iconOnly` |
| `PageHeader` | `title`, `eyebrow`, `onBack`, `backLabel`, `actions`, `brand` |

Consequences worth knowing before you reach for one:

- `Button` has no `type` — it is always `type="button"`. A submit control needs its own wrapper.
- `Button` has no `href`. Link-styled navigation belongs in an unlinted `LinkButton`, not here.
- `Card` has no `onClick`. `interactive` is a visual affordance only; put the click on a child `Button`. This is better a11y, not a workaround.
- `Dialog` derives `aria-label` from `title`, traps focus, closes on `Escape` and scrim click, locks the scrolling ancestor, and stays clear of the safe-area insets. Its `presentation` picks the shape; see [Field](#field-mobile-first-rules).
- Imperative helpers are not components and are not roster-linted: `showToast` / `dismissToast` / `useToast` (toast store), `useConfirm` and `useAlert` (promise-returning confirmation), and the pure `sheetSnap` helpers.

Components outside the lint roster define their own prop shapes:

- **Brand motifs:** `Sticker`, `Plate`, `Hero`, `Stat`, `Flap` (split-flap tiles), `ArcMark` (the Sunset Arc), `BrandLines`, `RouteGlobe`.
- **Forms:** `Textarea`.
- **Game vocabulary:** `Chip`, `Callout` — see the tone table below.
- **Content blocks:** `Notice`, `Empty`, `Board` (standings table).
- **Navigation:** `Rail` (desktop only), `BottomNav` (phones only).
- **Escape hatches:** `LinkButton` (real anchor, accepts `href`/`title`/`aria-label`), `Omnisearch`.

`LinkButton` exists precisely because `Button` is frozen without `href`. Reach for it rather than widening the roster — an icon-only control is an `IconButton` (its `label` becomes both `aria-label` and the tooltip), and explanatory hover text is a `Tooltip` wrapping the control.

### Retired components

`Pass` (boarding pass), `Hex`, `Pin`, `Infobox`, `CardRail`, `Grid`, and the old `SiteIcons` set are gone. Do not reintroduce them; use `Card`, `Notice` or `Callout` for content blocks, CSS `grid` with `min(18rem, 100%)` minimums for layout, and `Icon` for every glyph.

## Tone vs. Game Vocabulary

Two vocabularies coexist deliberately, and **must not be reconciled**.

`Badge` and `Toast` take a generic `tone` from a frozen five-value enum, backed by `--tone-{name}-{ink,edge,wash}` triplets:

| tone | binding | game meaning |
| :-- | :-- | :-- |
| `crimson` | `--danger-text` / `--red` | curse, live, blocked, error |
| `gold` | `--warn-text` / `--amber-deep` | power-up, coins, bypassed |
| `rust` | `--orange` | roadblock, warning, draft |
| `moss` | `--moss` | open, reachable, validated, start |
| `neutral` | `--ink-muted` / `--line-strong` | veto, idle, unclaimed |

`Chip` and `Callout` keep the game vocabulary verbatim (`kind="curse|power|challenge|veto|live"` and `kind="rule|curse|power|veto"`). `chip--challenge` and `callout--rule` are indigo and have no tone equivalent. **Do not extend the tone enum to accommodate them** — they are semantics, not colors.

> **Open decision (for the project owner, not yet acted on).** The rule above stands as written. This note records a concern raised in the mobile design review and changes nothing until you decide.
>
> Status is currently expressed by about eight overlapping components, each with its own vocabulary:
>
> | Component | Vocabulary |
> | :-- | :-- |
> | `Badge` | `tone`: gold, rust, moss, crimson, neutral |
> | `Toast` (and `ToastRegion` items) | the same five `tone` values |
> | `Chip` | `kind`: curse, power, challenge, veto, live (open-ended string) |
> | `Callout` | `kind`: rule, curse, power, veto (open-ended string) |
> | `Notice` | `kind`: info, warn, stop |
> | `Sticker` | `tone`: amber, red |
> | `Stat` | `tone`: hot, warm, bright |
> | `Tag` | renders as a `chip` with no status meaning |
>
> Beyond these, team slots (`--team-*`) and map states (`--map-waypoint-*`, `--map-road-*`) carry their own colour meanings. The same game state (a curse, a warning, a blocked road) can therefore appear as a crimson Badge, a `chip--curse`, a `callout--curse` and a `notice--stop`, with different colours and shapes. Players outdoors cannot reliably tell these apart at a glance, and each new state needs a decision in up to five places.
>
> **Recommendation:** reconsider the "must not be reconciled" rule. A likely shape is one status vocabulary (the five tones, plus an indigo `info` tone for the challenge and rule semantics) shared by `Badge`, `Chip`, `Callout`, `Notice` and `Toast`, with `Sticker` and `Stat` kept as brand motifs that do not carry status. The alternative is to keep the split and add a written mapping table from every game state to exactly one component. Either way, decide before adding further status components.

### Verified contrast

Ratios are WCAG relative-luminance values against the shipped tokens, alpha-composited over `--surface` where translucent. The `--ink-muted` rows were recomputed after the token change to `--navy-450` / `--navy-250`; the other rows are unchanged tokens from the earlier in-page measurement.

| pair | Terminal | Night Flight |
| :-- | :-- | :-- |
| `--ink` on `--surface` | 13.17 | 15.42 |
| `--ink-muted` on `--surface` | 6.89 | 7.80 |
| `--ink-muted` on `--surface-2` | 6.44 | 6.90 |
| `--accent` on `--surface` | 7.64 | 7.41 |
| `--on-accent` on `--accent` | 7.90 | 7.41 |
| `--moss` on `--surface` | 4.80 | 7.81 |
| worst `--tone-*-ink` on its own `-wash` | 4.68 (crimson) | 6.37 (crimson) |

All clear WCAG AA (4.5:1). Sunlight mode (below) raises them further: on Terminal `--ink` 16.99, `--ink-muted` 10.77 and `--accent` 9.65; on Night Flight `--ink-muted` 13.35 and `--accent` 10.28. Re-run the check after any token change — `tokens.css` records that `#4338CA` is 2.2:1 on navy-900, so this palette has a history.

## Sub-grid Steps

The 4px grid is the rule. Exactly two exceptions are sanctioned, and stylelint enforces that everything else outside `tokens.css` goes through a token:

- `--sp-q: 2px` — micro-gaps inside dense components (`.stat`, `.flap`, `.hero__stat`, `.notice`) where a full 4px step reads as a gutter.
- `--sp-h: 6px` — control padding and field gaps that genuinely sit off-grid.

Do not add a third.

## Breakpoints

Mobile-first, in `rem` so they follow the user's font size. The one structural split is **`48rem`** (768px at the default size): base rules are the phone layout, and `@media (min-width: 48rem)` adds the tablet and desktop layout. Phone-only overrides use the exact complement, `@media (width < 48rem)`, so the two sets never both apply at any width.

Two secondary stops exist and are used sparingly: `40rem` (a small step, currently the race report) and `64rem` (wide desktop, currently the host console). Do not add another; a stop between them produces a dead zone where the Rail has appeared but the grids have not yet collapsed. JS mirrors the same values in `core/ui/useIsDesktop.ts` (`DESKTOP_QUERY`, `MOBILE_QUERY`). Never write `max-width` breakpoints in `px`.

## Field (mobile-first rules)

Runway is played outdoors, on a phone, in sunlight, mostly while walking. These rules are binding for every screen, and the race, capture and lobby screens are where they matter most. `frontend/README.md` carries the same conventions from the implementation side.

### Touch

- **Tap targets are 48px.** Every interactive control is at least `--min-tap-target` (48px) in both dimensions; primary actions use `--tap-large` (56px, `Button size="lg"`). Icon-only buttons are at least 48px square on touch at every size.
- **Compact sizes are for precise pointers only.** `--tap-compact` (32px) and the smaller icon-button and tab sizes apply solely inside `@media (pointer: fine)`. Never size a control below 48px outside that query.
- **Pressed states are required.** Every tappable element has an `:active` state (a 1px press, a `scale(.98)` or a wash) at `--dur-1`. Touch has no hover, so the pressed state is the feedback.
- **Hover only where it exists.** Hover styling (glows, lifts, colour shifts) goes inside `@media (hover: hover)` so it never sticks after a tap.
- **Zoom is allowed.** Never set `user-scalable=no` or a maximum scale. Text inputs are at least 16px so iOS does not zoom on focus.
- **Animate `transform` and `opacity`** (plus colour). No `transition: all`, no animated `box-shadow` pulses, and drag interactions move with `transform`.

### Type floor

- **Nothing renders under 12px.** `--fs-1` and `--fs-2` are both 12px; the scale is `--fs-1` to `--fs-11` (12, 12, 13, 14, 15, 16, 18, 20, 24, 32, 40). Labels use `--fs-label` (12px), data uses `--fs-data`, body copy uses `--fs-body` (16px).
- **Glance sizes** are for numbers read at arm's length while walking: `--fs-glance-clock`, `--fs-glance-distance` and `--fs-glance-coin` (also `.fs-glance-*` classes, and `Clock size="lg|xl"`). Use them for the clock, the distance to the target and the coin count, not for prose.
- **Every `font-size` is a token.** Use `var(--fs-*)`; the only other allowed values are `inherit` and relative `em`/`%`. No raw `px` or `rem` font sizes.

### Sunlight mode

- Set `data-contrast="high"` on `<html>` to force it, or `data-contrast="normal"` to opt out; without the attribute it follows `@media (prefers-contrast: more)`.
- It is defined in `tokens.css` for both themes: darker ink and muted ink, stronger `--line` and `--line-strong`, a deeper `--accent` (Terminal) or paler `--accent` (Night Flight), and darker warn and moss text. It never changes the Sunset brand colours.
- `color-scheme` is set per theme (`light`, `dark`) so native controls and scrollbars follow.
- Never hard-code colours that bypass the tokens; sunlight mode only works if everything reads `--ink`, `--line`, `--accent` and friends.

### Sheets and dialogs

- **`Sheet`** is the bottom panel for persistent, glanceable content such as the race console. It has three snap states: `collapsed` (only the handle and the `summary` strip show), `peek` (about 52% of the viewport by default, `peekRatio`) and `expanded` (about 92%, `expandedRatio`). The `summary` strip is always visible, so put the primary action, target and clock there, never behind the handle. It drags with `transform`, snaps by release velocity, supports the Arrow keys on the handle, and collapsed content is `inert`.
- **`Dialog`** has three presentations. `center` is the default card. `sheet` docks to the bottom edge with a grabber, rounded top corners and safe-area bottom padding, and suits anything short on a phone. `fullscreen` fills the screen for capture and shop flows. Heights use `dvh` (with a `vh` fallback) so browser chrome cannot clip them. Do not build new modal variants with ad-hoc `dialog--*` classes.
- **`ConfirmSheet` replaces `alert()` and `window.confirm()`.** Never call the native functions. Use `useConfirm()` (resolves `true` on confirm, `false` on cancel, dismiss or `Escape`) and `useAlert()` (resolves once acknowledged); both render a bottom sheet with two full-width, thumb-sized buttons through the single `ConfirmProvider` mounted at the app root. Set `danger` for destructive actions such as leaving a race. Outside a provider (tests) `useConfirm` falls back to the native dialog.

### Action bar and safe areas

- **`ActionBar`** holds a screen's primary actions at the bottom edge: full-width buttons in a row, padded by `--safe-bottom`, with left and right padding of at least the device's side insets. `position="sticky"` sits at the foot of its scroll parent; `"fixed"` pins to the viewport above the shell layer.
- **Safe-area tokens:** `--safe-top` and `--safe-bottom` wrap `env(safe-area-inset-*)`. Anything fixed to a screen edge must add them: top bars and toasts add `--safe-top`; bottom bars, sheets and dialogs add `--safe-bottom`. The viewport meta uses `viewport-fit=cover`, and the shell pads the body by the side insets so landscape notches do not clip content.
- **Phone chrome:** `BottomNav` is `--bottomnav-h` (72px) plus the bottom inset, and page content reserves that space. Immersive routes (the live race and lobby) render no bottom navigation, so the map and the action area are not competing with ways out of the game.
- **Standalone shell:** `overscroll-behavior: none` on the root stops pull-to-refresh in the installed app.

### Toasts

- `ToastRegion` is mounted once at the app root with `position="top"`, so toasts never cover bottom actions. Raise them with `showToast(message, { tone, duration })` or `useToast()`; do not render `Toast` inline for transient feedback.
- It auto-dismisses (4 seconds by default, `duration: 0` keeps it), shows at most three, and each has a 48px dismiss button. Neutral, gold and moss toasts announce politely (`role="status"`); `crimson` and `rust` announce assertively (`role="alert"`).

### Layers and CSS loading

- **Cascade order** is declared once in `src/styles/layers.css`: `vendor, base, tokens, components, utilities, surfaces`. A later layer beats an earlier one regardless of specificity, and unlayered rules beat every layer. Every stylesheet wraps its rules in the matching `@layer` block; MapLibre's stylesheet is imported into `vendor`.
- **Global sheets only in `main.tsx`:** `layers.css`, `fonts.css`, `tokens.css`, `app-tokens.css`, `components.css`, `ds-components.css`, `ds-mobile.css`, `shells.css`, `index.css`, `pwa-shell.css`. Anything that belongs to one screen or one component lives beside it and is imported by that module (`surfaces/host/host-console.css`, `core/map/map.css`, `design-system/primitives/icons.css`), so the desktop-only editor styles never reach a phone. New styles never go into the global sheets.

### Icons

- **One icon system.** `Icon` renders the shapes in `iconShapes.ts` on a 24-unit grid with a `2.2` stroke in `currentColor`, sized by `size` (`sm|md|lg`) or the surrounding font size. Add a glyph by adding a named entry to `ICON_SHAPES`; do not add inline SVG icon sets or a second icon component.
- **No emoji as icons.** `iconEmoji.ts` maps emoji found in content data to icon names for display; new UI uses `Icon` directly. Coloured emoji look different on every OS and wash out in sunlight.

### Tokens and guardrails

- **Tokens come from CSS.** `tokens.css` and `app-tokens.css` are the source. `src/design-system/theme/tokens.generated.ts` (the `TOKEN_FALLBACKS` mirror used by `tokenReader` and the browser theme colour) is generated by `npm run tokens` and never hand-edited; `npm run tokens:check` fails when it is stale and runs as part of `npm run lint`. After changing any colour token, run `npm run tokens` and commit the result.
- **Stylelint** (`.stylelintrc.json`) rejects raw hex, px of 2 or more in `margin`, `padding`, `gap`, `inset`, `top`/`right`/`bottom`/`left` and `border-radius`, border and outline widths above 3px, and any `font-size` that is not a token, `inherit`, or relative `em`/`%`. `tokens.css` is exempt.
- **ESLint** (`eslint.adherence.config.js`) rejects raw hex and raw `px` literals in `src/**`, number-valued inline styles (unitless properties such as `opacity`, `zIndex`, `flex` and `lineHeight` are exempt), raw inline `fontSize`, fonts outside the four voices, and any prop outside the frozen roster above. `tokens.generated.ts` is the only file exempt from the hex rule.
- Run `npm run lint` after every frontend change; it fails on warnings.
