---
name: Departure
colors:
  primitives:
    navy-900: '#101A24'
    navy-800: '#182533'
    navy-700: '#202F40'
    navy-600: '#2B3D50'
    navy-500: '#3C5064'
    navy-400: '#5A6E82'
    navy-300: '#8794A2'
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
      ink-muted: 'var(--navy-400)'
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
      ink-muted: 'var(--navy-300)'
      ink-inverse: 'var(--navy-900)'
      line: 'rgba(240, 240, 240, .14)'
      line-strong: 'rgba(240, 240, 240, .30)'
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
  fs-1: '9px'
  fs-2: '11px'
  fs-3: '12px'
  fs-4: '13px'
  fs-5: '14px'
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
  wrap: '1320px'
  measure: '68ch'
  rail: '180px'
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
  md: '768px'
  lg: '1024px'
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

## Typography

The system uses a four-voice typographic hierarchy:
1. **Announce (Archivo Black):** High-impact shouting text. Use for hero titles and season plates.
2. **Narrate (Playfair Display):** Editorial voice. Reserved for pull quotes and episode intros.
3. **UI (Inter):** Functional interface voice. The "Quality Floor" for all body copy, constrained to a `68ch` measure for readability.
4. **Data/Label (JetBrains Mono):** Utilitarian voice. Used for technical metrics, coordinates, and small metadata labels with heavy tracking.

Always implement `font-variant-numeric: tabular-nums` for Data roles to ensure alignment in flight boards and clocks.

## Layout & Spacing

The design system is built on a strict **4px base grid**. Layouts follow a **Fixed grid** approach within a `1320px` max-width container. 

- **The Rail:** A signature `180px` fixed-width sticky sidebar is used for metadata and secondary navigation on desktop.
- **Measure:** Prose content must never exceed a `68ch` width to preserve reading rhythm.
- **Vertical Rhythm:** Use `--sp-8` through `--sp-11` for large section breathing room. 
- **Responsive:** Display typography uses CSS `clamp()` for fluid scaling. On mobile, the `180px` Rail reflows to a horizontal metadata bar at the top of content sections.

## Elevation & Depth

Depth in this design system is "earned, not given." The baseline is flat, using **Low-contrast outlines** (1px hairlines) to define basic boundaries.

- **Tonal Layers:** Surfaces use `--cream-2` (Light) or `--navy-800` (Dark) to create containment without shadows.
- **Shadows:** Only used to signal state or high-altitude overlays. 
    - **Hover:** A large, soft "Indigo Glow" (`48px` blur) is applied to interactive cards.
    - **Modals:** A heavy, deep-drop shadow (`80px` blur) represents maximum elevation.
- **Atmospheric Depth:** "Hero" sections utilize semi-transparent mesh gradients (10-16% opacity) using Indigo and Orange to create a sense of environmental light.

## Shapes

The shape language combines utility with high-brand geometric markers.

- **The Plate:** A specific component shape featuring `--r-lg` (20px) corners and a 4px inset border.
- **The Hex:** A pointy-top hexagonal clip-path used for significant status or player indicators.
- **Stickers:** Small rectangular containers for tags, rotated at `-3.5deg` (Amber) or `+2.5deg` (Red) to mimic physical adhesive labels.
- **Focus States:** A 3px solid `--focus` border with a 3px offset.

## Components

- **Buttons:** Fully pill-shaped (`--r-pill`). Use `--accent` (Indigo) for primary actions. Transitions should use `--ease-premium` (400ms) for a sophisticated feel.
- **Chips & Tags:** Use `--r-pill` for standard tags and `--r-xs` (2px) for "Sticker" style labels. Sticker tags must include the signature rotation.
- **Cards:** Defined by a 1px hairline bottom border (`--line`). On hover, cards lift using the "Indigo Glow" shadow and a smooth `220ms` transform.
- **Input Fields:** Use `--r-sm` (6px) for a more structured, utilitarian feel.
- **Arc Dividers:** Custom triple-banded SVG waves (Red/Orange/Amber) used to separate major page sections, mimicking flight paths.
- **Split-Flap Tiles:** Used for countdowns or dynamic data, using `--r-xs` corners and `JetBrains Mono` typography.
- **Icons:** Wayfinding style, 24px grid with a `2.2px` stroke. Icons should never appear without a text label.

## The Component API Contract

