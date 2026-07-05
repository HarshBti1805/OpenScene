# OpenScene Thoroughness Pass: Templates, Missed Features, Paywall-Killers

Research date: July 2026. This document extends `screenwriter-spec.md`. Attach both to the next build prompt.

---

## 1. Template library expansion

Current state: Feature Film, Short Film. Target: a template is a bundle of (element format rules + title page + boilerplate structure + optional pre-filled beat board). Ship in three waves.

**Wave 1 (format engine already supports or nearly supports):**
1. One-Hour Drama (teleplay): Teaser + five acts, act headers (centered, underlined), END OF ACT pages, optional tag
2. Half-Hour Single-Cam: three acts + cold open, screenplay-style spacing
3. Limited Series / Streaming Drama: no act breaks, feature-style
4. Web Series / Digital Short
5. Treatment / Outline document (prose template)
6. Structure starters: Save the Cat beat sheet, Dan Harmon Story Circle, Three-Act, Hero's Journey — shipped as pre-filled index-card/beat sets attached to a blank feature template

**Wave 2 (needs new element behaviors):**
7. Multicam Sitcom: double-spaced dialogue, ALL-CAPS underlined sluglines, all-caps stage directions in parentheses, lettered scenes (A, B, C), each scene starts a new page, act/scene headers on first page of each scene, character CAPS conventions, ~30s per page timing in stats
8. Stage Play: act/scene structure, AT RISE descriptions, centered character names, Dramatists Guild-style layout, optional act-scene-page numbering (I-2-16 style)
9. Musical: stage play + Lyrics element (all-caps or italic sung text, distinct margins)
10. Radio Drama / Audio Fiction: numbered and capitalized sound/music cues (cue numbers restart per page), voice-only conventions
11. Podcast (narrative and interview): segment headers, cue lines, host/guest labels
12. Animation: feature/TV animation conventions (tighter page timing in stats, heavier action capitalization defaults)

**Wave 3 (needs layout engine work):**
13. Documentary / AV Two-Column: audio column + video column (+ optional timecode/shot column); this is a different layout mode, not just styles
14. Commercial / Promo (AV variant, 30/60-second targets in stats)
15. Graphic Novel / Comic: page/panel structure elements, panel counts per page
16. Interactive / Game dialogue: branching labels, condition notes (plain formatting, no logic)

**Template UX:** template gallery with visual preview cards (already built), template metadata (category, page-timing rule for runtime stats), "Save as template" from any project (already built), template import/export as single files for community sharing.

---

## 2. Features missed or under-scoped in the current spec/build

**Writing**
- Alternate dialogue lines: store unlimited alternates per dialogue block, cycle with a shortcut, alternates survive save (Fountain superset) and export notes
- Images in projects: on title pages, in beat cards, in notes docs, and as inline reference images in the script view (never in paginated output unless the template allows, e.g., graphic novel)
- Autocorrect (opt-in) and per-element casing enforcement (auto-CAPS character cues, transitions)
- Format assistant: pre-export checklist flagging format violations beyond lint (missing title page fields, non-standard settings, empty elements)
- "Include" composition (Highland): write sequences/acts as separate files and compile into one script for pagination/export
- Novel/prose mode reflow helper: convert prose paragraphs into action/dialogue elements interactively

**Structure**
- Beat flow lines: connect beats on the beat board with arrows (flowchart-style)
- Outline lanes: multiple labeled lanes (plot, character arcs, themes) forming a hierarchy; lanes visible as colored structure lines alongside the script; PDF export can include structure lines
- Send-to-script: convert an outline/beat sequence into scene headings + synopsis notes in one action
- Pinned content: pin scenes/notes/cards for quick access

**Production/pro**
- Track Changes (accept/reject edit workflow) as distinct from revision marks
- Character highlighting for sides: print/export with one character's dialogue highlighted (actor sides); per-character color
- Watermarked batch export with recipient names and serial numbers
- Page-timing profiles per template (1 min/page feature, ~30s/page multicam) feeding runtime estimates
- Table of contents / bookmark tree in exported PDFs (scene and act bookmarks)
- Act/scene-aware page numbering options for plays
- Non-speaking character tracking (characters mentioned in action but never speaking) in reports

