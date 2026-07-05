//! Fountain-superset parser and serializer.
//!
//! The native on-disk format. Guarantees:
//! - Any valid Fountain file parses into a `Script`.
//! - `parse(serialize(script)) == script` for every script the app can create
//!   (round-trip fidelity is enforced by tests).
//!
//! Superset conventions (all remain readable as plain Fountain):
//! - Scene color is stored as an inline note `[[color: blue]]` on the heading.
//! - Inline notes may carry a category: `[[category: text]]`.
//! - Revision marks are `[[rev: <set-id>]]` markers on the element.
//! - Shots are uppercase lines recognized by common shot keywords.

use crate::model::{is_uppercase_line, DualSide, Element, ElementKind, Note, Script, TitlePage};

const SHOT_KEYWORDS: &[&str] = &[
    "CLOSE ON", "CLOSE UP", "EXTREME CLOSE", "ANGLE ON", "ANGLE -", "NEW ANGLE", "POV",
    "INSERT", "BACK TO SCENE", "WIDE", "AERIAL", "TRACKING", "PAN ", "TILT", "MONTAGE",
    "SERIES OF SHOTS", "ON ", "REVERSE ANGLE", "TWO SHOT", "ESTABLISHING",
];

pub fn is_scene_heading_text(s: &str) -> bool {
    let u = s.to_uppercase();
    for p in ["INT.", "EXT.", "EST.", "INT./EXT.", "INT/EXT.", "I/E.", "INT ", "EXT ", "EST ", "INT/EXT ", "I/E "] {
        if u.starts_with(p) {
            return true;
        }
    }
    false
}

fn is_transition_text(s: &str) -> bool {
    is_uppercase_line(s) && (s.ends_with("TO:") || s == "FADE OUT." || s == "FADE TO BLACK.")
}

pub fn is_shot_text(s: &str) -> bool {
    if !is_uppercase_line(s) {
        return false;
    }
    let u = s.trim();
    SHOT_KEYWORDS.iter().any(|k| u.starts_with(k)) || u.ends_with(':') && !u.ends_with("TO:")
}

/// A line is a plausible character cue: uppercase (ignoring a parenthetical
/// extension and the dual-dialogue caret), contains a letter, not a heading.
fn is_character_line(s: &str) -> bool {
    let s = s.trim_end_matches('^').trim();
    let base = match s.find('(') {
        Some(i) => s[..i].trim(),
        None => s,
    };
    if base.is_empty() || is_scene_heading_text(base) || base.ends_with("TO:") {
        return false;
    }
    is_uppercase_line(base)
}

fn is_page_break(s: &str) -> bool {
    s.len() >= 3 && s.chars().all(|c| c == '=')
}

/// Remove `/* boneyard */` comments.
fn strip_boneyard(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    loop {
        match rest.find("/*") {
            None => {
                out.push_str(rest);
                return out;
            }
            Some(start) => {
                out.push_str(&rest[..start]);
                match rest[start..].find("*/") {
                    Some(end) => rest = &rest[start + end + 2..],
                    None => return out,
                }
            }
        }
    }
}

/// Extract `[[...]]` notes from `text`, returning cleaned text and notes with
/// char offsets into the cleaned text.
fn extract_notes(text: &str) -> (String, Vec<Note>) {
    let mut clean = String::with_capacity(text.len());
    let mut notes = Vec::new();
    let mut chars_out = 0usize;
    let mut rest = text;
    loop {
        match rest.find("[[") {
            None => {
                clean.push_str(rest);
                break;
            }
            Some(start) => {
                let head = &rest[..start];
                clean.push_str(head);
                chars_out += head.chars().count();
                match rest[start..].find("]]") {
                    Some(endrel) => {
                        let inner = &rest[start + 2..start + endrel];
                        let (category, body) = match inner.find(':') {
                            Some(c)
                                if c > 0
                                    && c <= 24
                                    && inner[..c]
                                        .chars()
                                        .all(|ch| ch.is_alphanumeric() || ch == ' ' || ch == '_') =>
                            {
                                (inner[..c].trim().to_string(), inner[c + 1..].trim().to_string())
                            }
                            _ => ("note".to_string(), inner.trim().to_string()),
                        };
                        notes.push(Note {
                            offset: chars_out,
                            category,
                            text: body,
                        });
                        rest = &rest[start + endrel + 2..];
                    }
                    None => {
                        clean.push_str(&rest[start..]);
                        break;
                    }
                }
            }
        }
    }
    // Trim trailing whitespace left behind by removed trailing notes.
    let trimmed_len = clean.trim_end().len();
    let removed_chars = clean[trimmed_len..].chars().count();
    if removed_chars > 0 {
        clean.truncate(trimmed_len);
        let max = clean.chars().count();
        for n in &mut notes {
            if n.offset > max {
                n.offset = max;
            }
        }
    }
    (clean, notes)
}

