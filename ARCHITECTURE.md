# OpenScene Architecture

One page for future sessions. Read this before touching the editor, the parser, or pagination.

## Document model

The single source of truth is `Script` (`crates/openscene-core/src/model.rs`, mirrored in `src/types.ts`): a title page (ordered key/value pairs) plus a flat list of typed `Element`s — `scene_heading`, `action`, `character`, `parenthetical`, `dialogue`, `transition`, `shot`, `page_break`. Elements carry optional `dual` (left/right dual-dialogue side) and `revision` (revision-set id); scene headings carry `scene_number`, `synopsis`, `color`. Inline notes are `{offset, category, text}` anchored at character offsets.

The frontend edits a ProseMirror doc where **one element = one block node** (`src/editor/schema.ts`). Hard newlines are `hard_break` inline nodes; notes are inline **atom** nodes that contribute no text, so note offsets are recomputed from surrounding text on conversion (`src/editor/convert.ts` — `scriptToDoc` / `docToScript` must stay inverse operations). All UI features (navigator, cards, rename, notes panel) mutate the document through ProseMirror transactions so everything is undoable.

## File format

A project is a plain folder:

```
MyScript/
  script.fountain      main script (Fountain superset)
  script.loro          CRDT history (auxiliary binary; fountain is source of truth)
  project.json         metadata: name, backup dir, numbering, dictionary, revision sets
  drafts/*.fountain    alternate drafts (each with its own .loro)
  notes/*.md           freeform Markdown notes
  assets/*             images referenced by notes
  snapshots/           full-copy timestamped versions per document + index.json
  .openscene-writer.json  advisory single-writer heartbeat (excluded from backups)
  .openscene-undo.json    persisted undo step log (main script)
```

Superset conventions kept Fountain-compatible: scene color as `[[color: blue]]`, categorized notes as `[[category: text]]`, revision marks as `[[rev: set-id]]` on any element, synopsis as standard `= text`. `fountain::parse(serialize(s)) == s` is test-enforced; anything the serializer emits that could misparse (uppercase action lines, leading `=`/`.`/`>`, marker-carrying cues/transitions) is escaped or forced-form. All writes are atomic (temp file + fsync + rename, `snapshots::atomic_write`).

**Verify-on-open** (`open_project`) validates `project.json` and script readability, checks for a competing live writer (heartbeat, read-only fallback), and surfaces sync-conflict artifacts; corruption yields a recovery result (restore from snapshot, damaged files quarantined as `*.damaged-<stamp>`), never a partial open.

## CRDT layer (groundwork)

`crdt.rs` folds every save into a persistent Loro document (`LoroText::update` = diff → CRDT ops at save granularity) stored as `<stem>.loro`; named versions copy the state into `snapshots/`. Invariant (tested): fountain → CRDT → fountain is byte-identical. Deliberately **not** on the keystroke path — see PROGRESS.md WS5 for the constraint analysis and upgrade options.

## Format parameterization

`FormatSpec` (`model.rs`) parameterizes the engine: per-element indent/width
columns, casing, space-before, alignment (left/center/right), underline,
dialogue line-spacing, plus scene-per-page, lettered scenes, and a
minutes-per-page timing profile feeding `ScriptStats::estimated_minutes`.
It rides in `LayoutOptions.format` and persists in `project.json`.
**Invariant:** `FormatSpec::default()` is the US Feature standard and must
paginate byte-identically to no format at all (golden test
`default_format_is_byte_identical_to_none`). Element kinds `act_header`
(`# ACT ONE` — legacy Fountain sections now materialize) and `lyrics`
(`~line`) round-trip through Fountain and FDX. Templates
(`src/templates.ts`) bundle a FormatSpec preset + boilerplate + timing
profile (Multicam, Stage Play, Musical set formats; Wave 1 TV templates use
act headers).

## Locked pages + A-scenes

