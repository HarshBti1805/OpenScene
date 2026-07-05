//! Final Draft XML (FDX) import and export.
//!
//! Maps FDX `<Paragraph Type="...">` to our element kinds, including dual
//! dialogue (`<DualDialogue>` container) and script notes
//! (`<ScriptNote>`-style inline notes are exported as FDX ScriptNotes and
//! re-imported). Round-trip is enforced by tests.

use crate::model::{DualSide, Element, ElementKind, Note, Script};
use quick_xml::escape::{escape, unescape};

fn kind_to_fdx(kind: ElementKind) -> &'static str {
    match kind {
        ElementKind::SceneHeading => "Scene Heading",
        ElementKind::Action => "Action",
        ElementKind::Character => "Character",
        ElementKind::Parenthetical => "Parenthetical",
        ElementKind::Dialogue => "Dialogue",
        ElementKind::Transition => "Transition",
        ElementKind::Shot => "Shot",
        ElementKind::PageBreak => "Action", // represented via StartsNewPage attr
        ElementKind::Omitted => "Scene Heading", // + Omitted="Yes" attr
        ElementKind::ActHeader => "New Act",
        ElementKind::Lyrics => "Lyrics",
    }
}

fn fdx_to_kind(t: &str) -> ElementKind {
    match t {
        "Scene Heading" => ElementKind::SceneHeading,
        "Character" => ElementKind::Character,
        "Parenthetical" => ElementKind::Parenthetical,
        "Dialogue" => ElementKind::Dialogue,
        "Transition" => ElementKind::Transition,
        "Shot" => ElementKind::Shot,
        "New Act" | "Act Break" | "End of Act" => ElementKind::ActHeader,
        "Lyrics" => ElementKind::Lyrics,
        _ => ElementKind::Action,
    }
}

/// Serialize notes as FDX ScriptNote elements inline in the paragraph.
fn notes_xml(notes: &[Note]) -> String {
    let mut out = String::new();
    for n in notes {
        out.push_str(&format!(
            r#"<ScriptNote Offset="{}" Category="{}"><Paragraph><Text>{}</Text></Paragraph></ScriptNote>"#,
            n.offset,
            escape(n.category.as_str()),
            escape(n.text.as_str())
        ));
    }
    out
}

pub fn export(script: &Script) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\" ?>\n");
    out.push_str("<FinalDraft DocumentType=\"Script\" Template=\"No\" Version=\"5\">\n");
    out.push_str("<Content>\n");

    let mut i = 0usize;
    let els = &script.elements;
    while i < els.len() {
        let e = &els[i];
        if e.kind == ElementKind::PageBreak {
            out.push_str("<Paragraph Type=\"Action\" StartsNewPage=\"Yes\"><Text></Text></Paragraph>\n");
            i += 1;
            continue;
        }
        if e.kind == ElementKind::Character && e.dual == Some(DualSide::Left) {
            out.push_str("<Paragraph><DualDialogue>\n");
            while i < els.len() && els[i].dual.is_some() {
                write_paragraph(&mut out, &els[i]);
                i += 1;
            }
            out.push_str("</DualDialogue></Paragraph>\n");
            continue;
        }
        write_paragraph(&mut out, e);
        i += 1;
    }

    out.push_str("</Content>\n");
    // Title page.
    if !script.title_page.is_empty() {
        out.push_str("<TitlePage><Content>\n");
        for (k, v) in &script.title_page {
            // Store key: value so import can reconstruct fields.
            out.push_str(&format!(
                "<Paragraph Type=\"General\"><Text>{}: {}</Text></Paragraph>\n",
                escape(k.as_str()),
                escape(v.replace('\n', " ").as_str())
            ));
        }
        out.push_str("</Content></TitlePage>\n");
    }
    out.push_str("</FinalDraft>\n");
    out
}