Every surface composes `src/design-system/`, imported through the barrel (`@ds`). The prop shapes below are **frozen** — `frontend/eslint.adherence.config.js` errors on any other prop appearing on these elements. Adding a prop means editing that config deliberately, not incidentally.

| Component | Props |
| :-- | :-- |
| `Button` | `variant` (`primary\|secondary\|ghost`), `size` (`sm\|md\|lg`), `icon`, `disabled`, `children`, `onClick`, `title` |
| `IconButton` | `icon`, `label`, `variant`, `size`, `onClick` |
| `Card` | `interactive`, `children`, `style` |
| `Badge` | `tone` (`gold\|rust\|moss\|crimson\|neutral`), `children` |
| `Tag` | `children`, `onRemove` |
| `Input` | `label`, `hint`, `error`, `type`, `placeholder`, `value`, `onChange`, `onKeyDown`, `readOnly`, `disabled`, `maxLength`, `id`, `inputMode`, `autoCapitalize`, `autoComplete`, `autoCorrect`, `spellCheck`, `enterKeyHint`, `autoFocus` |
| `Select` | `label`, `hint`, `value`, `onChange`, `children` |
| `Checkbox` / `Switch` | `label`, `checked`, `onChange` |
| `Radio` | `name`, `label`, `checked`, `onChange` |
| `Tabs` | `items`, `active`, `onChange` |
| `Dialog` | `open`, `title`, `children`, `onClose` |
| `Toast` | `tone`, `children` |
| `Tooltip` | `label`, `children` |

Consequences worth knowing before you reach for one:

- `Button` has no `type` — it is always `type="button"`. A submit control needs its own wrapper.
- `Button` has no `href`. Link-styled navigation belongs in an unlinted `LinkButton`, not here.
- `Card` has no `onClick`. `interactive` is a visual affordance only; put the click on a child `Button`. This is better a11y, not a workaround.
- `Dialog` derives `aria-label` from `title`, traps focus, closes on `Escape` and scrim click, locks the scrolling ancestor, and clears `--safe-bottom`.

Components outside the lint roster define their own prop shapes:

- **Brand motifs:** `Hex`, `Sticker`, `Plate`, `Hero`, `Pin`, `Stat`, `Flap` (split-flap tiles), `ArcMark` (the Sunset Arc), `BrandLines`, `RouteGlobe`, `Pass` (boarding pass), `SiteIcons`.
- **Forms:** `Textarea`.
- **Game vocabulary:** `Chip`, `Callout` — see the tone table below.
- **Content blocks:** `Notice`, `Empty`, `Infobox`, `Board` (standings table).
- **Layout & navigation:** `Grid`, `CardRail`, `Rail`, `BottomNav`.
- **Escape hatches:** `LinkButton` (real anchor, accepts `href`/`title`/`aria-label`), `Omnisearch`.

`LinkButton` exists precisely because `Button` is frozen without `href`. Reach for it rather than widening the roster — an icon-only control is an `IconButton` (its `label` becomes both `aria-label` and the tooltip), and explanatory hover text is a `Tooltip` wrapping the control.

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

### Verified contrast

Measured in-page against the shipped tokens, both themes, alpha-composited over `--surface`:

| pair | Terminal | Night Flight |
| :-- | :-- | :-- |
| `--ink` on `--surface` | 13.17 | 15.42 |
| `--ink-muted` on `--surface` | 5.09 | 5.68 |
| `--accent` on `--surface` | 7.64 | 7.41 |
| `--on-accent` on `--accent` | 7.90 | 7.41 |
| `--moss` on `--surface` | 4.80 | 7.81 |
| worst `--tone-*-ink` on its own `-wash` | 4.68 (crimson) | 6.37 (crimson) |

All clear WCAG AA (4.5:1). Re-run the check after any token change — `tokens.css` records that `#4338CA` is 2.2:1 on navy-900, so this palette has a history.

## Sub-grid Steps

The 4px grid is the rule. Exactly two exceptions are sanctioned, and stylelint enforces that everything else outside `tokens.css` goes through a token:

- `--sp-q: 2px` — micro-gaps inside dense components (`.stat`, `.flap`, `.hero__stat`, `.notice`) where a full 4px step reads as a gutter.
- `--sp-h: 6px` — control padding and field gaps that genuinely sit off-grid.

Do not add a third.

## Breakpoints

`768px` (md) and `1024px` (lg), and nothing else. A third stop between them produces a dead zone where the Rail has appeared but the grids have not yet collapsed.