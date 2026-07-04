# OpenScene Architecture

One page for future sessions. Read this before touching the editor, the parser, or pagination.

## Document model

The single source of truth is `Script` (`crates/openscene-core/src/model.rs`, mirrored in `src/types.ts`): a title page (ordered key/value pairs) plus a flat list of typed `Element`s — `scene_heading`, `action`, `character`, `parenthetical`, `dialogue`, `transition`, `shot`, `page_break`. Elements carry optional `dual` (left/right dual-dialogue side), and scene headings carry `scene_number`, `synopsis`, `color`. Inline notes are `{offset, category, text}` anchored at character offsets.

The frontend edits a ProseMirror doc where **one element = one block node** (`src/editor/schema.ts`). Hard newlines are `hard_break` inline nodes; notes are inline **atom** nodes that contribute no text, so note offsets are recomputed from surrounding text on conversion (`src/editor/convert.ts` — `scriptToDoc` / `docToScript` must stay inverse operations). All UI features (navigator, cards, rename, notes panel) mutate the document through ProseMirror transactions so everything is undoable.

## File format

A project is a plain folder: `script.fountain` (Fountain superset), `project.json` (metadata), `snapshots/` (full-copy timestamped `.fountain` files + `index.json`). Superset conventions kept Fountain-compatible: scene color as `[[color: blue]]` on the heading line, categorized notes as `[[category: text]]`, synopsis as standard `= text`. `fountain::parse(serialize(s)) == s` is test-enforced; anything the serializer emits that could misparse (uppercase action lines, leading `=`/`.`/`>`) is `!`-escaped. All writes are atomic (temp file + fsync + rename, `snapshots::atomic_write`).

## Pagination

`paginate.rs` is the **only** layout engine. It converts elements into wrapped physical `Line`s on an 85-column × 54-body-line grid (US Letter, Courier 12pt = 10 cpi, 6 lpi; margins expressed as character columns: action col 15/width 60, dialogue 25/35, parenthetical 30/25, character cue 37, transition right-aligned at 75). Break rules: headings/shots keep-with-next (need 2 following lines), speeches keep cue+first dialogue line together, dialogue splits only at sentence boundaries inserting `(MORE)` / `CHARACTER (CONT'D)`, multi-line action never orphans a single line, dual-dialogue blocks never split. `(CONT'D)` for consecutive speeches is **derived at layout time** (`display_cue`), never stored in the document.

Consumers:
- **PDF** (`pdf.rs`): a dependency-free PDF 1.4 writer using built-in Courier at 7.2pt/char and 12pt leading — consumes `Layout` lines verbatim, so screen and paper cannot disagree.
- **Editor**: `page_map()` returns element-index → page number. The frontend requests it 250 ms after typing pauses (`src/editor/pagination.ts`) and draws page-break decorations asynchronously — pagination is **never** on the keystroke path.

If you change any column constant or break rule, update both the Rust tests and the CSS grid in `src/styles.css` (`.el-*` margins are the same columns in `ch` units).

## Backend surface

`src-tauri/src/lib.rs` is a thin JSON bridge: project CRUD, recents, `compute_page_map`, `compute_stats`, Fountain/FDX/PDF import-export, snapshots, zipped backups. No state lives in the backend; the frontend owns the live document and autosaves (debounced 2 s, plus blur/close) via atomic writes — that is the crash-recovery story.

## Invariants (do not break)

1. Fountain and FDX round-trips are lossless (tested).
2. One layout engine; editor and PDF always agree.
3. Every file write is atomic; user data is never truncated in place.
4. Zero network calls anywhere, including dependencies.
5. `script.fountain` stays human-readable plain text.