fn write_paragraph(out: &mut String, e: &Element) {
    let mut attrs = format!(" Type=\"{}\"", kind_to_fdx(e.kind));
    if e.kind == ElementKind::SceneHeading || e.kind == ElementKind::Omitted {
        if let Some(n) = &e.scene_number {
            attrs.push_str(&format!(" Number=\"{}\"", escape(n.as_str())));
        }
    }
    if e.kind == ElementKind::Omitted {
        attrs.push_str(" Omitted=\"Yes\"");
    }
    if let Some(rev) = &e.revision {
        attrs.push_str(&format!(" RevisionID=\"{}\"", escape(rev.as_str())));
    }
    out.push_str(&format!("<Paragraph{}>", attrs));
    out.push_str(&notes_xml(&e.notes));
    if e.kind == ElementKind::SceneHeading {
        if let Some(syn) = &e.synopsis {
            out.push_str(&format!(
                "<SceneProperties Synopsis=\"{}\"{}/>",
                escape(syn.as_str()),
                e.color
                    .as_ref()
                    .map(|c| format!(" Color=\"{}\"", escape(c.as_str())))
                    .unwrap_or_default()
            ));
        } else if let Some(c) = &e.color {
            out.push_str(&format!("<SceneProperties Color=\"{}\"/>", escape(c.as_str())));
        }
    }
    // FDX represents hard line breaks as separate <Text> runs split by <br/>;
    // we encode newlines as literal &#10; inside one Text run for fidelity.
    out.push_str(&format!("<Text>{}</Text>", escape(e.text.as_str()).replace('\n', "&#10;")));
    out.push_str("</Paragraph>\n");
}

/// Minimal, forgiving XML scanner sufficient for FDX (no namespaces).
struct Scanner<'a> {
    src: &'a str,
    pos: usize,
}

#[derive(Debug, Clone)]
enum Tok {
    Open(String, Vec<(String, String)>, bool), // name, attrs, self_closing
    Close(String),
    Text(String),
}

impl<'a> Scanner<'a> {
    fn new(src: &'a str) -> Self {
        Scanner { src, pos: 0 }
    }
    fn next_tok(&mut self) -> Option<Tok> {
        let bytes = self.src.as_bytes();
        if self.pos >= bytes.len() {
            return None;
        }
        if bytes[self.pos] == b'<' {
            let end = self.src[self.pos..].find('>')? + self.pos;
            let inner = &self.src[self.pos + 1..end];
            self.pos = end + 1;
            if inner.starts_with('?') || inner.starts_with('!') {
                return self.next_tok();
            }
            if let Some(name) = inner.strip_prefix('/') {
                return Some(Tok::Close(name.trim().to_string()));
            }
            let self_closing = inner.ends_with('/');
            let inner = inner.trim_end_matches('/');
            let mut parts = inner.splitn(2, char::is_whitespace);
            let name = parts.next().unwrap_or("").to_string();
            let mut attrs = Vec::new();
            if let Some(rest) = parts.next() {
                let mut rest = rest.trim();
                while let Some(eq) = rest.find('=') {
                    let key = rest[..eq].trim().to_string();
                    let after = rest[eq + 1..].trim_start();
                    if let Some(q) = after.chars().next() {
                        if q == '"' || q == '\'' {
                            if let Some(close) = after[1..].find(q) {
                                let val = &after[1..1 + close];
                                attrs.push((
                                    key,
                                    unescape(val).map(|c| c.into_owned()).unwrap_or_else(|_| val.to_string()),
                                ));
                                rest = after[close + 2..].trim_start();
                                continue;
                            }
                        }
                    }
                    break;
                }
            }
            Some(Tok::Open(name, attrs, self_closing))
        } else {
            let end = self.src[self.pos..]
                .find('<')
                .map(|i| i + self.pos)
                .unwrap_or(bytes.len());
            let raw = &self.src[self.pos..end];
            self.pos = end;
            let text = unescape(raw).map(|c| c.into_owned()).unwrap_or_else(|_| raw.to_string());
            Some(Tok::Text(text))
        }
    }
}

fn attr<'v>(attrs: &'v [(String, String)], name: &str) -> Option<&'v str> {
    attrs
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