/// Re-insert notes into text at their char offsets.
fn inject_notes(text: &str, notes: &[Note]) -> String {
    if notes.is_empty() {
        return text.to_string();
    }
    let chars: Vec<char> = text.chars().collect();
    let mut sorted: Vec<&Note> = notes.iter().collect();
    sorted.sort_by_key(|n| n.offset);
    let mut out = String::new();
    let mut pos = 0usize;
    for n in sorted {
        let at = n.offset.min(chars.len());
        while pos < at {
            out.push(chars[pos]);
            pos += 1;
        }
        out.push_str("[[");
        if n.category != "note" {
            out.push_str(&n.category);
            out.push_str(": ");
        }
        out.push_str(&n.text);
        out.push_str("]]");
    }
    while pos < chars.len() {
        out.push(chars[pos]);
        pos += 1;
    }
    out
}

fn parse_title_page(lines: &[&str]) -> (TitlePage, usize) {
    let mut tp: TitlePage = Vec::new();
    let mut i = 0;
    // Title page exists only if the very first non-empty line is `Key: ...`
    if lines.is_empty() {
        return (tp, 0);
    }
    let first = lines[0];
    let looks_like_key = |l: &str| -> Option<(String, String)> {
        if l.starts_with(' ') || l.starts_with('\t') {
            return None;
        }
        let idx = l.find(':')?;
        let key = &l[..idx];
        if key.is_empty()
            || key.len() > 30
            || !key.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '_')
        {
            return None;
        }
        // A scene heading like "INT. X" has no colon before a period; keys
        // like "Title", "Draft date" are fine.
        Some((key.trim().to_string(), l[idx + 1..].trim().to_string()))
    };
    if looks_like_key(first).is_none() {
        return (tp, 0);
    }
    let mut current: Option<(String, String)> = None;
    while i < lines.len() {
        let line = lines[i];
        if line.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = looks_like_key(line) {
            if let Some(c) = current.take() {
                tp.push(c);
            }
            current = Some((k, v));
        } else if let Some(c) = &mut current {
            // Indented continuation line.
            if !c.1.is_empty() {
                c.1.push('\n');
            }
            c.1.push_str(line.trim());
        } else {
            break;
        }
        i += 1;
    }
    if let Some(c) = current.take() {
        tp.push(c);
    }
    (tp, i)
}

