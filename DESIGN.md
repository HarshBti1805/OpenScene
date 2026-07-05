# OpenScene Design Language: **Backlot**

Cinema-industrial. The chrome quotes the machinery of filmmaking — grading
suites, edge codes, slates, signal lamps — while the page itself stays a calm,
paper-accurate Courier document. **Design intensity lives in the chrome, never
in the page.**

## Principles

1. **The page is sacred.** `--os-page` / `--os-page-ink` only; no decoration,
   no animation, no chrome typography inside the page. Page layout columns are
   locked to the Rust pagination engine (see `ARCHITECTURE.md`).
2. **One hot accent.** Signal amber is the only saturated color in the UI. If
   two things on screen are amber, one of them is wrong.
3. **Flat, warm, unbordered.** Surfaces separate by tone (`bg → surface →
   surface-raised`), not by borders-on-everything. Hairlines (`--os-line`)
   appear only at structural seams.
4. **Motion is transform + opacity only,** and nothing animates on the
   keystroke path.

## Tokens (defined in `src/styles.css`, consumed everywhere)

| Token | Role |
|---|---|
| `--os-bg` | App background (deepest layer) |
| `--os-surface` | Panels, toolbar, modals |
| `--os-surface-raised` | Cards, inputs-on-surface, hover targets |
| `--os-ink` / `--os-ink-muted` | Primary / secondary text |
| `--os-accent` / `--os-accent-ink` | Signal amber / text on amber |
| `--os-accent-dim` | Amber wash for hovers and selection |
| `--os-line` / `--os-line-strong` | Hairlines / emphasized rules |
| `--os-page` / `--os-page-ink` | The script page and its text |
| `--os-danger` | Destructive/error accents |
| `--os-scrim` | Modal backdrop |
| `--os-shadow-raise` / `--os-shadow-float` / `--os-page-shadow` | Elevation |
| `--os-space-1…8` | 4, 8, 12, 16, 20, 24, 32, 48 px |
| `--os-radius-sm/md/lg` | 3, 6, 12 px |
| `--os-page-font`, `--os-page-zoom` | Editing-appearance settings (runtime) |

**Rule: zero hard-coded colors in components.** New components consume tokens;
if a color isn't expressible in tokens, the design is wrong, not the token set.

## Typography

| Face | Usage | Source |
|---|---|---|
| **Big Shoulders Display** 600/700 | Display: mastheads, panel headers, poster titles, modal titles. Always uppercase, letter-spaced | `@fontsource/big-shoulders-display` (bundled) |
| **Inter Variable** | All UI text | `@fontsource-variable/inter` (bundled) |
| **Courier Prime** 400/700/italic | The page, edge codes, statusbar, mono metadata | `@fontsource/courier-prime` (bundled) |
| Courier Prime Sans, OpenDyslexic | Optional *editing-view* page fonts | bundled TTF / `@fontsource/opendyslexic` |

Type scale (`--os-text-*` / `--os-display-*`): 11, 12.5, 13.5 (base), 16, 21 /
28, 44, 72 px. Edge-code metadata (scene numbers, page counts, timestamps) is
always Courier at 10–11px with 0.08–0.3em tracking, uppercase.

## THEMES

Nine themes, all tuned independently; none is an inversion of another. Each
names a place on the lot. The original three (Dark, Light, Midnight) are the
signal-amber core; the six added themes each carry their own accent, which the
user can override globally (see "Appearance customization" below).

| Theme | Place | Mode | Accent |
|---|---|---|---|
| `dark` | the grading suite (default) | dark | signal amber |
| `light` | the production office | light | burnt amber |
| `midnight` | the projection booth | dark | dim amber |
| `writers-room` | the network writers' room | light | network blue `#175f9e` |
| `matinee` | the movie palace | light | marquee brass `#8a5d00` |
| `darkroom` | the photo darkroom | dark | safelight red `#e05a4e` (danger becomes amber) |
| `noir` | black-and-white pictures | dark | silver `#d7d7dc` |
| `greenroom` | the greenroom | dark | stage green `#63b56f` |
| `blueprint` | the art department | dark | drafting blue `#5aa7e8` |

