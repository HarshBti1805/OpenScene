# OpenScene

A completely free, open-source (MIT), **offline-first** professional screenwriting application for macOS, Windows, and Linux.

No accounts. No telemetry. No license checks. No network calls. No AI. No paid anything.

## What it does

- **WYSIWYG paginated screenplay editing** — Courier 12pt, US Letter, industry margins, live page breaks computed by the same Rust engine that renders the PDF, so a page in the editor is a page on paper.
- **Element cycling** — Enter and Tab follow standard screenwriting conventions (Enter after Character → Dialogue, Tab cycles element types, Cmd/Ctrl+1–7 set types directly).
- **SmartType autocomplete** — character names, INT./EXT., known locations, times of day, transitions, learned from the current script.
- **Automatic (MORE) / (CONT'D)** — across page breaks and for consecutive speeches by the same character.
- **Smart page-break rules** — scene headings are never orphaned, character cues never separate from dialogue, dialogue breaks only at sentence boundaries.
- **Dual dialogue**, inline script notes with colored categories, scene colors and synopses.
- **Project = plain folder** — `script.fountain` (readable in any text editor, forever), `project.json`, `snapshots/`.
- **Safety** — autosave every 2 seconds with atomic writes, automatic timed snapshots, named versions with one-click restore, rolling zipped backups to a second folder with restore.
- **Interchange** — Fountain and FDX (Final Draft XML) import/export with round-trip fidelity; production-quality PDF export; print via the system viewer.
- **Structure** — scene navigator with drag reorder, index card view with editable synopses, global character rename with preview.
- **Experience** — light/dark/midnight themes, distraction-free mode, typewriter scrolling, command palette (Cmd/Ctrl+K), find and replace, statistics panel.

## Repository layout

```
crates/openscene-core/   Rust engine: Fountain, FDX, pagination, PDF, snapshots, backups, stats
src-tauri/               Tauri 2 shell: thin command layer over the core
src/                     React 19 + TypeScript frontend (ProseMirror editor)
.claude/                 Agent skills and subagents for AI-assisted development
```

## Development setup

Prerequisites on all platforms:

- **Node.js** ≥ 20 and npm
- **Rust** (stable) via [rustup](https://rustup.rs)
- The **Tauri CLI** is included as a dev dependency (`npm run tauri`)

### macOS

```bash
xcode-select --install        # command-line tools (clang, git)
npm install
npm run tauri dev             # run the app in development
```

### Windows

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.
2. Install WebView2 (preinstalled on Windows 11).

```powershell
npm install
npm run tauri dev
```

### Linux (Debian/Ubuntu)

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
npm install
npm run tauri dev
```

For Fedora/Arch package names, see the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

## Building release binaries

```bash
npm install
npm run tauri build
```

Outputs land in `src-tauri/target/release/bundle/`:

- macOS: `.app` and `.dmg`
- Windows: `.msi` and `.exe` (NSIS)
- Linux: `.deb`, `.rpm`, and `.AppImage`

To regenerate platform icon sets from the base PNG: `npm run icons`.

## Running tests

```bash
cargo test -p openscene-core     # Fountain parser, FDX round-trip, pagination rules, PDF, snapshots, backups
npm run build                    # type-checks (strict) and bundles the frontend
```

## The file format

A project folder contains:

```
MyScript/
  script.fountain    # your screenplay, plain text, Fountain superset
  project.json       # name, backup folder, scene-numbering preference
  snapshots/         # timestamped .fountain copies + index.json
```

You can open `script.fountain` in any text editor at any time and have your entire script. Nothing in this repository or application will ever require a network connection. See `ARCHITECTURE.md` for the document model and pagination design.

## License

MIT.