pub fn parse(input: &str) -> Script {
    let cleaned = strip_boneyard(&input.replace("\r\n", "\n").replace('\r', "\n"));
    let all_lines: Vec<&str> = cleaned.lines().collect();
    let (title_page, consumed) = parse_title_page(&all_lines);
    let lines = &all_lines[consumed..];

    let mut elements: Vec<Element> = Vec::new();
    let n = lines.len();
    let mut i = 0usize;

    let blank = |idx: usize| -> bool { idx >= n || lines[idx].trim().is_empty() };

    while i < n {
        let raw = lines[i];
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        let prev_blank = i == 0 || blank(i - 1);
        let next_blank = blank(i + 1);

        // Forced page break: ===
        if is_page_break(trimmed) {
            elements.push(Element::new(ElementKind::PageBreak, ""));
            i += 1;
            continue;
        }
        // Synopsis: `= text` (attach to most recent scene heading)
        if trimmed.starts_with('=') && !trimmed.starts_with("==") {
            let syn = trimmed[1..].trim().to_string();
            if let Some(h) = elements
                .iter_mut()
                .rev()
                .find(|e| e.kind == ElementKind::SceneHeading)
            {
                match &mut h.synopsis {
                    Some(existing) => {
                        existing.push('\n');
                        existing.push_str(&syn);
                    }
                    None => h.synopsis = Some(syn),
                }
            }
            i += 1;
            continue;
        }
        // Sections (`# Act One`) materialize as act headers.
        if trimmed.starts_with('#') {
            let text = trimmed.trim_start_matches('#').trim();
            let (clean, notes) = extract_notes(text);
            let mut e = Element::new(ElementKind::ActHeader, clean.to_uppercase());
            e.notes = notes;
            elements.push(e);
            i += 1;
            continue;
        }
        // Lyrics: `~sung line` (Fountain standard).
        if trimmed.starts_with('~') {
            let mut lines_acc: Vec<String> = Vec::new();
            while i < n {
                let l = lines[i].trim();
                if let Some(rest) = l.strip_prefix('~') {
                    lines_acc.push(rest.trim_start().to_string());
                    i += 1;
                } else {
                    break;
                }
            }
            let (clean, notes) = extract_notes(&lines_acc.join("\n"));
            let mut e = Element::new(ElementKind::Lyrics, clean);
            e.notes = notes;
            elements.push(e);
            continue;
        }
        // Forced scene heading: leading `.` (but not `...`).
        // `.OMITTED #12#` is the superset form of an omitted locked scene.
        if trimmed.starts_with('.') && !trimmed.starts_with("..") {
            push_scene_heading(&mut elements, trimmed[1..].trim());
            if let Some(last) = elements.last_mut() {
                if last.kind == ElementKind::SceneHeading && last.text == "OMITTED" {
                    last.kind = ElementKind::Omitted;
                    last.text = String::new();
                }
            }
            i += 1;
            continue;
        }
        // Natural scene heading
        if prev_blank && is_scene_heading_text(trimmed) {
            push_scene_heading(&mut elements, trimmed);
            i += 1;
            continue;
        }
        // Centered text `>text<` -> action (centering not modeled)
        if trimmed.starts_with('>') && trimmed.ends_with('<') && trimmed.len() >= 2 {
            let inner = trimmed[1..trimmed.len() - 1].trim();
            let (clean, notes) = extract_notes(inner);
            let mut e = Element::new(ElementKind::Action, clean);
            e.notes = notes;
            elements.push(e);
            i += 1;
            continue;
        }
        // Forced action: `!` wins over every other interpretation.
        if trimmed.starts_with('!') {
            let mut para: Vec<String> = Vec::new();
            while i < n && !lines[i].trim().is_empty() {
                let l = lines[i].trim();
                para.push(l.strip_prefix('!').unwrap_or(l).to_string());
                i += 1;
            }
            let joined = para.join("\n");
            let (clean, notes) = extract_notes(&joined);
            let mut e = Element::new(ElementKind::Action, clean);
            e.notes = notes;
            elements.push(e);
            continue;
        }
        // Forced transition: `> text`
        if let Some(rest) = trimmed.strip_prefix('>') {
            let (clean, notes) = extract_notes(rest.trim());
            let mut e = Element::new(ElementKind::Transition, clean);
            e.notes = notes;
            elements.push(e);
            i += 1;
            continue;
        }
        // Natural transition
        if prev_blank && next_blank && is_transition_text(trimmed) {
            elements.push(Element::new(ElementKind::Transition, trimmed));
            i += 1;
            continue;
        }
        // Character cue (forced with @, or uppercase followed by a non-blank line)
        let forced_char = trimmed.starts_with('@');
        if prev_blank && !next_blank && (forced_char || is_character_line(trimmed)) {
            let mut cue = if forced_char {
                trimmed[1..].trim().to_string()
            } else {
                trimmed.to_string()
            };
            let mut dual: Option<DualSide> = None;
            if cue.ends_with('^') {
                cue = cue.trim_end_matches('^').trim_end().to_string();
                dual = Some(DualSide::Right);
                // Mark the previous speech (character cue + its parentheticals
                // and dialogue) as the Left side of the pair.
                for prev in elements.iter_mut().rev() {
                    match prev.kind {
                        ElementKind::Dialogue | ElementKind::Parenthetical => {
                            if prev.dual.is_none() {
                                prev.dual = Some(DualSide::Left);
                            }
                        }
                        ElementKind::Character => {
                            if prev.dual.is_none() {
                                prev.dual = Some(DualSide::Left);
                            }
                            break;
                        }
                        _ => break,
                    }
                }
            }
            let (clean, notes) = extract_notes(&cue);
            let mut ch = Element::new(ElementKind::Character, clean);
            ch.dual = dual;
            ch.notes = notes;
            elements.push(ch);
            i += 1;
            // Consume the speech: parentheticals and dialogue until blank line.
            let mut dlg_lines: Vec<String> = Vec::new();
            let flush_dlg = |dlg_lines: &mut Vec<String>, elements: &mut Vec<Element>, dual: Option<DualSide>| {
                if !dlg_lines.is_empty() {
                    let joined = dlg_lines.join("\n");
                    let (clean, notes) = extract_notes(&joined);
                    let mut d = Element::new(ElementKind::Dialogue, clean);
                    d.notes = notes;
                    d.dual = dual;
                    elements.push(d);
                    dlg_lines.clear();
                }
            };
            while i < n && !lines[i].trim().is_empty() {
                let l = lines[i].trim();
                // Lyrics inside a speech: consecutive `~` lines.
                if l.starts_with('~') {
                    flush_dlg(&mut dlg_lines, &mut elements, dual);
                    let mut ly: Vec<String> = Vec::new();
                    while i < n {
                        let ll = lines[i].trim();
                        if let Some(rest) = ll.strip_prefix('~') {
                            ly.push(rest.trim_start().to_string());
                            i += 1;
                        } else {
                            break;
                        }
                    }
                    let (clean, notes) = extract_notes(&ly.join("\n"));
                    let mut e = Element::new(ElementKind::Lyrics, clean);
                    e.notes = notes;
                    e.dual = dual;
                    elements.push(e);
                    continue;
                }
                // Shape test ignores [[...]] markers so a trailing revision
                // marker doesn't stop a parenthetical from being recognized.
                let shape = extract_notes(l).0;
                if shape.starts_with('(') && shape.ends_with(')') {
                    flush_dlg(&mut dlg_lines, &mut elements, dual);
                    let (clean, notes) = extract_notes(l);
                    let mut p = Element::new(ElementKind::Parenthetical, clean);
                    p.notes = notes;
                    p.dual = dual;
                    elements.push(p);
                } else {
                    dlg_lines.push(l.to_string());
                }
                i += 1;
                // Two-space line keeps a blank line inside dialogue.
                if i < n && lines[i] == "  " {
                    dlg_lines.push(String::new());
                    i += 1;
                }
            }
            flush_dlg(&mut dlg_lines, &mut elements, dual);
            continue;
        }
        // Shot heuristic (shape test ignores [[...]] markers).
        if prev_blank && next_blank && is_shot_text(extract_notes(trimmed).0.trim()) {
            let (clean, notes) = extract_notes(trimmed);
            let mut e = Element::new(ElementKind::Shot, clean);
            e.notes = notes;
            elements.push(e);
            i += 1;
            continue;
        }
        // Action paragraph (default). `!` forces action.
        let mut para: Vec<String> = Vec::new();
        while i < n && !lines[i].trim().is_empty() {
            let l = lines[i].trim();
            para.push(l.strip_prefix('!').unwrap_or(l).to_string());
            i += 1;
        }
        let joined = para.join("\n");
        let (clean, notes) = extract_notes(&joined);
        let mut e = Element::new(ElementKind::Action, clean);
        e.notes = notes;
        elements.push(e);
    }

    // Post-pass: lift `[[rev: id]]` markers out of notes into `revision`.
    for e in &mut elements {
        let mut revision = None;
        e.notes.retain(|n| {
            if n.category.eq_ignore_ascii_case("rev") {
                revision = Some(n.text.clone());
                false
            } else {
                true
            }
        });
        if revision.is_some() {
            e.revision = revision;
        }
    }

    Script {
        title_page,
        elements,
    }
}

