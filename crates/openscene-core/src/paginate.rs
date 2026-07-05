//! Industry-standard pagination engine.
//!
//! Single source of truth for page layout: the editor renders page breaks from
//! this engine's output, and the PDF exporter consumes the very same lines, so
//! screen and paper can never disagree.
//!
//! Page geometry (US Letter, Courier 12pt = 10 cpi, 6 lines per inch):
//! - Page: 8.5" x 11"  -> 85 columns x 66 lines
//! - Top margin 1" (6 lines), bottom margin 1" (6 lines) -> 54 body lines.
//!   The page number rides inside the top margin (line 3).
//! - Left margins (from page left edge, in characters at 10 cpi):
//!     scene heading / action : 1.5"  -> col 15, width 60 (to 7.5")
//!     dialogue               : 2.5"  -> col 25, width 35
//!     parenthetical          : 3.0"  -> col 30, width 25 (per Final Draft)
//!     character cue          : 3.7"  -> col 37
//!     transition             : right-aligned to col 75
//!
//! Break rules implemented (the "professional output" rules):
//! - A scene heading is never orphaned at the bottom of a page: it must be
//!   followed by at least one line of content or it moves to the next page.
//! - A character cue is never separated from its first dialogue line.
//! - A parenthetical is never separated from the dialogue after it.
//! - Dialogue splits only at sentence boundaries, with `(MORE)` at the bottom
//!   and `CHARACTER (CONT'D)` re-cued at the top of the next page. If no
//!   sentence boundary fits, the whole speech moves to the next page.
//! - Consecutive speeches by the same character get an automatic (CONT'D).
//! - Action may break anywhere between lines, but never leaves a single
//!   orphan line when it starts near the very bottom of a page (needs 2 lines).

use crate::model::{Align, DualSide, Element, ElementKind, FormatSpec, LayoutOptions, LockedState, SceneNumbering, Script};
use serde::{Deserialize, Serialize};

pub const PAGE_COLS: usize = 85;
pub const BODY_LINES_PER_PAGE: usize = 54;

pub const ACTION_COL: usize = 15;
pub const ACTION_WIDTH: usize = 60;
pub const DIALOGUE_COL: usize = 25;
pub const DIALOGUE_WIDTH: usize = 35;
pub const PAREN_COL: usize = 30;
pub const PAREN_WIDTH: usize = 25;
pub const CHARACTER_COL: usize = 37;
pub const TRANSITION_RIGHT_COL: usize = 75;
pub const SCENE_NUM_LEFT_COL: usize = 10;
pub const SCENE_NUM_RIGHT_COL: usize = 78;

// Dual dialogue columns: two half-width blocks.
pub const DUAL_LEFT_TEXT_COL: usize = 15;
pub const DUAL_RIGHT_TEXT_COL: usize = 48;
pub const DUAL_TEXT_WIDTH: usize = 28;
pub const DUAL_LEFT_CUE_COL: usize = 22;
pub const DUAL_RIGHT_CUE_COL: usize = 55;

/// What a single physical line on a page is (for rendering and diagnostics).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    Blank,
    SceneHeading,
    Action,
    Character,
    Parenthetical,
    Dialogue,
    Transition,
    Shot,
    More,
    DualColumns,
    ActHeader,
    Lyrics,
}

/// One laid-out physical line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Line {
    pub kind: LineKind,
    /// Column (0-based, in character cells) where the text starts.
    pub col: usize,
    pub text: String,
    /// For dual-dialogue lines: the right column's text and start col.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_col: Option<usize>,
    /// Index into `Script::elements` this line came from (None for MORE/blank).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element: Option<usize>,
    /// Scene number to print in the margins (scene heading lines only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_number: Option<String>,
    /// Line belongs to an element carrying a revision mark (margin asterisk).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub revised: bool,
    /// Draw an underline (act headers, multicam sluglines).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
}