pub fn import(xml: &str) -> Script {
    let mut sc = Scanner::new(xml);
    let mut script = Script::default();

    // Paragraph state
    let mut in_content = false;
    let mut in_title = false;
    let mut dual_depth: Option<Vec<usize>> = None; // indices of paragraphs in current dual group
    let mut cur: Option<Element> = None;
    let mut cur_text = String::new();
    let mut in_text = false;
    // ScriptNote state
    let mut in_note = false;
    let mut note_offset = 0usize;
    let mut note_cat = String::new();
    let mut note_text = String::new();
    let mut starts_new_page = false;

    while let Some(tok) = sc.next_tok() {
        match tok {
            Tok::Open(name, attrs, self_closing) => match name.as_str() {
                "Content" => in_content = true,
                "TitlePage" => in_title = true,
                "DualDialogue" => {
                    dual_depth = Some(Vec::new());
                }
                "Paragraph" => {
                    if in_note {
                        continue;
                    }
                    let ptype = attr(&attrs, "Type").unwrap_or("");
                    if ptype.is_empty() && !self_closing {
                        // Wrapper paragraph (dual dialogue container): skip.
                        continue;
                    }
                    if attr(&attrs, "StartsNewPage").map(|v| v.eq_ignore_ascii_case("yes")) == Some(true) {
                        starts_new_page = true;
                    }
                    let mut e = Element::new(fdx_to_kind(ptype), "");
                    if attr(&attrs, "Omitted").map(|v| v.eq_ignore_ascii_case("yes")) == Some(true) {
                        e.kind = ElementKind::Omitted;
                    }
                    if e.kind == ElementKind::SceneHeading || e.kind == ElementKind::Omitted {
                        e.scene_number = attr(&attrs, "Number").map(|s| s.to_string());
                    }
                    e.revision = attr(&attrs, "RevisionID")
                        .filter(|v| !v.is_empty())
                        .map(|s| s.to_string());
                    cur = Some(e);
                    cur_text.clear();
                }
                "SceneProperties" => {
                    if let Some(e) = &mut cur {
                        if let Some(syn) = attr(&attrs, "Synopsis") {
                            if !syn.is_empty() {
                                e.synopsis = Some(syn.to_string());
                            }
                        }
                        if let Some(c) = attr(&attrs, "Color") {
                            if !c.is_empty() {
                                e.color = Some(c.to_string());
                            }
                        }
                    }
                }
                "ScriptNote" => {
                    in_note = true;
                    note_offset = attr(&attrs, "Offset").and_then(|v| v.parse().ok()).unwrap_or(0);
                    note_cat = attr(&attrs, "Category").unwrap_or("note").to_string();
                    note_text.clear();
                }
                "Text" => {
                    if !self_closing {
                        in_text = true;
                    }
                }
                _ => {}
            },
            Tok::Close(name) => match name.as_str() {
                "Content" => in_content = false,
                "TitlePage" => in_title = false,
                "DualDialogue" => {
                    if let Some(indices) = dual_depth.take() {
                        assign_dual_sides(&mut script.elements, &indices);
                    }
                }
                "Text" => in_text = false,
                "ScriptNote" => {
                    in_note = false;
                    if let Some(e) = &mut cur {
                        e.notes.push(Note {
                            offset: note_offset,
                            category: std::mem::take(&mut note_cat),
                            text: note_text.trim().to_string(),
                        });
                    }
                }
                "Paragraph" => {
                    // ScriptNotes nest their own <Paragraph>; don't let it
                    // close the paragraph that owns the note.
                    if in_note {
                        continue;
                    }
                    if let Some(mut e) = cur.take() {
                        e.text = cur_text.replace('\u{a0}', " ").trim_end().to_string();
                        if in_title {
                            if let Some(idx) = e.text.find(':') {
                                let key = e.text[..idx].trim().to_string();
                                let val = e.text[idx + 1..].trim().to_string();
                                if !key.is_empty() {
                                    script.title_page.push((key, val));
                                }
                            }
                        } else if in_content {
                            if starts_new_page {
                                script.elements.push(Element::new(ElementKind::PageBreak, ""));
                                starts_new_page = false;
                                if e.text.is_empty() && e.notes.is_empty() {
                                    continue;
                                }
                            }
                            if let Some(indices) = &mut dual_depth {
                                indices.push(script.elements.len());
                            }
                            script.elements.push(e);
                        }
                    }
                }
                _ => {}
            },
            Tok::Text(t) => {
                if in_note {
                    note_text.push_str(&t);
                } else if in_text && cur.is_some() {
                    cur_text.push_str(&t);
                }
            }
        }
    }
    script
}

