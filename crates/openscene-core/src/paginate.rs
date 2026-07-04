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

use crate::model::{DualSide, Element, ElementKind, LayoutOptions, SceneNumbering, Script};
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
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page {
    pub number: usize,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layout {
    pub pages: Vec<Page>,
}

/// Summary used by the editor: for each element, which page it starts on,
/// plus the (element, line-offset) positions where page breaks fall.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageMap {
    /// element index -> 1-based page number the element starts on
    pub element_pages: Vec<usize>,
    pub page_count: usize,
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

fn build_blocks(script: &Script, opts: &LayoutOptions) -> Vec<Block> {
    let (num_left, num_right) = scene_number_columns(opts.scene_numbering);
    let mut blocks: Vec<Block> = Vec::new();
    let elements = &script.elements;
    let mut auto_scene_number = 0usize;
    let mut i = 0usize;
    let mut first_content = true;

    while i < elements.len() {
        let e = &elements[i];
        match e.kind {
            ElementKind::PageBreak => {
                blocks.push(Block {
                    lines: vec![],
                    keep_with_next: false,
                    speech: None,
                    splittable_action: false,
                    force_break_before: true,
                    space_before: 0,
                });
                i += 1;
            }
            ElementKind::SceneHeading => {
                auto_scene_number += 1;
                let number = e
                    .scene_number
                    .clone()
                    .unwrap_or_else(|| auto_scene_number.to_string());
                let mut lines = Vec::new();
                for (li, l) in wrap(&e.text, ACTION_WIDTH).into_iter().enumerate() {
                    let mut line = Line::text_line(LineKind::SceneHeading, ACTION_COL, l, Some(i));
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
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 2 },
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Action => {
                let lines: Vec<Line> = wrap(&e.text, ACTION_WIDTH)
                    .into_iter()
                    .map(|l| Line::text_line(LineKind::Action, ACTION_COL, l, Some(i)))
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: false,
                    speech: None,
                    splittable_action: true,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Shot => {
                let lines: Vec<Line> = wrap(&e.text, ACTION_WIDTH)
                    .into_iter()
                    .map(|l| Line::text_line(LineKind::Shot, ACTION_COL, l, Some(i)))
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: true,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Transition => {
                let text = e.text.clone();
                let col = TRANSITION_RIGHT_COL.saturating_sub(text.chars().count());
                blocks.push(Block {
                    lines: vec![Line::text_line(LineKind::Transition, col, text, Some(i))],
                    keep_with_next: false,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
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
                    let (block, next_i) = build_speech_block(elements, i, first_content);
                    blocks.push(block);
                    first_content = false;
                    i = next_i;
                }
            }
            // Orphan parenthetical/dialogue without a cue: render at their
            // columns as a non-splittable block.
            ElementKind::Parenthetical => {
                let lines: Vec<Line> = wrap(&e.text, PAREN_WIDTH)
                    .into_iter()
                    .map(|l| Line::text_line(LineKind::Parenthetical, PAREN_COL, l, Some(i)))
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: true,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
                });
                first_content = false;
                i += 1;
            }
            ElementKind::Dialogue => {
                let lines: Vec<Line> = wrap(&e.text, DIALOGUE_WIDTH)
                    .into_iter()
                    .map(|l| Line::text_line(LineKind::Dialogue, DIALOGUE_COL, l, Some(i)))
                    .collect();
                blocks.push(Block {
                    lines,
                    keep_with_next: false,
                    speech: None,
                    splittable_action: false,
                    force_break_before: false,
                    space_before: if first_content { 0 } else { 1 },
                });
                first_content = false;
                i += 1;
            }
        }
    }
    blocks
}

/// Build a normal (single-column) speech block: CHARACTER + (paren|dialogue)*.
fn build_speech_block(elements: &[Element], start: usize, first_content: bool) -> (Block, usize) {
    let cue = display_cue(elements, start);
    let mut lines = vec![Line::text_line(
        LineKind::Character,
        CHARACTER_COL,
        cue.clone(),
        Some(start),
    )];
    let mut i = start + 1;
    let mut dialogue_start_line = 1usize;
    let mut seen_dialogue = false;
    let mut speech_element = None;
    while i < elements.len() {
        match elements[i].kind {
            ElementKind::Parenthetical => {
                for l in wrap(&elements[i].text, PAREN_WIDTH) {
                    lines.push(Line::text_line(LineKind::Parenthetical, PAREN_COL, l, Some(i)));
                }
                if !seen_dialogue {
                    dialogue_start_line = lines.len();
                }
                i += 1;
            }
            ElementKind::Dialogue => {
                if speech_element.is_none() {
                    speech_element = Some(i);
                }
                seen_dialogue = true;
                for l in wrap(&elements[i].text, DIALOGUE_WIDTH) {
                    lines.push(Line::text_line(LineKind::Dialogue, DIALOGUE_COL, l, Some(i)));
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
                cue_col: CHARACTER_COL,
                dialogue_start: dialogue_start_line,
                element: speech_element,
            }),
            splittable_action: false,
            force_break_before: false,
            space_before: if first_content { 0 } else { 1 },
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
        },
        end,
    )
}

pub fn paginate(script: &Script, opts: &LayoutOptions) -> Layout {
    let blocks = build_blocks(script, opts);
    let mut pages: Vec<Page> = Vec::new();
    let mut cur: Vec<Line> = Vec::new();

    let new_page = |pages: &mut Vec<Page>, cur: &mut Vec<Line>| {
        let number = pages.len() + 1;
        pages.push(Page {
            number,
            lines: std::mem::take(cur),
        });
    };

    for b in blocks {
        if b.force_break_before {
            if !cur.is_empty() {
                new_page(&mut pages, &mut cur);
            }
            continue;
        }
        let space = if cur.is_empty() { 0 } else { b.space_before };
        let avail = BODY_LINES_PER_PAGE.saturating_sub(cur.len() + space);
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
                cur.push(Line::blank());
            }
            cur.extend(b.lines);
            continue;
        }

        if min_here > avail {
            // Doesn't fit at all: push to next page.
            new_page(&mut pages, &mut cur);
            cur.extend(b.lines);
            // Overflow safety: a single block taller than a page spills.
            while cur.len() > BODY_LINES_PER_PAGE {
                let rest = cur.split_off(BODY_LINES_PER_PAGE);
                new_page(&mut pages, &mut cur);
                cur = rest;
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
                    cur.push(Line::blank());
                }
                let rest = lines.split_off(take);
                cur.extend(lines);
                lines = rest;
            }
            new_page(&mut pages, &mut cur);
            // Keep filling full pages until the remainder fits.
            while lines.len() > BODY_LINES_PER_PAGE {
                let rest = lines.split_off(BODY_LINES_PER_PAGE);
                cur.extend(lines);
                new_page(&mut pages, &mut cur);
                lines = rest;
            }
            cur.extend(lines);
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
                    for _ in 0..space {
                        cur.push(Line::blank());
                    }
                    cur.extend(head);
                    for t in first {
                        cur.push(Line::text_line(LineKind::Dialogue, DIALOGUE_COL, t, sp.element));
                    }
                    cur.push(Line::text_line(LineKind::More, DIALOGUE_COL, "(MORE)".into(), None));
                    new_page(&mut pages, &mut cur);
                    // Re-cue with (CONT'D).
                    let mut cont_cue = sp.cue.clone();
                    if !cont_cue.to_uppercase().contains("(CONT'D)") {
                        cont_cue.push_str(" (CONT'D)");
                    }
                    cur.push(Line::text_line(LineKind::Character, sp.cue_col, cont_cue, None));
                    for t in rest {
                        cur.push(Line::text_line(LineKind::Dialogue, DIALOGUE_COL, t, sp.element));
                    }
                    // Remaining non-splittable tail (parentheticals etc.).
                    cur.extend(dlg[splittable_len..].iter().cloned());
                    continue;
                }
                _ => {
                    // No clean split: move the whole speech to the next page.
                    new_page(&mut pages, &mut cur);
                    cur.extend(b.lines);
                    while cur.len() > BODY_LINES_PER_PAGE {
                        let rest = cur.split_off(BODY_LINES_PER_PAGE);
                        new_page(&mut pages, &mut cur);
                        cur = rest;
                    }
                    continue;
                }
            }
        }

        // keep_with_next blocks that reach here start on the next page.
        new_page(&mut pages, &mut cur);
        cur.extend(b.lines);
        while cur.len() > BODY_LINES_PER_PAGE {
            let rest = cur.split_off(BODY_LINES_PER_PAGE);
            new_page(&mut pages, &mut cur);
            cur = rest;
        }
    }
    if !cur.is_empty() || pages.is_empty() {
        let number = pages.len() + 1;
        pages.push(Page {
            number,
            lines: cur,
        });
    }
    Layout { pages }
}

/// Editor-facing summary: page number per element.
pub fn page_map(script: &Script, opts: &LayoutOptions) -> PageMap {
    let layout = paginate(script, opts);
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
    fn wrap_respects_width_and_newlines() {
        let lines = wrap("alpha beta gamma delta", 11);
        assert_eq!(lines, vec!["alpha beta", "gamma delta"]);
        let lines = wrap("one\ntwo", 60);
        assert_eq!(lines, vec!["one", "two"]);
    }
}