Every theme defines the full token set in `src/styles.css`
(`:root[data-theme="…"]`) and is registered in `THEMES` in `src/store.ts`,
which drives the Format & Appearance swatches and the command palette entries
— adding a theme is those two places plus a label in `src/i18n.ts`.

## Appearance customization

All persisted in localStorage, applied pre-bundle by the `index.html` inline
script (no flash), and set as `:root` data attributes:

- **Accent override** (`data-accent`): `signal` (keep the theme's own accent)
  or amber / crimson / cyan / green / violet / silver. Light themes get
  darker cuts of each accent so text-size uses hold ≥4.5:1. Registered in
  `ACCENTS` in `src/store.ts`.
- **Interface density** (`data-density="compact"`): tightens the `--os-space-*`
  scale for chrome only; the page column layout is engine-owned and untouched.
- **Reduce motion** (`data-motion="reduced"`): collapses all animation in-app,
  mirroring `prefers-reduced-motion` for users who want stillness only here.
- Plus the existing controls: page font, page zoom, UI zoom, line focus,
  typewriter scrolling, cursor style, theme-follows-OS.

The details of the original three:

### Dark — "the grading suite" (default)
| Token | Value |
|---|---|
| bg / surface / raised | `#16130e` / `#1d1a14` / `#262219` |
| ink / muted | `#e9e3d3` / `#9b937f` |
| accent / on-accent | `#f2a33c` / `#1c1509` |
| line / strong | `#363023` / `#4b4433` |
| page / page-ink | `#201d16` / `#e6e0d0` |
| danger | `#e26d5a` |

### Light — "the production office"
| Token | Value |
|---|---|
| bg / surface / raised | `#ece5d4` / `#f3eee0` / `#faf6ea` |
| ink / muted | `#26200f` / `#7a7057` |
| accent / on-accent | `#9c5300` / `#fff6e4` |
| line / strong | `#d8cfb6` / `#bdb294` |
| page / page-ink | `#fdfbf3` / `#211c11` |
| danger | `#b3361f` |

### Midnight — "the projection booth"
| Token | Value |
|---|---|
| bg / surface / raised | `#0a0907` / `#100e0b` / `#17140f` |
| ink / muted | `#bfb8a6` / `#6e675a` |
| accent / on-accent | `#d99427` / `#140f05` |
| line / strong | `#211d15` / `#332d20` |
| page / page-ink | `#0e0d0a` / `#c9c3b1` |
| danger | `#c25b48` |

Theme preference (`system` or any theme id) persists in localStorage, follows
the OS by default (resolving to dark/light), applies pre-bundle via an inline
script in `index.html` (no flash), and crossfades over 150ms
(`.theme-switching`, colors only). Accent changes reuse the same crossfade.

## Motion

| Token | Value | Use |
|---|---|---|
| `--os-motion-fast` | 120ms | hovers, toggles, tooltips |
| `--os-motion-std` | 200ms | panels, palette, find bar, view changes |
| `--os-motion-entrance` | 260ms | poster cards, staggered entrances |
| `--os-ease` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | everything |

Rules:
- **Transform and opacity only.** Never animate width/height/margins/colors
  (exception: the 150ms theme crossfade, which is user-initiated and chrome-wide).
- Nothing runs per keystroke: pagination decorations arrive on a 250ms idle
  debounce; line-focus rebuilds a single node decoration only when the caret
  changes blocks; no CSS transitions target the page content.
- Panels slide+fade (`os-panel-in`), the palette and modals scale from 98%
  (`os-scale-in`), poster cards stagger in 40ms apart (`os-poster-in`),
  navigator/index-card reorders use FLIP (`src/ui/flip.ts` — capture rects,
  reorder, glide via `element.animate` transforms).
- `prefers-reduced-motion: reduce` collapses **all** animation/transitions to
  ~0ms globally, and the FLIP util exits early.

## Accessibility

- Focus: 2px amber outline with 2px offset via `:focus-visible` — visible on
  every surface in all three themes; switches re-implement it on their track.
- Contrast: ink-on-bg exceeds AA in all themes; amber-on-dark and
  `#9c5300`-on-light hold ≥4.5:1 for text-size uses; on-accent ink is near-black
  on amber (≥8:1). Muted ink is reserved for metadata, never for essential text.
- Every interactive control keeps an `aria-label`; the titlebar window
  controls, template gallery radios, tabs, switches, and sliders are keyboard
  reachable and labeled.

## Adding a new themed component (checklist)

1. Colors: tokens only (`var(--os-…)`). No hex, no `rgba()` of a hex.
2. Type: UI text = `--os-font-ui`; headings = `--os-font-display`, uppercase,
   tracked; metadata = `--os-font-mono` edge-code style (10–11px, tracked).
3. Elevation: prefer tone changes; shadows only for floating layers.
4. Motion: transitions on transform/opacity with motion tokens; add an
   entrance keyframe only for layer-creating surfaces (popups, panels).
5. Focus: rely on the global `:focus-visible`; if you must hide it, replace it
   with something *more* visible, not less.
6. Verify in all three themes plus reduced-motion before shipping.
7. Never style inside `.script-page` beyond the locked column layout.

## New surfaces added in the MVP-completion pass

All follow the checklist below; verify against it when touching them:

- **Spell squiggle + popup**: dotted `--os-danger` underline (never animated); popup follows the SmartType pattern (`.spell-popup`, menu roles, amber hover inversion).
- **Documents section** (navigator top): edge-code group labels, amber `aria-current` tint for the active document, hover-revealed delete.
- **Note editor**: page-toned Markdown surface (`--os-page`/`--os-page-ink`), display-type headings in preview, 88ch measure.
- **Revisions panel**: revision-paper swatches use fixed industry colors (`REVISION_SWATCHES` — document data, like scene label colors, not theme tokens); active set gets the amber wash; editor margin asterisks are `--os-accent`.
- **Compare drafts**: diff lines in mono at `--os-text-xs`; additions use the fixed note-green, removals `--os-danger`.
- **Safety dialogs** (recovery/conflict): `alertdialog` on scrim, danger accents reserved for the reason banner; every path is a labeled button.
- **UI zoom**: chrome surfaces scale via `zoom: var(--os-ui-zoom)`; never apply it to `.script-page`.

## Surfaces added in the revision-completion pass

- **Lock/Unlock** (Revisions panel): confirmation `alertdialog` explains
  consequences; locked badge in the status bar is `--os-accent`; A-page
  indicators in the navigator are amber bold text (never color-only — the
  letter suffix carries the meaning). OMITTED rows strike through in muted ink.
- **Scope chips** (find bar) and **scene filter bar**: pill chips, amber
  inversion when active, edge-code "7/40 scenes" count with Clear.
- **Format editor**: mono numeric inputs (`.fmt-num`), Industry-standard /
  Non-standard badges, reset button; every change repaginates live.
- **Template gallery categories**: display-type category rules
  (`.template-cat`) group Film/TV/Stage/Audio/Structure starters.
- **Table read bar**: bottom dock strip, display-type title in amber,
  play/stop as small buttons, voice assignment via paired selects.
- **Sprints & streaks** (stats panel): mono countdown clock in amber; 14-day
  streak bars are `--os-line-strong`, lit days `--os-accent`.
- **Pins**: amber chip rail (`.pin-chip`), hover inverts to accent-ink;
  star toggles appear on hover and stay visible when pinned.
- **Card images**: cover-fit thumbnails with a scrim-backed remove button.
- **Alternate takes**: inline amber chips (`.note-alt`) on dialogue.

## Custom titlebar

- macOS: native traffic lights via `titleBarStyle: Overlay` +
  `hiddenTitle` (see `src-tauri/tauri.macos.conf.json`); the header pads 78px
  left and provides `data-tauri-drag-region`.
- Windows/Linux: `decorations: false`; `src/components/Titlebar.tsx` renders
  minimize / maximize-restore / close through the window API (capabilities:
  `core:window:allow-*`). Close hover = danger red, the one sanctioned use of
  red in chrome.