/// Mark the first speech in a dual group Left and the second Right.
fn assign_dual_sides(elements: &mut [Element], indices: &[usize]) {
    let mut side = DualSide::Left;
    let mut seen_char = false;
    for &i in indices {
        if elements[i].kind == ElementKind::Character {
            if seen_char {
                side = DualSide::Right;
            }
            seen_char = true;
        }
        elements[i].dual = Some(side);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Element, ElementKind, Note, Script};

    fn sample_script() -> Script {
        let mut s = Script::default();
        s.title_page = vec![
            ("Title".into(), "THE LONG NIGHT".into()),
            ("Author".into(), "Jane Writer".into()),
        ];
        let mut h = Element::new(ElementKind::SceneHeading, "INT. LAB - NIGHT");
        h.scene_number = Some("12".into());
        h.synopsis = Some("Things go wrong.".into());
        h.color = Some("#0000FF".into());
        s.elements.push(h);
        let mut a = Element::new(ElementKind::Action, "Sparks fly.\nSmoke everywhere.");
        a.notes.push(Note {
            offset: 6,
            category: "continuity".into(),
            text: "check the sparks".into(),
        });
        s.elements.push(a);
        s.elements.push(Element::new(ElementKind::Shot, "CLOSE ON MAYA"));
        s.elements.push(Element::new(ElementKind::Character, "MAYA (V.O.)"));
        s.elements.push(Element::new(ElementKind::Parenthetical, "(whispering)"));
        s.elements.push(Element::new(ElementKind::Dialogue, "It's alive. <Really> \"alive\" & well."));
        s.elements.push(Element::new(ElementKind::Transition, "CUT TO:"));
        s.elements.push(Element::new(ElementKind::PageBreak, ""));
        s.elements.push(Element::new(ElementKind::SceneHeading, "EXT. STREET - DAY"));
        s.elements.push(Element::new(ElementKind::Action, "Quiet."));
        s
    }

    #[test]
    fn fdx_round_trip_is_lossless() {
        let s = sample_script();
        let xml = export(&s);
        let back = import(&xml);
        assert_eq!(s, back, "FDX round trip must preserve the script\n{}", xml);
    }

    #[test]
    fn fdx_round_trip_dual_dialogue() {
        let mut s = Script::default();
        let mut l = Element::new(ElementKind::Character, "MAYA");
        l.dual = Some(DualSide::Left);
        let mut ld = Element::new(ElementKind::Dialogue, "Left!");
        ld.dual = Some(DualSide::Left);
        let mut r = Element::new(ElementKind::Character, "JONES");
        r.dual = Some(DualSide::Right);
        let mut rd = Element::new(ElementKind::Dialogue, "Right!");
        rd.dual = Some(DualSide::Right);
        s.elements.extend([l, ld, r, rd]);
        let xml = export(&s);
        let back = import(&xml);
        assert_eq!(s, back);
    }

    #[test]
    fn fdx_round_trips_act_headers_and_lyrics() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::ActHeader, "ACT TWO"));
        s.elements.push(Element::new(ElementKind::Lyrics, "Sing it now"));
        let xml = export(&s);
        let back = import(&xml);
        assert_eq!(s, back);
    }

    #[test]
    fn fdx_round_trips_omitted_scenes() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. A - DAY"));
        s.elements.push(Element::new(ElementKind::Action, "One."));
        let mut om = Element::new(ElementKind::Omitted, "");
        om.scene_number = Some("2".into());
        s.elements.push(om);
        let xml = export(&s);
        assert!(xml.contains("Omitted=\"Yes\""));
        let back = import(&xml);
        assert_eq!(s, back);
    }

    #[test]
    fn fdx_round_trips_revision_ids() {
        let mut s = Script::default();
        let mut a = Element::new(ElementKind::Action, "Revised action.");
        a.revision = Some("blue-1".into());
        s.elements.push(a);
        s.elements.push(Element::new(ElementKind::Action, "Untouched."));
        let xml = export(&s);
        assert!(xml.contains("RevisionID=\"blue-1\""));
        let back = import(&xml);
        assert_eq!(s, back);
    }

    #[test]
    fn imports_plain_final_draft_document() {
        let xml = r#"<?xml version="1.0"?>
<FinalDraft DocumentType="Script" Version="3">
<Content>
<Paragraph Type="Scene Heading" Number="1"><Text>INT. HOUSE - DAY</Text></Paragraph>
<Paragraph Type="Action"><Text>A quiet room.</Text></Paragraph>
<Paragraph Type="Character"><Text>BOB</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Hello.</Text></Paragraph>
</Content>
</FinalDraft>"#;
        let s = import(xml);
        assert_eq!(s.elements.len(), 4);
        assert_eq!(s.elements[0].kind, ElementKind::SceneHeading);
        assert_eq!(s.elements[0].scene_number.as_deref(), Some("1"));
        assert_eq!(s.elements[3].text, "Hello.");
    }

    #[test]
    fn exported_xml_escapes_special_characters() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::Action, "A < B & \"C\""));
        let xml = export(&s);
        assert!(xml.contains("&lt;"));
        assert!(xml.contains("&amp;"));
        let back = import(&xml);
        assert_eq!(back.elements[0].text, "A < B & \"C\"");
    }
}