Locking (`paginate::compute_lock`) materializes scene numbers into the
document, paginates freely once, and freezes each page start as a
`LockedPageAnchor { label, scene, el_offset, nonws_offset }` in
`project.json`. While locked, `apply_locked_anchors` re-cuts the block list
before flow: content between anchors fills its frozen page; overflow becomes
A/B pages ("12" → "12A", base-26); mid-speech anchors re-emit MORE/CONT'D at
the recorded non-whitespace offset. `Page` carries a printed `label` beside
its physical ordinal; PDF headers, page-break decorations, navigator, and
splits all use labels. A-scene numbering derives deterministically in
`assign_scene_numbers` ("12" → "12A"); `Omitted` is a first-class element
(`.OMITTED #12#` / FDX `Omitted="Yes"`), inserted by the navigator's Omit
action or automatically by the editor's `lockGuard` plugin when a locked
scene is deleted. Unlock simply clears the state; relock refreezes current
pagination. Semantics note: anchors are element-granularity with nonws-offset
refinement; deleting a locked scene *and* bypassing OMITTED drops that page
label (Omit is the supported path).

## Revision mode (first slice)

Revision sets (`RevisionSet { id, color, label, date }`, standard ladder in `model::REVISION_COLORS`) live in `project.json` with `active_revision`. While active, the editor's `revisionMark` plugin stamps edited blocks; marks serialize as `[[rev: id]]` / FDX `RevisionID`. `paginate_full` flags `Line.revised`; the PDF draws margin asterisks (col 82) and a label+date header on revised pages (`LayoutOptions { revision_label, show_revision_marks }`). Locked pages / A-pages / OMITTED shipped (see above); draft comparison v0 is scene-level and lives in the frontend (`RevisionsPanel`), which also hosts Lock/Unlock.

## Pagination

`paginate.rs` is the **only** layout engine. It converts elements into wrapped physical `Line`s on an 85-column × 54-body-line grid (US Letter, Courier 12pt = 10 cpi, 6 lpi; margins expressed as character columns: action col 15/width 60, dialogue 25/35, parenthetical 30/25, character cue 37, transition right-aligned at 75). Break rules: headings/shots keep-with-next (need 2 following lines), speeches keep cue+first dialogue line together, dialogue splits only at sentence boundaries inserting `(MORE)` / `CHARACTER (CONT'D)`, multi-line action never orphans a single line, dual-dialogue blocks never split. `(CONT'D)` for consecutive speeches is **derived at layout time** (`display_cue`), never stored in the document.

Consumers:
- **PDF** (`pdf.rs`): a dependency-free PDF 1.4 writer using built-in Courier at 7.2pt/char and 12pt leading — consumes `Layout` lines verbatim, so screen and paper cannot disagree.
- **Editor**: `page_map()` returns element-index → page number. The frontend requests it 250 ms after typing pauses (`src/editor/pagination.ts`) and draws page-break decorations asynchronously — pagination is **never** on the keystroke path.

If you change any column constant or break rule, update both the Rust tests and the CSS grid in `src/styles.css` (`.el-*` margins are the same columns in `ch` units).

## Backend surface

`src-tauri/src/lib.rs` is a thin JSON bridge: project CRUD + verify-on-open/recovery/conflicts/heartbeat, documents (drafts/notes/assets), recents, `compute_page_map` (element pages + exact MORE/CONT'D dialogue splits), `compute_stats`, spell check (bundled Hunspell en_US via `spellbook`, extra dictionaries from `<app-config>/dictionaries/`), Fountain/FDX/PDF import-export, document-scoped snapshots, zipped backups (user dir or `auto-backups/` fallback), persisted-undo state. No live document state in the backend; the frontend owns it and autosaves (debounced 2 s, blur, intercepted window close with quit backup) via atomic writes — that is the crash-recovery story. Per-keystroke work is bounded to ProseMirror apply + store sync (~0.24 ms p95 on 120 pages, benchmarked in `latency.bench.test.ts`); spellcheck (700 ms idle), pagination (250 ms idle), and CRDT (save-time) are all off-path.

## Invariants (do not break)

1. Fountain and FDX round-trips are lossless (tested), including revision marks.
2. One layout engine; editor and PDF always agree (including dialogue splits).
3. Every file write is atomic; user data is never truncated in place; destructive operations snapshot (and milestone-backup) first; verify-on-open must accept every state the app can write.
4. Zero network calls anywhere, including dependencies (fonts and dictionaries are bundled).
5. `script.fountain` stays human-readable plain text; `.loro` is auxiliary, never authoritative.
6. `scriptToDoc`/`docToScript` stay exact inverses (tested in `convert.test.ts`).
7. All user-facing strings go through `src/i18n.ts`.
