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

All three are tuned independently; none is an inversion of another.

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

Theme preference (`system | light | dark | midnight`) persists in
localStorage, follows the OS by default, applies pre-bundle via an inline
script in `index.html` (no flash), and crossfades over 150ms
(`.theme-switching`, colors only).

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

## Custom titlebar

- macOS: native traffic lights via `titleBarStyle: Overlay` +
  `hiddenTitle` (see `src-tauri/tauri.macos.conf.json`); the header pads 78px
  left and provides `data-tauri-drag-region`.
- Windows/Linux: `decorations: false`; `src/components/Titlebar.tsx` renders
  minimize / maximize-restore / close through the window API (capabilities:
  `core:window:allow-*`). Close hover = danger red, the one sanctioned use of
  red in chrome.