fn rev_marker(e: &Element) -> String {
    match &e.revision {
        Some(r) => format!(" [[rev: {}]]", r),
        None => String::new(),
    }
}

fn push_scene_heading(elements: &mut Vec<Element>, text: &str) {
    let mut t = text.to_string();
    let mut scene_number = None;
    // Trailing `#12#` scene number
    if t.ends_with('#') {
        if let Some(open) = t[..t.len() - 1].rfind('#') {
            let num = t[open + 1..t.len() - 1].trim().to_string();
            if !num.is_empty() && num.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.') {
                scene_number = Some(num);
                t.truncate(open);
                t = t.trim_end().to_string();
            }
        }
    }
    let (clean, mut notes) = extract_notes(&t);
    let mut color = None;
    notes.retain(|nt| {
        if nt.category.eq_ignore_ascii_case("color") {
            color = Some(nt.text.clone());
            false
        } else {
            true
        }
    });
    let mut e = Element::new(ElementKind::SceneHeading, clean.to_uppercase());
    e.scene_number = scene_number;
    e.color = color;
    e.notes = notes;
    elements.push(e);
}

pub fn serialize(script: &Script) -> String {
    let mut out = String::new();
    for (k, v) in &script.title_page {
        if v.contains('\n') {
            out.push_str(k);
            out.push_str(":\n");
            for l in v.lines() {
                out.push_str("    ");
                out.push_str(l);
                out.push('\n');
            }
        } else {
            out.push_str(&format!("{}: {}\n", k, v));
        }
    }
    if !script.title_page.is_empty() {
        out.push('\n');
    }

    let mut prev_kind: Option<ElementKind> = None;
    let mut prev_dual: Option<DualSide> = None;
    for e in &script.elements {
        let in_speech = matches!(
            (prev_kind, e.kind),
            (
                Some(ElementKind::Character)
                    | Some(ElementKind::Parenthetical)
                    | Some(ElementKind::Dialogue)
                    | Some(ElementKind::Lyrics),
                ElementKind::Parenthetical | ElementKind::Dialogue | ElementKind::Lyrics
            )
        ) && prev_dual == e.dual;
        if prev_kind.is_some() && !in_speech {
            out.push('\n');
        }
        match e.kind {
            ElementKind::SceneHeading => {
                let mut text = inject_notes(&e.text, &e.notes);
                if let Some(c) = &e.color {
                    text.push_str(&format!(" [[color: {}]]", c));
                }
                text.push_str(&rev_marker(e));
                if !is_scene_heading_text(&e.text) {
                    out.push('.');
                }
                out.push_str(&text);
                if let Some(num) = &e.scene_number {
                    out.push_str(&format!(" #{}#", num));
                }
                out.push('\n');
                if let Some(syn) = &e.synopsis {
                    for l in syn.lines() {
                        out.push_str("\n= ");
                        out.push_str(l);
                        out.push('\n');
                    }
                }
            }
            ElementKind::Action => {
                let mut text = inject_notes(&e.text, &e.notes);
                text.push_str(&rev_marker(e));
                for l in text.lines() {
                    // Escape lines that would misparse as another element.
                    let needs_bang = is_scene_heading_text(l)
                        || (is_uppercase_line(l) && l.trim().len() > 0)
                        || l.starts_with('.') && !l.starts_with("..")
                        || l.starts_with('>')
                        || l.starts_with('=')
                        || l.starts_with('#')
                        || l.starts_with('@')
                        || is_page_break(l.trim());
                    if needs_bang {
                        out.push('!');
                    }
                    out.push_str(l);
                    out.push('\n');
                }
                if e.text.is_empty() {
                    out.push('\n');
                }
            }
            ElementKind::Character => {
                let mut text = inject_notes(&e.text, &e.notes);
                text.push_str(&rev_marker(e));
                // Markers make the line non-uppercase: force with '@'.
                if !is_character_line(&text) {
                    out.push('@');
                }
                out.push_str(&text);
                if e.dual == Some(DualSide::Right) {
                    out.push_str(" ^");
                }
                out.push('\n');
            }
            ElementKind::Parenthetical => {
                let mut text = inject_notes(&e.text, &e.notes);
                if !text.starts_with('(') {
                    text = format!("({})", text);
                }
                text.push_str(&rev_marker(e));
                out.push_str(&text);
                out.push('\n');
            }
            ElementKind::Dialogue => {
                let mut text = inject_notes(&e.text, &e.notes);
                text.push_str(&rev_marker(e));
                for l in text.lines() {
                    if l.is_empty() {
                        out.push_str("  \n");
                    } else {
                        out.push_str(l);
                        out.push('\n');
                    }
                }
                if text.is_empty() {
                    out.push_str("  \n");
                }
            }
            ElementKind::Transition => {
                let has_markers = !e.notes.is_empty() || e.revision.is_some();
                if is_transition_text(&e.text) && !has_markers {
                    out.push_str(&e.text);
                } else {
                    // Markers force the explicit form so the shape survives.
                    out.push_str("> ");
                    out.push_str(&inject_notes(&e.text, &e.notes));
                    out.push_str(&rev_marker(e));
                }
                out.push('\n');
            }
            ElementKind::Shot => {
                let mut text = inject_notes(&e.text, &e.notes).to_uppercase();
                text.push_str(&rev_marker(e));
                out.push_str(&text);
                out.push('\n');
            }
            ElementKind::PageBreak => {
                out.push_str("===\n");
            }
            ElementKind::ActHeader => {
                out.push_str("# ");
                out.push_str(&inject_notes(&e.text, &e.notes).to_uppercase());
                out.push_str(&rev_marker(e));
                out.push('\n');
            }
            ElementKind::Lyrics => {
                let mut text = inject_notes(&e.text, &e.notes);
                text.push_str(&rev_marker(e));
                for l in text.lines() {
                    out.push('~');
                    out.push_str(l);
                    out.push('\n');
                }
                if text.is_empty() {
                    out.push_str("~\n");
                }
            }
            ElementKind::Omitted => {
                out.push_str(".OMITTED");
                out.push_str(&rev_marker(e));
                if let Some(num) = &e.scene_number {
                    out.push_str(&format!(" #{}#", num));
                }
                out.push('\n');
            }
        }
        prev_kind = Some(e.kind);
        prev_dual = e.dual;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(kind: ElementKind, text: &str) -> Element {
        Element::new(kind, text)
    }

    #[test]
    fn parses_scene_heading_action_dialogue() {
        let src = "INT. HOUSE - DAY\n\nMaya stares at the window.\n\nMAYA\nI can't do this anymore.\n";
        let s = parse(src);
        assert_eq!(s.elements.len(), 4);
        assert_eq!(s.elements[0].kind, ElementKind::SceneHeading);
        assert_eq!(s.elements[0].text, "INT. HOUSE - DAY");
        assert_eq!(s.elements[1].kind, ElementKind::Action);
        assert_eq!(s.elements[2].kind, ElementKind::Character);
        assert_eq!(s.elements[2].text, "MAYA");
        assert_eq!(s.elements[3].kind, ElementKind::Dialogue);
        assert_eq!(s.elements[3].text, "I can't do this anymore.");
    }

    #[test]
    fn parses_title_page() {
        let src = "Title: BIG FISH\nCredit: written by\nAuthor: John August\n\nINT. RIVER - DAY\n\nWater.\n";
        let s = parse(src);
        assert_eq!(s.title_page.len(), 3);
        assert_eq!(s.title(), Some("BIG FISH"));
        assert_eq!(s.elements[0].kind, ElementKind::SceneHeading);
    }

    #[test]
    fn parses_forced_elements() {
        let src = ".MOON SURFACE\n\n!INT. NOT A HEADING\n\n@McCLANE\nYippee ki-yay.\n\n> SMASH CUT TO:\n";
        let s = parse(src);
        assert_eq!(s.elements[0].kind, ElementKind::SceneHeading);
        assert_eq!(s.elements[0].text, "MOON SURFACE");
        assert_eq!(s.elements[1].kind, ElementKind::Action);
        assert_eq!(s.elements[1].text, "INT. NOT A HEADING");
        assert_eq!(s.elements[2].kind, ElementKind::Character);
        assert_eq!(s.elements[2].text, "McCLANE");
        assert_eq!(s.elements[3].kind, ElementKind::Dialogue);
        assert_eq!(s.elements[4].kind, ElementKind::Transition);
        assert_eq!(s.elements[4].text, "SMASH CUT TO:");
    }

    #[test]
    fn parses_parenthetical_and_extension() {
        let src = "MAYA (V.O.)\n(quietly)\nDon't.\n";
        let s = parse(src);
        assert_eq!(s.elements[0].kind, ElementKind::Character);
        assert_eq!(s.elements[0].text, "MAYA (V.O.)");
        assert_eq!(s.elements[1].kind, ElementKind::Parenthetical);
        assert_eq!(s.elements[1].text, "(quietly)");
        assert_eq!(s.elements[2].kind, ElementKind::Dialogue);
    }

    #[test]
    fn parses_dual_dialogue() {
        let src = "MAYA\nGo left!\n\nJONES ^\nGo right!\n";
        let s = parse(src);
        assert_eq!(s.elements[0].dual, Some(DualSide::Left));
        assert_eq!(s.elements[2].kind, ElementKind::Character);
        assert_eq!(s.elements[2].text, "JONES");
        assert_eq!(s.elements[2].dual, Some(DualSide::Right));
        assert_eq!(s.elements[3].dual, Some(DualSide::Right));
    }

    #[test]
    fn parses_transitions() {
        let src = "Some action.\n\nCUT TO:\n\nEXT. STREET - NIGHT\n\nRain.\n";
        let s = parse(src);
        assert_eq!(s.elements[1].kind, ElementKind::Transition);
        assert_eq!(s.elements[1].text, "CUT TO:");
    }

    #[test]
    fn parses_scene_number_synopsis_color() {
        let src = "INT. LAB - NIGHT [[color: blue]] #12A#\n\n= The experiment goes wrong.\n\nSparks.\n";
        let s = parse(src);
        let h = &s.elements[0];
        assert_eq!(h.kind, ElementKind::SceneHeading);
        assert_eq!(h.text, "INT. LAB - NIGHT");
        assert_eq!(h.scene_number.as_deref(), Some("12A"));
        assert_eq!(h.color.as_deref(), Some("blue"));
        assert_eq!(h.synopsis.as_deref(), Some("The experiment goes wrong."));
    }

    #[test]
    fn parses_notes_with_offsets() {
        let src = "Maya opens the [[check continuity]] door slowly.\n";
        let s = parse(src);
        let a = &s.elements[0];
        assert_eq!(a.text, "Maya opens the  door slowly.");
        assert_eq!(a.notes.len(), 1);
        assert_eq!(a.notes[0].text, "check continuity");
        assert_eq!(a.notes[0].offset, 15);
    }

    #[test]
    fn parses_page_break_and_boneyard() {
        let src = "Action one.\n\n===\n\n/* cut this */Action two.\n";
        let s = parse(src);
        assert_eq!(s.elements[1].kind, ElementKind::PageBreak);
        assert_eq!(s.elements[2].text, "Action two.");
    }

    #[test]
    fn parses_shot() {
        let src = "CLOSE ON MAYA'S HANDS\n\nThey tremble.\n";
        let s = parse(src);
        assert_eq!(s.elements[0].kind, ElementKind::Shot);
    }

    #[test]
    fn round_trip_full_script() {
        let mut script = Script::default();
        script.title_page = vec![
            ("Title".into(), "THE LONG NIGHT".into()),
            ("Author".into(), "Jane Writer".into()),
            ("Draft date".into(), "July 2026".into()),
        ];
        let mut heading = el(ElementKind::SceneHeading, "INT. LAB - NIGHT");
        heading.scene_number = Some("12".into());
        heading.synopsis = Some("Things go wrong.".into());
        heading.color = Some("blue".into());
        script.elements.push(heading);
        let mut action = el(ElementKind::Action, "Sparks fly.\nSmoke fills the room.");
        action.notes.push(Note {
            offset: 11,
            category: "note".into(),
            text: "more sparks?".into(),
        });
        script.elements.push(action);
        script.elements.push(el(ElementKind::Shot, "CLOSE ON MAYA"));
        script.elements.push(el(ElementKind::Character, "MAYA (V.O.)"));
        script.elements.push(el(ElementKind::Parenthetical, "(whispering)"));
        script.elements.push(el(ElementKind::Dialogue, "It's alive. It's really alive."));
        let mut l = el(ElementKind::Character, "MAYA");
        l.dual = Some(DualSide::Left);
        script.elements.push(l);
        let mut ld = el(ElementKind::Dialogue, "Run!");
        ld.dual = Some(DualSide::Left);
        script.elements.push(ld);
        let mut r = el(ElementKind::Character, "JONES");
        r.dual = Some(DualSide::Right);
        script.elements.push(r);
        let mut rd = el(ElementKind::Dialogue, "Stay!");
        rd.dual = Some(DualSide::Right);
        script.elements.push(rd);
        script.elements.push(el(ElementKind::Transition, "CUT TO:"));
        script.elements.push(el(ElementKind::PageBreak, ""));
        script.elements.push(el(ElementKind::SceneHeading, "EXT. STREET - DAY"));
        script.elements.push(el(ElementKind::Action, "Quiet."));

        let text = serialize(&script);
        let reparsed = parse(&text);
        assert_eq!(script, reparsed, "fountain round trip must be lossless:\n{}", text);
    }

    #[test]
    fn act_headers_and_lyrics_round_trip() {
        let mut script = Script::default();
        script.elements.push(el(ElementKind::ActHeader, "ACT ONE"));
        script.elements.push(el(ElementKind::SceneHeading, "INT. STAGE - NIGHT"));
        script.elements.push(el(ElementKind::Character, "MAYA"));
        script.elements.push(el(ElementKind::Lyrics, "The lights go down\nAnd we begin"));
        script.elements.push(el(ElementKind::ActHeader, "END OF ACT ONE"));
        let text = serialize(&script);
        assert!(text.contains("# ACT ONE"), "{}", text);
        assert!(text.contains("~The lights go down"), "{}", text);
        let back = parse(&text);
        assert_eq!(script, back, "{}", text);
    }

    #[test]
    fn legacy_sections_materialize_as_act_headers() {
        let s = parse("# Act One\n\nINT. A - DAY\n\nAction.\n");
        assert_eq!(s.elements[0].kind, ElementKind::ActHeader);
        assert_eq!(s.elements[0].text, "ACT ONE");
        assert_eq!(s.elements[1].kind, ElementKind::SceneHeading);
    }

    #[test]
    fn omitted_scene_round_trips() {
        let mut script = Script::default();
        script.elements.push(el(ElementKind::SceneHeading, "INT. A - DAY"));
        script.elements.push(el(ElementKind::Action, "One."));
        let mut om = el(ElementKind::Omitted, "");
        om.scene_number = Some("2".into());
        script.elements.push(om);
        script.elements.push(el(ElementKind::SceneHeading, "INT. C - DAY"));
        script.elements.push(el(ElementKind::Action, "Three."));
        let text = serialize(&script);
        assert!(text.contains(".OMITTED #2#"), "{}", text);
        let back = parse(&text);
        assert_eq!(script, back, "{}", text);
    }

    #[test]
    fn revision_marks_round_trip_on_every_kind() {
        let mut script = Script::default();
        let kinds = [
            (ElementKind::SceneHeading, "INT. LAB - NIGHT"),
            (ElementKind::Action, "Sparks fly."),
            (ElementKind::Shot, "CLOSE ON MAYA"),
            (ElementKind::Character, "MAYA"),
            (ElementKind::Parenthetical, "(quietly)"),
            (ElementKind::Dialogue, "It's alive."),
            (ElementKind::Transition, "CUT TO:"),
        ];
        for (kind, text) in kinds {
            let mut e = el(kind, text);
            e.revision = Some("blue-1".into());
            script.elements.push(e);
        }
        let text = serialize(&script);
        let back = parse(&text);
        assert_eq!(script, back, "revision marks must round-trip:\n{}", text);
    }

    #[test]
    fn revision_marker_survives_next_to_notes_and_color() {
        let mut script = Script::default();
        let mut h = el(ElementKind::SceneHeading, "INT. LAB - NIGHT");
        h.color = Some("blue".into());
        h.revision = Some("r2".into());
        h.scene_number = Some("12".into());
        script.elements.push(h);
        script.elements.push(el(ElementKind::Character, "MAYA"));
        let mut d = el(ElementKind::Dialogue, "Careful now.");
        d.revision = Some("r2".into());
        d.notes.push(Note {
            offset: 8,
            category: "note".into(),
            text: "too slow?".into(),
        });
        script.elements.push(d);
        let text = serialize(&script);
        let back = parse(&text);
        assert_eq!(script, back, "{}", text);
    }

    #[test]
    fn round_trip_preserves_action_that_looks_like_other_elements() {
        let mut script = Script::default();
        script.elements.push(el(ElementKind::Action, "INT. THIS IS ACTION"));
        script.elements.push(el(ElementKind::Action, "= not a synopsis"));
        let text = serialize(&script);
        let reparsed = parse(&text);
        assert_eq!(script, reparsed);
    }
}
