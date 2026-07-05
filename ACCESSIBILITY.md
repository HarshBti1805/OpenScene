# Accessibility Checklist

Status after the accessibility workstream (revision-completion release).
"Verified" = keyboard walkthrough + DOM/ARIA inspection during development;
the manual screen-reader script below still needs a human session.

## Verified programmatically

### The three previously tracked gaps — now closed
- [x] **Keyboard reorder**: Alt+ArrowUp/Down on a focused scene (navigator) or Alt+arrows on a focused index card moves it; focus follows the moved item; the new position is announced through the live status region ("Scene 12 moved to position 3 of 40"). Works with `prefers-reduced-motion` (FLIP is skipped).
- [x] **Dialog focus trapping**: every modal (command palette, title page, rename, Format & Appearance, template gallery, recovery, sync-conflict, lock confirmation, compare drafts) traps Tab/Shift+Tab, moves focus to the first field on open, closes on Escape, and **restores focus to the invoking control on close** (`useFocusTrap`).
- [x] **SmartType combobox semantics**: the editor surface now carries `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` pointing at the popup listbox, and `aria-activedescendant` tracking the highlighted option; options have stable ids, `role="option"`, and `aria-selected`. All attributes are removed when the popup closes or the editor is destroyed.

### Keyboard reachability (all surfaces)
- [x] Command palette, find/replace with scope chips, Format & Appearance tabs/radios/sliders/switches, Revisions panel (sets, lock/unlock confirmation), Documents section, note editor, safety dialogs, template gallery, titlebar window controls, spell-check popup menu.
- [x] Locked-page surfaces: lock/unlock buttons and confirmation, per-scene Omit buttons (labeled per scene number), A-page indicators are text (not color-only).

### Roles, names, live regions
- [x] Every interactive control has an accessible name from the i18n catalog; status bar is `role="status" aria-live="polite"` and now also announces reorders and lock state changes.
- [x] Page-break rules, MORE/CONT'D splits (with locked labels like "PAGE 12A"), OMITTED placeholders (`role="note"`, "Scene 12 omitted"), and inline notes are labeled.

### Visual
- [x] Amber `:focus-visible` outline on every surface in all three themes; switches re-implement it on the track.
- [x] AA contrast maintained; spell squiggles and A-page markers are not color-only (shape/text carry the meaning); reduced motion collapses all animation including FLIP reorder.

## Manual screen-reader test script (needs a human: VoiceOver on macOS, NVDA on Windows)

Run each step with the screen reader active; note what is announced.

1. **Start screen**: Tab through poster cards — each should announce "Open project NAME"; open the template gallery — focus should land in the project-name field; Escape should close it and return focus to the New Project card.
2. **Editor typing**: type a scene heading; verify typed characters echo and the element is navigable. Type a character name to open SmartType; Arrow through suggestions — each option should be announced as you move (activedescendant); Enter should accept and announce the completion.
3. **Reorder**: focus a scene in the navigator (Tab), press Alt+Down; verify "Scene N moved to position X of Y" is announced and focus stays on the moved scene. Repeat on an index card.
4. **Dialogs**: open Format & Appearance (Cmd/Ctrl+,); verify focus lands inside, Tab wraps within the dialog, Escape closes and focus returns to the toolbar button. Repeat for rename and the lock confirmation.
5. **Spell check**: right-click (or Shift+F10) a squiggled word; verify the menu announces "Spelling suggestions for X" and each item reads correctly; "Add to dictionary" should be announced and the status region should confirm.
6. **Locked pages**: lock the script from the Revisions panel; verify the confirmation dialog's explanation is read in full, and after locking the status bar announces the lock. Omit a scene from the navigator; verify the OMITTED placeholder is announced in the editor ("Scene 12 omitted").
7. **Notes and documents**: open a Markdown note; verify the edit/preview toggle announces its pressed state and the textarea has a name.
8. **Statistics/status**: after saving (Cmd/Ctrl+S), verify "Saved" is announced without stealing focus.

Record OS, screen-reader version, and any mis-announcements as issues.

## Remaining known gaps

1. Drag-and-drop reorder itself is not announced (the keyboard path is; pointer DnD is inherently visual — acceptable per WAI-ARIA authoring practices as long as the keyboard equivalent exists).
2. The paginated editor's decorations (page-break rules) may be verbose under some screen readers; may need `aria-hidden` on the rule with the label moved to an off-screen live announcement — decide after the human session.
3. Windows forced-colors/high-contrast mode rendering unverified.