impl Line {
    fn blank() -> Self {
        Line {
            kind: LineKind::Blank,
            col: 0,
            text: String::new(),
            right_text: None,
            right_col: None,
            element: None,
            scene_number: None,
            revised: false,
            underline: false,
        }
    }
    fn text_line(kind: LineKind, col: usize, text: String, element: Option<usize>) -> Self {
        Line {
            kind,
            col,
            text,
            right_text: None,
            right_col: None,
            element,
            scene_number: None,
            revised: false,
            underline: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page {
    /// Physical ordinal (1-based position in the output).
    pub number: usize,
    /// Printed page label: equals the ordinal when unlocked; locked pages
    /// keep their frozen labels and overflow becomes "12A", "12B", ...
    #[serde(default)]
    pub label: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layout {
    pub pages: Vec<Page>,
}

/// A dialogue speech split across a page boundary (MORE/CONT'D point).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DialogueSplit {
    /// Index of the Dialogue element that was split.
    pub element: usize,
    /// Number of NON-whitespace characters of the element's text that stay
    /// on the earlier page. Whitespace-insensitive so word-wrap joining
    /// can't skew the offset; the editor maps it back to a text position.
    pub nonws_chars: usize,
    /// 1-based page number that begins at this split (the CONT'D page).
    pub next_page: usize,
    /// The re-cue printed on the next page, e.g. `MAYA (CONT'D)`.
    pub cont_cue: String,
    /// Printed label of the page that begins at this split.
    #[serde(default)]
    pub next_label: String,
}

/// Summary used by the editor: for each element, which page it starts on,
/// plus exact mid-dialogue split points for MORE/CONT'D display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageMap {
    /// element index -> 1-based page number the element starts on
    pub element_pages: Vec<usize>,
    pub page_count: usize,
    #[serde(default)]
    pub dialogue_splits: Vec<DialogueSplit>,
    /// Printed label per physical page (index = ordinal - 1).
    #[serde(default)]
    pub page_labels: Vec<String>,
    /// Display scene number per element (headings and OMITTED only),
    /// including locked A-numbers derived for new scenes.
    #[serde(default)]
    pub scene_numbers: Vec<Option<String>>,
}

/// Greedy word wrap preserving explicit newlines. Never returns empty vec.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut out = Vec::new();
    for hard in text.split('\n') {
        if hard.trim().is_empty() {
            out.push(String::new());
            continue;
        }
        let mut cur = String::new();
        for word in hard.split_whitespace() {
            let wlen = word.chars().count();
            let clen = cur.chars().count();
            if clen == 0 {
                // A single overlong word gets hard-chopped at width.
                if wlen > width {
                    let mut w: Vec<char> = word.chars().collect();
                    while w.len() > width {
                        out.push(w[..width].iter().collect());
                        w.drain(..width);
                    }
                    cur = w.into_iter().collect();
                } else {
                    cur = word.to_string();
                }
            } else if clen + 1 + wlen <= width {
                cur.push(' ');
                cur.push_str(word);
            } else {
                out.push(std::mem::take(&mut cur));
                if wlen > width {
                    let mut w: Vec<char> = word.chars().collect();
                    while w.len() > width {
                        out.push(w[..width].iter().collect());
                        w.drain(..width);
                    }
                    cur = w.into_iter().collect();
                } else {
                    cur = word.to_string();
                }
            }
        }
        out.push(cur);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// Split wrapped dialogue lines into (first_page, rest) at the last sentence
/// boundary that fits in `avail` lines. Returns None if no clean split exists.
fn split_dialogue_at_sentence(lines: &[String], avail: usize) -> Option<(Vec<String>, Vec<String>)> {
    if avail == 0 || lines.len() <= avail {
        return None;
    }
    // Find the last line index < avail whose line ends a sentence.
    let ends_sentence = |l: &str| {
        let t = l.trim_end();
        t.ends_with('.') || t.ends_with('!') || t.ends_with('?') || t.ends_with('"')
            && (t.len() >= 2 && ".!?".contains(t.chars().rev().nth(1).unwrap_or(' ')))
    };
    for cut in (1..=avail.min(lines.len() - 1)).rev() {
        if ends_sentence(&lines[cut - 1]) {
            return Some((lines[..cut].to_vec(), lines[cut..].to_vec()));
        }
    }
    None
}

/// A logical block: an atomically-placed group of lines plus break metadata.
struct Block {
    lines: Vec<Line>,
    /// Minimum number of `lines` that must stay on the current page for the
    /// block to start there (0 = block may be split anywhere; used with
    /// `splittable`).
    keep_with_next: bool,
    /// Dialogue blocks can be split at sentence boundaries.
    speech: Option<SpeechInfo>,
    /// Action blocks can break between lines (min 2 lines to start a page).
    splittable_action: bool,
    /// Forced page break before this block.
    force_break_before: bool,
    /// Number of blank lines to emit before this block (element spacing).
    space_before: usize,
    /// Index of the first script element this block renders (partitioning).
    first_element: usize,
    /// Locked page labels that start at this block. All but the last emit
    /// empty placeholder pages (anchors whose content was deleted).
    locked_labels: Vec<String>,
}

struct SpeechInfo {
    /// The character cue text (used to re-cue with CONT'D after MORE).
    cue: String,
    cue_col: usize,
    /// Line index in `lines` where dialogue starts being splittable
    /// (i.e. after cue and any leading parenthetical).
    dialogue_start: usize,
    element: Option<usize>,
}

fn scene_number_columns(numbering: SceneNumbering) -> (bool, bool) {
    match numbering {
        SceneNumbering::None => (false, false),
        SceneNumbering::Left => (true, false),
        SceneNumbering::Right => (false, true),
        SceneNumbering::Both => (true, true),
    }
}

/// Compute automatic (CONT'D) for consecutive speeches by the same character
/// and return the display cue for a character element.
fn display_cue(elements: &[Element], idx: usize) -> String {
    let e = &elements[idx];
    let mut cue = e.text.clone();
    let base = cue_base(&cue);
    // Walk backwards to the previous character cue, skipping the elements of
    // this speech; if the same character spoke last (with only their speech
    // and nothing else in between), add (CONT'D).
    let mut j = idx;
    while j > 0 {
        j -= 1;
        match elements[j].kind {
            // Own speech and intervening action/shots don't reset the speaker
            // (Final Draft behavior: action between speeches keeps CONT'D).
            ElementKind::Dialogue
            | ElementKind::Parenthetical
            | ElementKind::Action
            | ElementKind::Shot => continue,
            ElementKind::Character => {
                if cue_base(&elements[j].text) == base
                    && !cue.to_uppercase().contains("(CONT'D)")
                    && elements[idx].dual.is_none()
                    && elements[j].dual.is_none()
                {
                    cue.push_str(" (CONT'D)");
                }
                break;
            }
            // Scene boundaries and transitions reset continuity.
            _ => break,
        }
    }
    cue
}

pub fn cue_base(cue: &str) -> String {
    match cue.find('(') {
        Some(i) => cue[..i].trim().to_uppercase(),
        None => cue.trim().to_uppercase(),
    }
}

/// Display scene numbers per element (headings and OMITTED only).
/// Unlocked: explicit numbers win, gaps auto-count. Locked: explicit numbers
/// win, new scenes derive A-numbers from the previous scene ("12" -> "12A",
/// "12A" -> "12B"), skipping collisions.
pub fn assign_scene_numbers(script: &Script, locked: Option<&LockedState>) -> Vec<Option<String>> {
    assign_scene_numbers_fmt(script, locked, false)
}

/// Lettered numbering (multicam A, B, C…) when `lettered` and unlocked.
pub fn assign_scene_numbers_fmt(
    script: &Script,
    locked: Option<&LockedState>,
    lettered: bool,
) -> Vec<Option<String>> {
    let mut out: Vec<Option<String>> = vec![None; script.elements.len()];
    let mut used: std::collections::HashSet<String> = script
        .elements
        .iter()
        .filter_map(|e| e.scene_number.clone())
        .collect();
    let mut auto = 0usize;
    let mut prev: Option<String> = None;
    for (i, e) in script.elements.iter().enumerate() {
        if e.kind != ElementKind::SceneHeading && e.kind != ElementKind::Omitted {
            continue;
        }
        auto += 1;
        let number = if let Some(n) = &e.scene_number {
            n.clone()
        } else if locked.is_some() {
            let base = prev.clone().unwrap_or_default();
            let mut candidate = next_locked_number(&base);
            while used.contains(&candidate) {
                candidate = next_locked_number(&candidate);
            }
            used.insert(candidate.clone());
            candidate
        } else if lettered {
            letter_label(auto - 1)
        } else {
            auto.to_string()
        };
        prev = Some(number.clone());
        out[i] = Some(number);
    }
    out
}

/// "12" -> "12A", "12A" -> "12B", "12Z" -> "12AA", "" -> "A1".
fn next_locked_number(base: &str) -> String {
    if base.is_empty() {
        return "A1".to_string();
    }
    let trailing: String = base.chars().rev().take_while(|c| c.is_ascii_alphabetic()).collect();
    let stem_len = base.len() - trailing.len();
    let stem = &base[..stem_len];
    if trailing.is_empty() {
        return format!("{}A", stem);
    }
    // Increment the letter suffix like a base-26 counter (A..Z, AA..).
    let mut letters: Vec<char> = trailing.chars().rev().collect();
    let mut idx = letters.len();
    loop {
        if idx == 0 {
            letters.insert(0, 'A');
            break;
        }
        idx -= 1;
        if letters[idx] == 'Z' {
            letters[idx] = 'A';
        } else {
            letters[idx] = ((letters[idx] as u8) + 1) as char;
            break;
        }
    }
    format!("{}{}", stem, letters.into_iter().collect::<String>())
}

/// 0 -> "A", 25 -> "Z", 26 -> "AA" (multicam scene lettering).
pub fn letter_label(mut n: usize) -> String {
    let mut out = Vec::new();
    loop {
        out.push((b'A' + (n % 26) as u8) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    out.into_iter().rev().collect()
}

fn aligned_col(fmt: &crate::model::ElementFormat, text: &str) -> usize {
    let len = text.chars().count();
    match fmt.align {
        Align::Left => fmt.indent_cols,
        Align::Center => (PAGE_COLS.saturating_sub(len)) / 2,
        Align::Right => (fmt.indent_cols + fmt.width_cols).saturating_sub(len),
    }
}

fn cased(fmt: &crate::model::ElementFormat, text: &str) -> String {
    if fmt.uppercase {
        text.to_uppercase()
    } else {
        text.to_string()
    }
}

fn build_blocks(
    script: &Script,
    opts: &LayoutOptions,
    numbers: &[Option<String>],
    fmt: &FormatSpec,
) -> Vec<Block> {
    let (num_left, num_right) = scene_number_columns(opts.scene_numbering);
    let mut blocks: Vec<Block> = Vec::new();
    let elements = &script.elements;
    let mut i = 0usize;
    let mut first_content = true;
    let mut seen_scene = false;

    while i < elements.len() {
        let e = &elements[i];
        match e.kind {
            ElementKind::ActHeader => {
                let text = cased(&fmt.act_header, &e.text);
                let mut lines: Vec<Line> = wrap(&text, fmt.act_header.width_cols)
                    .into_iter()
                    .map(|l| {
                        let col = aligned_col(&fmt.act_header, &l);
                        Line::text_line(LineKind::ActHeader, col, l, Some(i))
                    })
                    .collect();
                for l in &mut lines {
                    l.underline = fmt.act_header.underline;
                }
                blocks.push(Block {
                    lines,
                    keep_with_next: true,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { fmt.act_header.space_before },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Lyrics => {
                let lines: Vec<Line> = wrap(&cased(&fmt.lyrics, &e.text), fmt.lyrics.width_cols)
                    .into_iter()
                    .map(|l| {
                        let col = aligned_col(&fmt.lyrics, &l);
                        Line::text_line(LineKind::Lyrics, col, l, Some(i))
                    })
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: false,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { fmt.lyrics.space_before.max(0) },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Omitted => {
                let number = numbers.get(i).cloned().flatten();
                let mut line = Line::text_line(LineKind::SceneHeading, ACTION_COL, "OMITTED".into(), Some(i));
                if num_left || num_right {
                    line.scene_number = number;
                }
                blocks.push(Block {
                    lines: vec![line],
                    keep_with_next: false,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 2 },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                first_content = false;
                i += 1;
            }
            ElementKind::PageBreak => {
                blocks.push(Block {
                    lines: vec![],
                    keep_with_next: false,
                    speech: None,
                    splittable_action: false,
                    force_break_before: true,
                    space_before: 0,
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                i += 1;
            }
            ElementKind::SceneHeading => {
                let number = numbers.get(i).cloned().flatten().unwrap_or_default();
                let mut lines = Vec::new();
                for (li, l) in wrap(&cased(&fmt.scene_heading, &e.text), fmt.scene_heading.width_cols)
                    .into_iter()
                    .enumerate()
                {
                    let col = aligned_col(&fmt.scene_heading, &l);
                    let mut line = Line::text_line(LineKind::SceneHeading, col, l, Some(i));
                    line.underline = fmt.scene_heading.underline;
                    if li == 0 && (num_left || num_right) {
                        line.scene_number = Some(number.clone());
                    }
                    lines.push(line);
                }
                blocks.push(Block {
                    lines,
                    keep_with_next: true,
                    speech: None,
                    splittable_action: false,
                    force_break_before: fmt.scene_per_page && seen_scene,
                    space_before: if first_content { 0 } else { fmt.scene_heading.space_before },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                seen_scene = true;
                first_content = false;
                i += 1;
            }
            ElementKind::Action => {
                let lines: Vec<Line> = wrap(&cased(&fmt.action, &e.text), fmt.action.width_cols)
                    .into_iter()
                    .map(|l| {
                        let col = aligned_col(&fmt.action, &l);
                        Line::text_line(LineKind::Action, col, l, Some(i))
                    })
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: false,
                    speech: None,
                    splittable_action: true,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { fmt.action.space_before },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Shot => {
                let lines: Vec<Line> = wrap(&cased(&fmt.shot, &e.text), fmt.shot.width_cols)
                    .into_iter()
                    .map(|l| {
                        let col = aligned_col(&fmt.shot, &l);
                        Line::text_line(LineKind::Shot, col, l, Some(i))
                    })
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: true,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Transition => {
                let text = cased(&fmt.transition, &e.text);
                let col = aligned_col(&fmt.transition, &text);
                blocks.push(Block {
                    lines: vec![Line::text_line(LineKind::Transition, col, text, Some(i))],
                    keep_with_next: false,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Character => {
                if e.dual == Some(DualSide::Left) {
                    let (block, next_i) = build_dual_block(elements, i, first_content);
                    blocks.push(block);
                    first_content = false;
                    i = next_i;
                } else {
                    let (block, next_i) = build_speech_block(elements, i, first_content, fmt);
                    blocks.push(block);
                    first_content = false;
                    i = next_i;
                }
            }
            // Orphan parenthetical/dialogue without a cue: render at their
            // columns as a non-splittable block.
            ElementKind::Parenthetical => {
                let lines: Vec<Line> = wrap(&e.text, fmt.parenthetical.width_cols)
                    .into_iter()
                    .map(|l| Line::text_line(LineKind::Parenthetical, fmt.parenthetical.indent_cols, l, Some(i)))
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: true,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Dialogue => {
                let lines: Vec<Line> = wrap(&e.text, fmt.dialogue.width_cols)
                    .into_iter()
                    .map(|l| Line::text_line(LineKind::Dialogue, fmt.dialogue.indent_cols, l, Some(i)))
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: false,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
                    first_element: i,
                    locked_labels: Vec::new(),
                });
                first_content = false;
                i += 1;
            }
        }
    }
    blocks
}

/// Build a normal (single-column) speech block: CHARACTER + (paren|dialogue)*.
fn build_speech_block(
    elements: &[Element],
    start: usize,
    first_content: bool,
    fmt: &FormatSpec,
) -> (Block, usize) {
    let cue = cased(&fmt.character, &display_cue(elements, start));
    let cue_col = aligned_col(&fmt.character, &cue);
    let mut lines = vec![Line::text_line(
        LineKind::Character,
        cue_col,
        cue.clone(),
        Some(start),
    )];
    let double = fmt.dialogue.line_spacing >= 2;
    let mut i = start + 1;
    let mut dialogue_start_line = 1usize;
    let mut seen_dialogue = false;
    let mut speech_element = None;
    while i < elements.len() {
        match elements[i].kind {
            ElementKind::Parenthetical => {
                for l in wrap(&elements[i].text, fmt.parenthetical.width_cols) {
                    lines.push(Line::text_line(
                        LineKind::Parenthetical,
                        fmt.parenthetical.indent_cols,
                        l,
                        Some(i),
                    ));
                }
                if !seen_dialogue {
                    dialogue_start_line = lines.len();
                }
                i += 1;
            }
            ElementKind::Dialogue | ElementKind::Lyrics => {
                let (kind, efmt) = if elements[i].kind == ElementKind::Lyrics {
                    (LineKind::Lyrics, &fmt.lyrics)
                } else {
                    (LineKind::Dialogue, &fmt.dialogue)
                };
                if speech_element.is_none() && kind == LineKind::Dialogue {
                    speech_element = Some(i);
                }
                seen_dialogue = true;
                for l in wrap(&cased(efmt, &elements[i].text), efmt.width_cols) {
                    if double && !lines.is_empty() && lines.last().map(|x| x.kind) == Some(kind) {
                        lines.push(Line::blank());
                    }
                    lines.push(Line::text_line(kind, efmt.indent_cols, l, Some(i)));
                }
                i += 1;
            }
            _ => break,
        }
    }
    (
        Block {
            lines,
            keep_with_next: false,
            speech: Some(SpeechInfo {
                cue,
                cue_col,
                dialogue_start: dialogue_start_line,
                element: speech_element,
            }),
            splittable_action: false,
            force_break_before: false,
            space_before: if first_content { 0 } else { fmt.character.space_before },
            first_element: start,
            locked_labels: Vec::new(),
        },
        i,
    )
}

/// Build a dual-dialogue block: LEFT speech (dual=Left) then RIGHT speech
/// (dual=Right), rendered side by side. Dual blocks never split across pages.
fn build_dual_block(elements: &[Element], start: usize, first_content: bool) -> (Block, usize) {
    fn collect_side(elements: &[Element], mut i: usize, side: DualSide) -> (Vec<(LineKind, Vec<String>)>, usize, Option<usize>) {
        let mut rows: Vec<(LineKind, Vec<String>)> = Vec::new();
        let mut first_el = None;
        if i < elements.len() && elements[i].kind == ElementKind::Character && elements[i].dual == Some(side) {
            first_el = Some(i);
            rows.push((LineKind::Character, vec![elements[i].text.clone()]));
            i += 1;
            while i < elements.len() && elements[i].dual == Some(side) {
                match elements[i].kind {
                    ElementKind::Parenthetical => {
                        rows.push((LineKind::Parenthetical, wrap(&elements[i].text, DUAL_TEXT_WIDTH.saturating_sub(4))));
                    }
                    ElementKind::Dialogue => {
                        rows.push((LineKind::Dialogue, wrap(&elements[i].text, DUAL_TEXT_WIDTH)));
                    }
                    _ => break,
                }
                i += 1;
            }
        }
        (rows, i, first_el)
    }

    let (left_rows, after_left, left_el) = collect_side(elements, start, DualSide::Left);
    let (right_rows, after_right, _right_el) = collect_side(elements, after_left, DualSide::Right);
    let end = if right_rows.is_empty() { after_left } else { after_right };

    // Flatten each side into physical lines with per-line columns.
    fn flatten(rows: Vec<(LineKind, Vec<String>)>, cue_col: usize, text_col: usize) -> Vec<(usize, String)> {
        let mut out = Vec::new();
        for (kind, lines) in rows {
            for l in lines {
                let col = match kind {
                    LineKind::Character => cue_col,
                    LineKind::Parenthetical => text_col + 2,
                    _ => text_col,
                };
                out.push((col, l));
            }
        }
        out
    }
    let left = flatten(left_rows, DUAL_LEFT_CUE_COL, DUAL_LEFT_TEXT_COL);
    let right = flatten(right_rows, DUAL_RIGHT_CUE_COL, DUAL_RIGHT_TEXT_COL);

    let rows = left.len().max(right.len());
    let mut lines = Vec::with_capacity(rows);
    for r in 0..rows {
        let (lc, lt) = left.get(r).cloned().unwrap_or((DUAL_LEFT_TEXT_COL, String::new()));
        let (rc, rt) = right.get(r).cloned().unwrap_or((DUAL_RIGHT_TEXT_COL, String::new()));
        lines.push(Line {
            kind: LineKind::DualColumns,
            col: lc,
            text: lt,
            right_text: Some(rt),
            right_col: Some(rc),
            element: left_el,
            scene_number: None,
            revised: false,
            underline: false,
        });
    }
    (
        Block {
            lines,
            keep_with_next: false,
            speech: None,
            splittable_action: false,
            force_break_before: false,
            space_before: if first_content { 0 } else { 1 },
            first_element: start,
            locked_labels: Vec::new(),
        },
        end,
    )
}

pub fn paginate(script: &Script, opts: &LayoutOptions) -> Layout {
    paginate_full(script, opts).0
}

fn nonws_len(s: &str) -> usize {
    s.chars().filter(|c| !c.is_whitespace()).count()
}

/// Page assembly state with locked-aware label sequencing.
struct Flow {
    pages: Vec<Page>,
    cur: Vec<Line>,
    /// Printed label of the page currently being filled.
    label: String,
    locked: bool,
}

impl Flow {
    fn close(&mut self) {
        let number = self.pages.len() + 1;
        let label = std::mem::take(&mut self.label);
        self.pages.push(Page {
            number,
            label: label.clone(),
            lines: std::mem::take(&mut self.cur),
        });
        // Overflow continuation: locked "12" -> "12A"; unlocked 12 -> 13.
        self.label = next_page_label(&label, self.locked);
    }

    /// Label the page after the current one would get on overflow.
    fn upcoming_label(&self) -> String {
        next_page_label(&self.label, self.locked)
    }

    /// A locked page starts here: finish the current page (if any content)
    /// and adopt the anchor's frozen label.
    fn start_anchor(&mut self, label: &str) {
        if !self.cur.is_empty() {
            self.close();
        }
        self.label = label.to_string();
    }
}

fn next_page_label(label: &str, locked: bool) -> String {
    if locked {
        next_locked_number(label)
    } else {
        label
            .parse::<usize>()
            .map(|n| (n + 1).to_string())
            .unwrap_or_else(|_| next_locked_number(label))
    }
}

/// Resolve a locked anchor to an element index in the current document.
fn resolve_anchor(script: &Script, anchor: &crate::model::LockedPageAnchor) -> Option<usize> {
    let len = script.elements.len();
    if len == 0 {
        return None;
    }
    if anchor.scene.is_empty() {
        return Some(anchor.el_offset.min(len - 1));
    }
    let is_scene = |e: &Element| matches!(e.kind, ElementKind::SceneHeading | ElementKind::Omitted);
    let h = script
        .elements
        .iter()
        .position(|e| is_scene(e) && e.scene_number.as_deref() == Some(anchor.scene.as_str()))?;
    // Clamp the offset to this scene (deleted content anchors at scene end).
    let mut end = len;
    for (j, e) in script.elements.iter().enumerate().skip(h + 1) {
        if is_scene(e) {
            end = j;
            break;
        }
    }
    Some((h + anchor.el_offset).min(end).min(len - 1))
}

/// Apply locked anchors to the block list: labels attach to the blocks where
/// locked pages start, and anchors that fell *inside* a block at lock time
/// (a speech split across the locked boundary) split that block at the
/// recorded non-whitespace offset, re-emitting (MORE)/(CONT'D) for speeches.
///
/// Anchors whose content was deleted entirely resolve to the nearest
/// surviving position via `resolve_anchor` clamping; if a scene is gone
/// without an OMITTED marker its page number drops from the sequence — the
/// supported way to remove a locked scene is Omit, which keeps numbering.
fn apply_locked_anchors(
    script: &Script,
    locked: &LockedState,
    blocks: Vec<Block>,
    pre_splits: &mut Vec<DialogueSplit>,
) -> Vec<Block> {
    struct Resolved {
        label: String,
        el: usize,
        nonws: usize,
    }
    let resolved: Vec<Resolved> = locked
        .pages
        .iter()
        .filter_map(|a| {
            resolve_anchor(script, a).map(|el| Resolved {
                label: a.label.clone(),
                el,
                nonws: a.nonws_offset,
            })
        })
        .collect();

    let ends: Vec<usize> = (0..blocks.len())
        .map(|bi| {
            blocks
                .get(bi + 1)
                .map(|b| b.first_element)
                .unwrap_or(usize::MAX)
        })
        .collect();

    let mut out: Vec<Block> = Vec::with_capacity(blocks.len() + resolved.len());
    let mut ai = 0usize;
    for (bi, block) in blocks.into_iter().enumerate() {
        let mut block = block;
        while ai < resolved.len() && resolved[ai].el >= block.first_element && resolved[ai].el < ends[bi] {
            let a = &resolved[ai];
            ai += 1;
            // Locate the boundary line inside the block for element a.el.
            let mut cum = 0usize;
            let mut cut: Option<usize> = None;
            let mut last_line_of_el: Option<usize> = None;
            for (li, line) in block.lines.iter().enumerate() {
                if line.element == Some(a.el) {
                    last_line_of_el = Some(li);
                    if cum >= a.nonws && a.nonws > 0 {
                        cut = Some(li);
                        break;
                    }
                    cum += nonws_len(&line.text);
                }
            }
            // nonws == 0 means the element started the locked page whole.
            let cut = if a.nonws == 0 {
                None
            } else {
                cut.or(last_line_of_el.map(|li| li + 1)) // element shrank: cut after it
            };
            match cut {
                Some(li) if li > 0 && li < block.lines.len() => {
                    let tail_lines: Vec<Line> = block.lines.split_off(li);
                    let mut head = std::mem::replace(
                        &mut block,
                        Block {
                            lines: tail_lines,
                            keep_with_next: false,
                            speech: None,
                            splittable_action: false,
                            force_break_before: false,
                            space_before: 0,
                            first_element: a.el,
                            locked_labels: vec![a.label.clone()],
                        },
                    );
                    block.splittable_action = head.splittable_action;
                    if let Some(sp) = head.speech.take() {
                        head.lines.push(Line::text_line(
                            LineKind::More,
                            DIALOGUE_COL,
                            "(MORE)".into(),
                            None,
                        ));
                        let mut cont = sp.cue.clone();
                        if !cont.to_uppercase().contains("(CONT'D)") {
                            cont.push_str(" (CONT'D)");
                        }
                        block.lines.insert(
                            0,
                            Line::text_line(LineKind::Character, sp.cue_col, cont.clone(), None),
                        );
                        block.speech = Some(SpeechInfo {
                            cue: cont.clone(),
                            cue_col: sp.cue_col,
                            dialogue_start: 1,
                            element: Some(a.el),
                        });
                        pre_splits.push(DialogueSplit {
                            element: a.el,
                            nonws_chars: a.nonws,
                            next_page: 0, // ordinal fixed up after flow
                            cont_cue: cont,
                            next_label: a.label.clone(),
                        });
                    }
                    out.push(head);
                }
                _ => {
                    // Boundary at (or collapsed to) the block start.
                    block.locked_labels.push(a.label.clone());
                }
            }
        }
        out.push(block);
    }
    out
}

pub fn paginate_full(script: &Script, opts: &LayoutOptions) -> (Layout, Vec<DialogueSplit>) {
    let fmt = opts.format.clone().unwrap_or_default();
    let numbers = assign_scene_numbers_fmt(script, opts.locked.as_ref(), fmt.lettered_scenes);
    let mut blocks = build_blocks(script, opts, &numbers, &fmt);
    let mut pre_splits: Vec<DialogueSplit> = Vec::new();
    if let Some(locked) = &opts.locked {
        blocks = apply_locked_anchors(script, locked, blocks, &mut pre_splits);
    }

    let mut flow = Flow {
        pages: Vec::new(),
        cur: Vec::new(),
        label: "1".to_string(),
        locked: opts.locked.is_some(),
    };
    let mut splits: Vec<DialogueSplit> = Vec::new();

    for b in blocks {
        // Locked page starts: all but the last label are anchors whose
        // content vanished — they become empty pages that keep numbering.
        if !b.locked_labels.is_empty() {
            let last = b.locked_labels.len() - 1;
            for (li, label) in b.locked_labels.iter().enumerate() {
                flow.start_anchor(label);
                if li < last {
                    flow.close(); // empty placeholder page
                }
            }
        }
        if b.force_break_before {
            if !flow.cur.is_empty() {
                flow.close();
            }
            continue;
        }
        let space = if flow.cur.is_empty() { 0 } else { b.space_before };
        let avail = BODY_LINES_PER_PAGE.saturating_sub(flow.cur.len() + space);
        let need = b.lines.len();

        // Minimum lines the block needs on this page to start here.
        let min_here = if b.keep_with_next {
            // Heading/shot must carry at least one following content line;
            // approximate by requiring heading + 2 lines of room.
            need + 2
        } else if let Some(sp) = &b.speech {
            // Cue + (any parentheticals) + at least one dialogue line.
            (sp.dialogue_start + 1).min(need).max(2)
        } else if b.splittable_action {
            2.min(need)
        } else {
            need
        };

        if need <= avail {
            for _ in 0..space {
                flow.cur.push(Line::blank());
            }
            flow.cur.extend(b.lines);
            continue;
        }

        if min_here > avail {
            // Doesn't fit at all: push to next page.
            flow.close();
            flow.cur.extend(b.lines);
            // Overflow safety: a single block taller than a page spills.
            while flow.cur.len() > BODY_LINES_PER_PAGE {
                let rest = flow.cur.split_off(BODY_LINES_PER_PAGE);
                flow.close();
                flow.cur = rest;
            }
            continue;
        }

        // The block starts on this page and must be split.
        if b.splittable_action {
            let mut lines = b.lines;
            let take = avail.min(lines.len());
            // Don't leave a single orphan line of a multi-line action.
            let take = if lines.len() > take && take == 1 { 0 } else { take };
            if take > 0 {
                for _ in 0..space {
                    flow.cur.push(Line::blank());
                }
                let rest = lines.split_off(take);
                flow.cur.extend(lines);
                lines = rest;
            }
            flow.close();
            // Keep filling full pages until the remainder fits.
            while lines.len() > BODY_LINES_PER_PAGE {
                let rest = lines.split_off(BODY_LINES_PER_PAGE);
                flow.cur.extend(lines);
                flow.close();
                lines = rest;
            }
            flow.cur.extend(lines);
            continue;
        }

        if let Some(sp) = b.speech {
            // Try a sentence-boundary split of the dialogue portion.
            let head: Vec<Line> = b.lines[..sp.dialogue_start].to_vec();
            let dlg: Vec<Line> = b.lines[sp.dialogue_start..].to_vec();
            // Only split within a contiguous run of Dialogue lines; a
            // mid-speech parenthetical blocks splitting past it.
            let mut splittable_len = 0usize;
            for l in &dlg {
                if l.kind == LineKind::Dialogue {
                    splittable_len += 1;
                } else {
                    break;
                }
            }
            let dlg_texts: Vec<String> = dlg[..splittable_len].iter().map(|l| l.text.clone()).collect();
            // Lines available for dialogue on this page: avail - head - MORE line.
            let for_dialogue = avail.saturating_sub(head.len() + 1);
            match split_dialogue_at_sentence(&dlg_texts, for_dialogue) {
                Some((first, rest)) if !first.is_empty() => {
                    // Record the exact split point for the editor: how many
                    // non-whitespace chars of the split element stay on the
                    // earlier page.
                    let cut = first.len();
                    let split_element = dlg.get(cut).and_then(|l| l.element);
                    if let Some(se) = split_element {
                        let consumed: usize = dlg[..cut]
                            .iter()
                            .filter(|l| l.element == Some(se))
                            .map(|l| nonws_len(&l.text))
                            .sum();
                        let mut cc = sp.cue.clone();
                        if !cc.to_uppercase().contains("(CONT'D)") {
                            cc.push_str(" (CONT'D)");
                        }
                        splits.push(DialogueSplit {
                            element: se,
                            nonws_chars: consumed,
                            next_page: flow.pages.len() + 2, // current page + 1
                            cont_cue: cc,
                            next_label: flow.upcoming_label(),
                        });
                    }
                    for _ in 0..space {
                        flow.cur.push(Line::blank());
                    }
                    flow.cur.extend(head);
                    for t in first {
                        flow.cur.push(Line::text_line(LineKind::Dialogue, fmt.dialogue.indent_cols, t, sp.element));
                    }
                    flow.cur.push(Line::text_line(LineKind::More, fmt.dialogue.indent_cols, "(MORE)".into(), None));
                    flow.close();
                    // Re-cue with (CONT'D).
                    let mut cont_cue = sp.cue.clone();
                    if !cont_cue.to_uppercase().contains("(CONT'D)") {
                        cont_cue.push_str(" (CONT'D)");
                    }
                    flow.cur.push(Line::text_line(LineKind::Character, sp.cue_col, cont_cue, None));
                    for t in rest {
                        flow.cur.push(Line::text_line(LineKind::Dialogue, fmt.dialogue.indent_cols, t, sp.element));
                    }
                    // Remaining non-splittable tail (parentheticals etc.).
                    flow.cur.extend(dlg[splittable_len..].iter().cloned());
                    continue;
                }
                _ => {
                    // No clean split: move the whole speech to the next page.
                    flow.close();
                    flow.cur.extend(b.lines);
                    while flow.cur.len() > BODY_LINES_PER_PAGE {
                        let rest = flow.cur.split_off(BODY_LINES_PER_PAGE);
                        flow.close();
                        flow.cur = rest;
                    }
                    continue;
                }
            }
        }

        // keep_with_next blocks that reach here start on the next page.
        flow.close();
        flow.cur.extend(b.lines);
        while flow.cur.len() > BODY_LINES_PER_PAGE {
            let rest = flow.cur.split_off(BODY_LINES_PER_PAGE);
            flow.close();
            flow.cur = rest;
        }
    }
    if !flow.cur.is_empty() || flow.pages.is_empty() {
        flow.close();
    }
    let mut pages = flow.pages;
    // Locked mid-element splits recorded before flow get their physical
    // page ordinal from the label they anchor.
    for sp in &mut pre_splits {
        if sp.next_page == 0 {
            sp.next_page = pages
                .iter()
                .find(|p| p.label == sp.next_label)
                .map(|p| p.number)
                .unwrap_or(1);
        }
    }
    splits.append(&mut pre_splits);
    splits.sort_by_key(|s| (s.element, s.nonws_chars));
    // Revision marks: flag every physical line of a revision-marked element.
    for page in &mut pages {
        for line in &mut page.lines {
            if let Some(el) = line.element {
                if script.elements.get(el).map(|e| e.revision.is_some()) == Some(true) {
                    line.revised = true;
                }
            }
        }
    }
    (Layout { pages }, splits)
}

/// Materialize display scene numbers into the document (lock time).
pub fn materialize_scene_numbers(script: &Script) -> Script {
    let numbers = assign_scene_numbers(script, None);
    let mut s = script.clone();
    for (i, e) in s.elements.iter_mut().enumerate() {
        if matches!(e.kind, ElementKind::SceneHeading | ElementKind::Omitted) {
            e.scene_number = numbers[i].clone();
        }
    }
    s
}

/// Lock the script: materialize scene numbers, paginate freely once, and
/// freeze every page's start as an anchor. Returns the materialized script
/// (to be written back to the document) and the locked state (project.json).
pub fn compute_lock(script: &Script, opts: &LayoutOptions) -> (Script, LockedState) {
    let script = materialize_scene_numbers(script);
    let free = LayoutOptions {
        locked: None,
        ..opts.clone()
    };
    let (layout, _) = paginate_full(&script, &free);
    let is_scene = |e: &Element| matches!(e.kind, ElementKind::SceneHeading | ElementKind::Omitted);
    let mut anchors = Vec::new();
    for (pi, page) in layout.pages.iter().enumerate() {
        let Some(el) = page.lines.iter().find_map(|l| l.element) else {
            continue;
        };
        let mut heading = None;
        for j in (0..=el).rev() {
            if is_scene(&script.elements[j]) {
                heading = Some(j);
                break;
            }
        }
        let (scene, el_offset) = match heading {
            Some(h) => (
                script.elements[h].scene_number.clone().unwrap_or_default(),
                el - h,
            ),
            None => (String::new(), el),
        };
        // If this page starts mid-element (a split speech/action carried
        // over), record how much of the element earlier pages consumed.
        let nonws_offset: usize = layout.pages[..pi]
            .iter()
            .flat_map(|p| &p.lines)
            .filter(|l| l.element == Some(el))
            .map(|l| nonws_len(&l.text))
            .sum();
        anchors.push(crate::model::LockedPageAnchor {
            label: page.label.clone(),
            scene,
            el_offset,
            nonws_offset,
        });
    }
    let scenes = script
        .elements
        .iter()
        .filter(|e| is_scene(e))
        .filter_map(|e| e.scene_number.clone())
        .collect();
    let state = LockedState {
        pages: anchors,
        scenes,
        date: chrono::Local::now().format("%Y-%m-%d").to_string(),
    };
    (script, state)
}

/// Editor-facing summary: page number per element + mid-dialogue splits.
pub fn page_map(script: &Script, opts: &LayoutOptions) -> PageMap {
    let (layout, dialogue_splits) = paginate_full(script, opts);
    let mut element_pages = vec![1usize; script.elements.len()];
    let mut seen = vec![false; script.elements.len()];
    for page in &layout.pages {
        for line in &page.lines {
            if let Some(el) = line.element {
                if el < element_pages.len() && !seen[el] {
                    element_pages[el] = page.number;
                    seen[el] = true;
                }
            }
        }
    }
    PageMap {
        element_pages,
        page_count: layout.pages.len(),
        dialogue_splits,
        page_labels: layout.pages.iter().map(|p| p.label.clone()).collect(),
        scene_numbers: assign_scene_numbers_fmt(
            script,
            opts.locked.as_ref(),
            opts.format.as_ref().map(|f| f.lettered_scenes).unwrap_or(false),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Element, ElementKind, Script};

    fn action_of_lines(n: usize) -> Element {
        // Each "Line N." fits on one wrapped line.
        let text: Vec<String> = (0..n).map(|i| format!("Line {}.", i)).collect();
        Element::new(ElementKind::Action, text.join("\n"))
    }

    fn opts() -> LayoutOptions {
        LayoutOptions::default()
    }

    #[test]
    fn empty_script_has_one_page() {
        let layout = paginate(&Script::default(), &opts());
        assert_eq!(layout.pages.len(), 1);
    }

    #[test]
    fn scene_heading_never_orphaned_at_page_bottom() {
        let mut s = Script::default();
        // Fill page so exactly 1 line remains, then heading + action.
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 1));
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. LAB - NIGHT"));
        s.elements.push(Element::new(ElementKind::Action, "Sparks."));
        let layout = paginate(&s, &opts());
        assert_eq!(layout.pages.len(), 2);
        // Heading must be the first line of page 2, not the last of page 1.
        let p1 = &layout.pages[0];
        assert!(p1.lines.iter().all(|l| l.kind != LineKind::SceneHeading));
        let p2 = &layout.pages[1];
        assert_eq!(p2.lines[0].kind, LineKind::SceneHeading);
        assert_eq!(p2.lines[0].text, "INT. LAB - NIGHT");
    }

    #[test]
    fn character_cue_never_separated_from_dialogue() {
        let mut s = Script::default();
        // Leave exactly 2 lines on page 1: blank + cue would fit, dialogue not.
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 2));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Dialogue, "Hello there."));
        let layout = paginate(&s, &opts());
        assert_eq!(layout.pages.len(), 2);
        let p1 = &layout.pages[0];
        assert!(p1.lines.iter().all(|l| l.kind != LineKind::Character));
        let p2 = &layout.pages[1];
        assert_eq!(p2.lines[0].kind, LineKind::Character);
        assert_eq!(p2.lines[1].kind, LineKind::Dialogue);
    }

    #[test]
    fn parenthetical_never_separated_from_dialogue() {
        let mut s = Script::default();
        // Room for cue + paren but not the first dialogue line.
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 3));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Parenthetical, "(whispering)"));
        s.elements.push(Element::new(ElementKind::Dialogue, "Hello."));
        let layout = paginate(&s, &opts());
        assert_eq!(layout.pages.len(), 2);
        let p2 = &layout.pages[1];
        assert_eq!(p2.lines[0].kind, LineKind::Character);
        assert_eq!(p2.lines[1].kind, LineKind::Parenthetical);
        assert_eq!(p2.lines[2].kind, LineKind::Dialogue);
    }

    #[test]
    fn long_dialogue_splits_at_sentence_with_more_contd() {
        let mut s = Script::default();
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 6));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        // Multiple sentences, each on its own wrapped line.
        let sentences: Vec<String> = (0..10).map(|i| format!("Sentence number {}.", i)).collect();
        s.elements.push(Element::new(ElementKind::Dialogue, sentences.join("\n")));
        let layout = paginate(&s, &opts());
        assert_eq!(layout.pages.len(), 2);
        let p1 = &layout.pages[0];
        let last = p1.lines.last().unwrap();
        assert_eq!(last.kind, LineKind::More);
        assert_eq!(last.text, "(MORE)");
        let p2 = &layout.pages[1];
        assert_eq!(p2.lines[0].kind, LineKind::Character);
        assert_eq!(p2.lines[0].text, "MAYA (CONT'D)");
        assert_eq!(p2.lines[1].kind, LineKind::Dialogue);
        // All 10 sentences survive the split.
        let total: usize = layout
            .pages
            .iter()
            .flat_map(|p| &p.lines)
            .filter(|l| l.kind == LineKind::Dialogue)
            .count();
        assert_eq!(total, 10);
    }

    #[test]
    fn dialogue_with_no_sentence_boundary_moves_whole() {
        let mut s = Script::default();
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 4));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        // One run-on sentence wrapping to many lines; no split point.
        let word = "word ".repeat(60);
        s.elements.push(Element::new(ElementKind::Dialogue, word.trim().to_string()));
        let layout = paginate(&s, &opts());
        assert_eq!(layout.pages.len(), 2);
        let p1 = &layout.pages[0];
        assert!(p1.lines.iter().all(|l| l.kind != LineKind::Character));
        assert!(p1.lines.iter().all(|l| l.kind != LineKind::More));
        assert_eq!(layout.pages[1].lines[0].kind, LineKind::Character);
    }

    #[test]
    fn consecutive_speeches_same_character_get_contd() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Dialogue, "First."));
        s.elements.push(Element::new(ElementKind::Action, "She pauses."));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Dialogue, "Second."));
        s.elements.push(Element::new(ElementKind::Character, "JONES"));
        s.elements.push(Element::new(ElementKind::Dialogue, "Third."));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Dialogue, "Fourth."));
        let layout = paginate(&s, &opts());
        let cues: Vec<&str> = layout.pages[0]
            .lines
            .iter()
            .filter(|l| l.kind == LineKind::Character)
            .map(|l| l.text.as_str())
            .collect();
        // Action between speeches does NOT suppress CONT'D (industry default).
        assert_eq!(cues, vec!["MAYA", "MAYA (CONT'D)", "JONES", "MAYA"]);
    }

    #[test]
    fn forced_page_break_starts_new_page() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::Action, "Page one."));
        s.elements.push(Element::new(ElementKind::PageBreak, ""));
        s.elements.push(Element::new(ElementKind::Action, "Page two."));
        let layout = paginate(&s, &opts());
        assert_eq!(layout.pages.len(), 2);
        assert_eq!(layout.pages[1].lines[0].text, "Page two.");
    }

    #[test]
    fn action_never_leaves_single_orphan_line() {
        let mut s = Script::default();
        // One line free after spacing: a 5-line action must not leave 1 line.
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 2));
        s.elements.push(action_of_lines(5));
        let layout = paginate(&s, &opts());
        assert_eq!(layout.pages.len(), 2);
        let p2 = &layout.pages[1];
        let count_p2 = p2.lines.iter().filter(|l| l.kind == LineKind::Action).count();
        assert_eq!(count_p2, 5, "whole action moves rather than orphaning 1 line");
    }

    #[test]
    fn dual_dialogue_renders_side_by_side_and_does_not_split() {
        let mut s = Script::default();
        let mut l = Element::new(ElementKind::Character, "MAYA");
        l.dual = Some(crate::model::DualSide::Left);
        let mut ld = Element::new(ElementKind::Dialogue, "Go left! Now!");
        ld.dual = Some(crate::model::DualSide::Left);
        let mut r = Element::new(ElementKind::Character, "JONES");
        r.dual = Some(crate::model::DualSide::Right);
        let mut rd = Element::new(ElementKind::Dialogue, "Go right! Hurry!");
        rd.dual = Some(crate::model::DualSide::Right);
        s.elements.push(l);
        s.elements.push(ld);
        s.elements.push(r);
        s.elements.push(rd);
        let layout = paginate(&s, &opts());
        let duals: Vec<&Line> = layout.pages[0]
            .lines
            .iter()
            .filter(|l| l.kind == LineKind::DualColumns)
            .collect();
        assert!(!duals.is_empty());
        assert_eq!(duals[0].text, "MAYA");
        assert_eq!(duals[0].right_text.as_deref(), Some("JONES"));
    }

    #[test]
    fn fifty_five_ish_lines_per_page() {
        // A long uniform action script paginates at BODY_LINES_PER_PAGE.
        let mut s = Script::default();
        s.elements.push(action_of_lines(200));
        let layout = paginate(&s, &opts());
        assert_eq!(layout.pages[0].lines.len(), BODY_LINES_PER_PAGE);
        assert_eq!(layout.pages.len(), (200 + BODY_LINES_PER_PAGE - 1) / BODY_LINES_PER_PAGE);
    }

    #[test]
    fn scene_numbers_appear_when_enabled() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. A - DAY"));
        s.elements.push(Element::new(ElementKind::Action, "X."));
        let mut h2 = Element::new(ElementKind::SceneHeading, "EXT. B - NIGHT");
        h2.scene_number = Some("2A".into());
        s.elements.push(h2);
        s.elements.push(Element::new(ElementKind::Action, "Y."));
        let layout = paginate(
            &s,
            &LayoutOptions {
                scene_numbering: SceneNumbering::Both,
                ..LayoutOptions::default()
            },
        );
        let nums: Vec<Option<&str>> = layout.pages[0]
            .lines
            .iter()
            .filter(|l| l.kind == LineKind::SceneHeading)
            .map(|l| l.scene_number.as_deref())
            .collect();
        assert_eq!(nums, vec![Some("1"), Some("2A")]);
    }

    #[test]
    fn page_map_reports_exact_dialogue_split_points() {
        let mut s = Script::default();
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 6));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        let sentences: Vec<String> = (0..10).map(|i| format!("Sentence number {}.", i)).collect();
        s.elements.push(Element::new(ElementKind::Dialogue, sentences.join("\n")));
        let pm = page_map(&s, &opts());
        assert_eq!(pm.dialogue_splits.len(), 1);
        let split = &pm.dialogue_splits[0];
        assert_eq!(split.element, 2);
        assert_eq!(split.next_page, 2);
        assert_eq!(split.cont_cue, "MAYA (CONT'D)");
        // The consumed non-whitespace chars must match a whole number of
        // sentences ("Sentencenumber0." = 16 non-ws chars each).
        assert!(split.nonws_chars > 0);
        assert_eq!(split.nonws_chars % 16, 0, "{}", split.nonws_chars);
        // And equal what the layout actually put on page 1.
        let (layout, _) = paginate_full(&s, &opts());
        let on_p1: usize = layout.pages[0]
            .lines
            .iter()
            .filter(|l| l.kind == LineKind::Dialogue)
            .map(|l| nonws_len(&l.text))
            .sum();
        assert_eq!(split.nonws_chars, on_p1);
    }

    // --- Format parameterization golden tests ---------------------------

    fn full_sample() -> Script {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::ActHeader, "ACT ONE"));
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. LAB - NIGHT"));
        s.elements.push(action_of_lines(20));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Parenthetical, "(quiet)"));
        s.elements.push(Element::new(ElementKind::Dialogue, "We should not be here. Not tonight."));
        s.elements.push(Element::new(ElementKind::Transition, "CUT TO:"));
        s.elements.push(Element::new(ElementKind::SceneHeading, "EXT. STREET - DAY"));
        s.elements.push(action_of_lines(60));
        s.elements.push(Element::new(ElementKind::Character, "JONES"));
        s.elements.push(Element::new(ElementKind::Lyrics, "A quiet song\nFor a loud street"));
        s
    }

    #[test]
    fn default_format_is_byte_identical_to_none() {
        let s = full_sample();
        let none = paginate(&s, &LayoutOptions::default());
        let some = paginate(
            &s,
            &LayoutOptions {
                format: Some(FormatSpec::default()),
                ..LayoutOptions::default()
            },
        );
        assert_eq!(none, some, "FormatSpec::default() must not change pagination");
    }

    #[test]
    fn multicam_format_double_spaces_dialogue_and_pages_scenes() {
        let mut fmt = FormatSpec::default();
        fmt.dialogue.line_spacing = 2;
        fmt.scene_heading.underline = true;
        fmt.scene_per_page = true;
        fmt.lettered_scenes = true;
        fmt.minutes_per_page = 0.5;
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. STAGE - DAY"));
        s.elements.push(Element::new(ElementKind::Character, "HOST"));
        s.elements.push(Element::new(ElementKind::Dialogue, "Line one here.\nLine two here."));
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. KITCHEN - DAY"));
        s.elements.push(Element::new(ElementKind::Action, "Beat."));
        let o = LayoutOptions {
            format: Some(fmt),
            scene_numbering: SceneNumbering::Both,
            ..LayoutOptions::default()
        };
        let (layout, _) = paginate_full(&s, &o);
        // Each scene starts a new page.
        assert_eq!(layout.pages.len(), 2);
        // Scenes letter A, B.
        let pm = page_map(&s, &o);
        assert_eq!(pm.scene_numbers[0].as_deref(), Some("A"));
        assert_eq!(pm.scene_numbers[3].as_deref(), Some("B"));
        // Dialogue is double-spaced: a blank line between the two lines.
        let p1 = &layout.pages[0];
        let dlg: Vec<&Line> = p1.lines.iter().filter(|l| l.kind == LineKind::Dialogue).collect();
        assert_eq!(dlg.len(), 2);
        let i1 = p1.lines.iter().position(|l| l.kind == LineKind::Dialogue).unwrap();
        assert_eq!(p1.lines[i1 + 1].kind, LineKind::Blank);
        assert_eq!(p1.lines[i1 + 2].kind, LineKind::Dialogue);
        // Sluglines carry the underline flag.
        assert!(p1.lines.iter().any(|l| l.kind == LineKind::SceneHeading && l.underline));
    }

    #[test]
    fn stage_play_format_centers_character_cues() {
        let mut fmt = FormatSpec::default();
        fmt.character.align = Align::Center;
        fmt.character.indent_cols = 0;
        fmt.character.width_cols = PAGE_COLS;
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Dialogue, "To be here."));
        let o = LayoutOptions {
            format: Some(fmt),
            ..LayoutOptions::default()
        };
        let (layout, _) = paginate_full(&s, &o);
        let cue = layout.pages[0]
            .lines
            .iter()
            .find(|l| l.kind == LineKind::Character)
            .unwrap();
        assert_eq!(cue.col, (PAGE_COLS - 4) / 2, "centered cue");
    }

    #[test]
    fn act_headers_center_and_keep_with_next() {
        let mut s = Script::default();
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 2));
        s.elements.push(Element::new(ElementKind::ActHeader, "ACT TWO"));
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. A - DAY"));
        s.elements.push(Element::new(ElementKind::Action, "Go."));
        let (layout, _) = paginate_full(&s, &LayoutOptions::default());
        // Header never orphaned at page bottom.
        assert!(layout.pages[0].lines.iter().all(|l| l.kind != LineKind::ActHeader));
        let p2 = &layout.pages[1];
        assert_eq!(p2.lines[0].kind, LineKind::ActHeader);
        assert!(p2.lines[0].underline);
        assert_eq!(p2.lines[0].col, (PAGE_COLS - 7) / 2);
    }

    // --- Locked pages / A-scenes golden tests ---------------------------

    /// Two locked pages: scene 1 fills page 1 exactly, scene 2 on page 2.
    fn locked_fixture() -> (Script, LockedState, LayoutOptions) {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. ONE - DAY"));
        // Heading(1) + blank(2) + 51 action lines = 54 -> page 1 exactly full.
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 3));
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. TWO - DAY"));
        s.elements.push(Element::new(ElementKind::Action, "Second scene."));
        let (script, lock) = compute_lock(&s, &opts());
        let o = LayoutOptions {
            locked: Some(lock.clone()),
            ..opts()
        };
        (script, lock, o)
    }

    #[test]
    fn lock_freezes_page_labels() {
        let (script, lock, o) = locked_fixture();
        assert_eq!(lock.pages.len(), 2);
        assert_eq!(lock.scenes, vec!["1".to_string(), "2".to_string()]);
        // Scene numbers were materialized into the document.
        assert_eq!(script.elements[0].scene_number.as_deref(), Some("1"));
        let (layout, _) = paginate_full(&script, &o);
        assert_eq!(layout.pages.len(), 2);
        assert_eq!(layout.pages[0].label, "1");
        assert_eq!(layout.pages[1].label, "2");
    }

    #[test]
    fn edit_overflow_creates_a_page_without_reflowing_later_pages() {
        let (mut script, _, o) = locked_fixture();
        // Grow scene 1 so it can't fit on page 1 anymore.
        script.elements[1] = action_of_lines(BODY_LINES_PER_PAGE + 10);
        let (layout, _) = paginate_full(&script, &o);
        let labels: Vec<&str> = layout.pages.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, vec!["1", "1A", "2"], "{:?}", labels);
        // Scene 2 still starts at the top of its locked page.
        let p2 = &layout.pages[2];
        assert_eq!(p2.lines[0].kind, LineKind::SceneHeading);
        assert_eq!(p2.lines[0].text, "INT. TWO - DAY");
    }

    #[test]
    fn deletion_leaves_short_pages_and_keeps_labels() {
        let (mut script, _, o) = locked_fixture();
        // Shrink scene 1 to a couple of lines.
        script.elements[1] = action_of_lines(2);
        let (layout, _) = paginate_full(&script, &o);
        let labels: Vec<&str> = layout.pages.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, vec!["1", "2"]);
        assert!(layout.pages[0].lines.len() < BODY_LINES_PER_PAGE, "short page expected");
        assert_eq!(layout.pages[1].lines[0].text, "INT. TWO - DAY");
    }

    #[test]
    fn inserted_scene_gets_a_number_while_locked() {
        let (mut script, lock, o) = locked_fixture();
        // Insert a new (un-numbered) scene between scene 1 and scene 2.
        script.elements.insert(2, Element::new(ElementKind::Action, "New material."));
        script.elements.insert(2, Element::new(ElementKind::SceneHeading, "INT. NEW - DAY"));
        let numbers = assign_scene_numbers(&script, Some(&lock));
        let assigned: Vec<Option<&str>> = script
            .elements
            .iter()
            .enumerate()
            .filter(|(_, e)| e.kind == ElementKind::SceneHeading)
            .map(|(i, _)| numbers[i].as_deref())
            .collect();
        assert_eq!(assigned, vec![Some("1"), Some("1A"), Some("2")]);
        // A second inserted scene after 1A becomes 1B.
        script.elements.insert(4, Element::new(ElementKind::SceneHeading, "INT. NEWER - DAY"));
        let numbers = assign_scene_numbers(&script, Some(&lock));
        assert_eq!(numbers[4].as_deref(), Some("1B"));
        let _ = o;
    }

    #[test]
    fn omitted_scene_keeps_number_and_renders() {
        let (mut script, _, o) = locked_fixture();
        // Omit scene 2: replace heading + content with an OMITTED marker.
        let mut om = Element::new(ElementKind::Omitted, "");
        om.scene_number = Some("2".into());
        script.elements.truncate(2);
        script.elements.push(om);
        let o = LayoutOptions {
            scene_numbering: SceneNumbering::Both,
            ..o
        };
        let (layout, _) = paginate_full(&script, &o);
        let labels: Vec<&str> = layout.pages.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, vec!["1", "2"]);
        let p2 = &layout.pages[1];
        assert_eq!(p2.lines[0].text, "OMITTED");
        assert_eq!(p2.lines[0].scene_number.as_deref(), Some("2"));
    }

    #[test]
    fn unlock_and_relock_renumbers_sequentially() {
        let (mut script, _, o) = locked_fixture();
        script.elements[1] = action_of_lines(BODY_LINES_PER_PAGE + 10);
        // While locked: overflow keeps the frozen numbering (1, 1A, 2).
        let (locked_layout, _) = paginate_full(&script, &o);
        let locked_labels: Vec<&str> = locked_layout.pages.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(locked_labels, vec!["1", "1A", "2"]);
        // Relock: free reflow first, then sequential labels frozen fresh.
        let (script2, lock2) = compute_lock(&script, &LayoutOptions { locked: None, ..o.clone() });
        let expected: Vec<String> = {
            let (free, _) = paginate_full(&script2, &LayoutOptions { locked: None, ..opts() });
            (1..=free.pages.len()).map(|n| n.to_string()).collect()
        };
        let relocked = LayoutOptions {
            locked: Some(lock2),
            ..opts()
        };
        let (layout, _) = paginate_full(&script2, &relocked);
        let labels: Vec<String> = layout.pages.iter().map(|p| p.label.clone()).collect();
        assert_eq!(labels, expected);
        // No A-pages remain after relock.
        assert!(labels.iter().all(|l| l.chars().all(|c| c.is_ascii_digit())));
    }

    #[test]
    fn locked_pages_compose_with_dialogue_splits_and_revisions() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. ONE - DAY"));
        s.elements.push(action_of_lines(BODY_LINES_PER_PAGE - 9));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        let sentences: Vec<String> = (0..10).map(|i| format!("Sentence number {}.", i)).collect();
        let mut d = Element::new(ElementKind::Dialogue, sentences.join("\n"));
        d.revision = Some("blue".into());
        s.elements.push(d);
        let (script, lock) = compute_lock(&s, &opts());
        let o = LayoutOptions {
            locked: Some(lock),
            ..opts()
        };
        let (layout, splits) = paginate_full(&script, &o);
        // The speech splits across the locked boundary with MORE/CONT'D.
        assert_eq!(splits.len(), 1);
        assert_eq!(splits[0].next_label, layout.pages[1].label);
        let p1_last = layout.pages[0].lines.last().unwrap();
        assert_eq!(p1_last.kind, LineKind::More);
        assert_eq!(layout.pages[1].lines[0].text, "MAYA (CONT'D)");
        // Revision marks survive on locked pages.
        assert!(layout
            .pages
            .iter()
            .flat_map(|p| &p.lines)
            .any(|l| l.revised && l.kind == LineKind::Dialogue));
    }

    #[test]
    fn wrap_respects_width_and_newlines() {
        let lines = wrap("alpha beta gamma delta", 11);
        assert_eq!(lines, vec!["alpha beta", "gamma delta"]);
        let lines = wrap("one\ntwo", 60);
        assert_eq!(lines, vec!["one", "two"]);
    }
}
