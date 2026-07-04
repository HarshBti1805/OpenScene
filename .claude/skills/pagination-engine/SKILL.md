---
name: pagination-engine
description: How OpenScene's screenplay pagination works and how to change it safely. Use when modifying page breaks, margins, MORE/CONT'D, dual dialogue layout, PDF output, or anything in crates/openscene-core/src/paginate.rs or pdf.rs.
---

# Pagination Engine

## The one rule

`paginate.rs` is the **only** layout engine. The editor's page-break
decorations and the PDF exporter both consume its output. Never introduce a
second place that decides where a line falls.

## Geometry (memorize before editing)

US Letter at Courier 12pt = 10 chars/inch, 6 lines/inch → 85 cols × 66 lines,
54 body lines after 1" top/bottom margins. Column constants in `paginate.rs`:

| Element       | Start col | Width |
|---------------|-----------|-------|
| heading/action| 15        | 60    |
| dialogue      | 25        | 35    |
| parenthetical | 30        | 25    |
| character cue | 37        | —     |
| transition    | right-aligned to 75 | — |
| dual left/right text | 15 / 48 | 28 |

These same columns appear as `ch` units in `src/styles.css` (`.el-*` rules) —
change both together or the editor page will lie.

## Break rules (contractual, test-enforced)

1. Scene headings and shots are keep-with-next: heading + 2 lines must fit or
   the heading moves to the next page.
2. A character cue never separates from its first dialogue line; a
   parenthetical never separates from the dialogue after it.
3. Long dialogue splits only at sentence boundaries: `(MORE)` at the page
   bottom, `NAME (CONT'D)` re-cued on the next page. No boundary → the whole
   speech moves.
4. Multi-line action never leaves a single orphaned line at a page bottom.
5. Dual-dialogue blocks never split across pages.
6. `(CONT'D)` for consecutive speeches is derived in `display_cue()` at layout
   time — it is never stored in the document or the Fountain file.

## Editing workflow

1. Write/adjust the test in `paginate.rs` `tests` module first — tests build
   synthetic scripts with `action_of_lines(n)` to position content precisely.
2. Run `cargo test -p openscene-core paginate`.
3. If you changed columns or line counts, update `pdf.rs` consts and
   `src/styles.css`, then eyeball a PDF export.
4. The editor never calls `paginate()` synchronously — only `page_map()` via
   the debounced plugin in `src/editor/pagination.ts`. Keep it off the
   keystroke path.