**Editor/QoL**
- Scene heading auto-numbering styles (1, 1A, roman for acts)
- Per-scene word/page targets
- Mid-writing "scratchpad" split (quick notes pane without leaving the page)
- Recent-locations/times ordering in SmartType by frequency
- Smart quotes/dashes toggle (screenplay convention: straight quotes, double-hyphen)

---

## 3. Paywall-killers: ship free what competitors gate

| Feature | Who charges for it | OpenScene status |
|---|---|---|
| Offline desktop apps | Arc Studio Pro ($99/yr), WriterDuet Pro | Free by architecture |
| Revision mode + colored sets | Arc Pro, Highland Pro, FD, Fade In license | First slice built; finish locked pages/A-scenes |
| Watermark-free export | Arc, Highland, Fade In demo, Celtx free | Free since day one |
| Unlimited projects/scripts | WriterDuet (3 free), Arc (2 free), Celtx (1 free) | Unlimited |
| Full version history / restore deleted text | WriterDuet Plus | Built (snapshots); add per-edit history when CRDT lands |
| Tagging + filtering | WriterDuet Pro, Celtx paid, FD | To build (scene filters exist in spec v1.x) |
| Statistics and reports | WriterDuet Pro | Stats panel built; add exportable reports |
| Read-aloud with per-character voices | WriterDuet Premium, FD, Arc | To build via OS TTS (free, offline) |
| Parallel columns (split screen/VR) | WriterDuet Premium | Wave 3 AV layout covers the mechanism |
| Translation | WriterDuet Premium (cloud) | Out of scope (needs network); document as intentional |
| Custom formats/margins/themes | WriterDuet admin tiers, Arc Pro, FD | Format editor built read-only; unlock when engine parameterizes |
| Templates beyond basics | Highland paid, Celtx paid | Section 1 above, all free |
| Breakdown tagging → reports | Celtx paid, FD | Spec v2+; keep |
| PDF import to editable script | FD, Highland | Spec v2+ (PDF melt); keep |
| Gender/inclusivity dialogue analysis | Highland, FD Navigator | To build; pure local computation |
| Writing sprints/goals/streaks | FD 13, Arc, Highland | To build; trivial |
| Real-time collaboration | Everyone (WriterDuet, FD, Arc, Celtx) | Spec Layer 3/4 (LAN/P2P/self-hosted), later |

---

## 4. Explicit non-goals (so "thorough" doesn't mean "bloated")

- Cloud anything, accounts, telemetry, AI (unchanged)
- Auto-translation (requires network services)
- Scheduling/budgeting/call sheets (Celtx's production suite is a different product; breakdown tagging + reports is the boundary)
- Video chat (session text chat only, when live collaboration ships)
- Emoji-in-script as a promoted feature (Unicode already types fine; no dedicated UI)

---

## 5. Suggested build order for the next prompt

0. **Engineering-recommended immediate items (from the current codebase state, do these first):**
   - Revision mode slice 2: locked pages + A-scenes; the paginator's page-assembly loop is the prepared attachment point
   - The three known accessibility gaps: keyboard-based scene/card reorder, dialog focus trapping, SmartType combobox semantics (proper ARIA combobox/listbox roles), followed by a real VoiceOver/NVDA session
   - Element-scoped find (search only dialogue, only action, only one character's dialogue) and scene filtering (by character, location, INT/EXT, DAY/NIGHT, color, status), the next items down the spec's v1.x list
1. Template Wave 1 + template metadata/timing profiles (cheap, visible)
2. Read-aloud table read via OS TTS + sprints/goals/streaks + gender analysis (three loved features, all local, all quick)
3. Alternate dialogue + images in beats/notes/title page + pinned content
4. Multicam + stage play element work (Wave 2 core), then remaining Wave 2 templates
5. Tagging/filtering + exportable reports + character-highlighted sides + PDF bookmarks
6. Track Changes, Include composition, Wave 3 layouts (AV two-column), batch watermarking
