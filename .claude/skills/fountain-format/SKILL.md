---
name: fountain-format
description: OpenScene's Fountain-superset file format and round-trip invariants. Use when touching crates/openscene-core/src/fountain.rs, fdx.rs, the Script model, or src/editor/convert.ts.
---

# Fountain Superset Format

## Invariant zero

`fountain::parse(fountain::serialize(script)) == script` for every script the
app can produce. Same for `fdx::import(fdx::export(script))`. Both are
test-enforced. If a new field breaks this, fix serialization, not the test.

## The superset (all of it stays valid plain Fountain)

- Scene color: `[[color: blue]]` inline note on the heading line → `Element.color`.
- Categorized notes: `[[category: text]]` → `Note { offset, category, text }`;
  plain `[[text]]` gets category `note`. Offsets are **character** offsets into
  the cleaned element text.
- Synopsis: standard `= text` lines attach to the preceding scene heading.
- Scene numbers: standard `#12A#` trailing markers.
- Dual dialogue: standard `^` on the second character cue; parse marks the
  whole previous speech `left` and the caret speech `right`.

## Serializer escaping (the subtle part)

Action lines that would misparse on re-read get a leading `!` (forced action):
uppercase lines, lines starting with `.`, `>`, `=`, `#`, `@`, INT/EXT
prefixes, or `===`. The parser strips `!` at the earliest branch so it can
never be interpreted as a character cue. When adding new syntax, extend
`needs_bang` in `serialize()` accordingly.

## Model mapping (three representations, keep in sync)

1. Rust `model.rs::Script` — source of truth, serde snake_case JSON.
2. TS mirror `src/types.ts` — must match field-for-field.
3. ProseMirror doc — one element = one block node; `\n` = `hard_break` inline
   node; notes = inline atom nodes (they contribute no text, so offsets are
   recomputed in `docToScript`). `scriptToDoc`/`docToScript` in
   `src/editor/convert.ts` must remain exact inverses.

## FDX specifics

Hand-rolled forgiving scanner (no namespaces). Gotchas already handled — keep
them: `<ScriptNote>` nests its own `<Paragraph>` (guarded by `in_note`); dual
dialogue wraps in `<Paragraph><DualDialogue>`; page breaks are
`StartsNewPage="Yes"` action paragraphs; newlines encode as `&#10;`.
