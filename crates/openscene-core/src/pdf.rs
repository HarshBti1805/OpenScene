//! Minimal, dependency-free PDF writer for screenplay output.
//!
//! Uses the PDF built-in Courier fonts (guaranteed available in every viewer,
//! zero embedding, zero network). Consumes the exact `Layout` produced by
//! `paginate`, so the PDF is line-for-line identical to the editor.
//!
//! Geometry: US Letter 612x792pt. Courier 12pt is exactly 7.2pt per char
//! (600/1000 * 12) and we use 12pt line leading (6 lines/inch).

use crate::model::{LayoutOptions, SceneNumbering, Script, TitlePage};
use crate::paginate::{paginate, Layout, LineKind, SCENE_NUM_LEFT_COL, SCENE_NUM_RIGHT_COL};

const PAGE_W: f64 = 612.0;
const PAGE_H: f64 = 792.0;
const CHAR_W: f64 = 7.2; // Courier 12pt advance width
const LINE_H: f64 = 12.0;
const TOP_MARGIN_LINES: f64 = 6.0; // 1 inch
const PAGE_NUM_LINE: f64 = 3.0; // page number rides in the top margin

fn col_x(col: usize) -> f64 {
    col as f64 * CHAR_W
}

/// Baseline Y for body line index (0-based from top of body area).
fn line_y(body_line: usize) -> f64 {
    PAGE_H - (TOP_MARGIN_LINES + body_line as f64) * LINE_H
}

/// Escape a string for a PDF literal string object.
fn pdf_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '(' => out.push_str("\\("),
            ')' => out.push_str("\\)"),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 128 => out.push(c),
            // Non-ASCII: map through WinAnsi where possible, else '?'.
            c => match winansi_byte(c) {
                Some(b) => out.push_str(&format!("\\{:03o}", b)),
                None => out.push('?'),
            },
        }
    }
    out
}

/// A pragmatic WinAnsiEncoding subset for common screenplay characters.
fn winansi_byte(c: char) -> Option<u8> {
    Some(match c {
        '\u{2019}' => 0x92, // ’
        '\u{2018}' => 0x91, // ‘
        '\u{201C}' => 0x93, // “
        '\u{201D}' => 0x94, // ”
        '\u{2013}' => 0x96, // –
        '\u{2014}' => 0x97, // —
        '\u{2026}' => 0x85, // …
        '\u{00E9}' => 0xE9, // é
        '\u{00E8}' => 0xE8, // è
        '\u{00E0}' => 0xE0, // à
        '\u{00FC}' => 0xFC, // ü
        '\u{00F6}' => 0xF6, // ö
        '\u{00E4}' => 0xE4, // ä
        '\u{00F1}' => 0xF1, // ñ
        '\u{00E7}' => 0xE7, // ç
        _ => return None,
    })
}

struct PdfBuilder {
    objects: Vec<Vec<u8>>, // object bodies, 1-indexed by position+1
}

impl PdfBuilder {
    fn new() -> Self {
        PdfBuilder {
            objects: Vec::new(),
        }
    }
    fn add(&mut self, body: Vec<u8>) -> usize {
        self.objects.push(body);
        self.objects.len() // object number
    }
    fn finish(self, root_obj: usize) -> Vec<u8> {
        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
        let mut offsets = Vec::with_capacity(self.objects.len());
        for (i, body) in self.objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n");
        }
        let xref_pos = out.len();
        out.extend_from_slice(format!("xref\n0 {}\n", self.objects.len() + 1).as_bytes());
        out.extend_from_slice(b"0000000000 65535 f \n");
        for off in offsets {
            out.extend_from_slice(format!("{:010} 00000 n \n", off).as_bytes());
        }
        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root {} 0 R >>\nstartxref\n{}\n%%EOF\n",
                self.objects.len() + 1,
                root_obj,
                xref_pos
            )
            .as_bytes(),
        );
        out
    }
}

fn text_op(out: &mut String, font: &str, x: f64, y: f64, s: &str) {
    if s.is_empty() {
        return;
    }
    out.push_str(&format!(
        "BT /{} 12 Tf {:.2} {:.2} Td ({}) Tj ET\n",
        font,
        x,
        y,
        pdf_escape(s)
    ));
}

/// Layout the title page content stream.
fn title_page_stream(tp: &TitlePage) -> String {
    let mut out = String::new();
    let get = |k: &str| -> Option<String> {
        tp.iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(k))
            .map(|(_, v)| v.clone())
    };
    let center = |out: &mut String, y: f64, s: &str, font: &str| {
        let w = s.chars().count() as f64 * CHAR_W;
        text_op(out, font, (PAGE_W - w) / 2.0, y, s);
    };
    let mut y = PAGE_H - 3.5 * 72.0; // title ~3.5" down
    if let Some(title) = get("Title") {
        for line in title.lines() {
            center(&mut out, y, &line.to_uppercase(), "F1");
            y -= LINE_H * 2.0;
        }
    }
    y -= LINE_H;
    if let Some(credit) = get("Credit") {
        center(&mut out, y, &credit, "F0");
        y -= LINE_H * 2.0;
    } else {
        center(&mut out, y, "written by", "F0");
        y -= LINE_H * 2.0;
    }
    if let Some(author) = get("Author").or_else(|| get("Authors")).or_else(|| get("Byline")) {
        for line in author.lines() {
            center(&mut out, y, line, "F0");
            y -= LINE_H * 2.0;
        }
    }
    // Bottom-left: contact; bottom-right: draft date.
    let mut by = 72.0 + 4.0 * LINE_H;
    if let Some(contact) = get("Contact") {
        for line in contact.lines() {
            text_op(&mut out, "F0", 72.0, by, line);
            by -= LINE_H;
        }
    }
    if let Some(date) = get("Draft date").or_else(|| get("Date")) {
        let w = date.chars().count() as f64 * CHAR_W;
        text_op(&mut out, "F0", PAGE_W - 72.0 - w, 72.0 + 4.0 * LINE_H, &date);
    }
    out
}

fn page_stream(page: &crate::paginate::Page, opts: &LayoutOptions, show_page_number: bool) -> String {
    let mut out = String::new();
    if show_page_number {
        let label = format!("{}.", page.number);
        let x = col_x(SCENE_NUM_RIGHT_COL) - label.chars().count() as f64 * CHAR_W + 2.0 * CHAR_W;
        text_op(&mut out, "F0", x, PAGE_H - PAGE_NUM_LINE * LINE_H, &label);
    }
    for (i, line) in page.lines.iter().enumerate() {
        let y = line_y(i);
        // Final Draft default: everything plain Courier, headings uppercase.
        let font = "F0";
        match line.kind {
            LineKind::Blank => {}
            LineKind::DualColumns => {
                text_op(&mut out, font, col_x(line.col), y, &line.text);
                if let (Some(rt), Some(rc)) = (&line.right_text, line.right_col) {
                    text_op(&mut out, font, col_x(rc), y, rt);
                }
            }
            _ => {
                text_op(&mut out, font, col_x(line.col), y, &line.text);
                if let Some(num) = &line.scene_number {
                    match opts.scene_numbering {
                        SceneNumbering::Left | SceneNumbering::Both => {
                            text_op(&mut out, "F0", col_x(SCENE_NUM_LEFT_COL), y, num);
                        }
                        _ => {}
                    }
                    match opts.scene_numbering {
                        SceneNumbering::Right | SceneNumbering::Both => {
                            text_op(&mut out, "F0", col_x(SCENE_NUM_RIGHT_COL), y, num);
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    out
}

/// Render a script to PDF bytes.
pub fn render(script: &Script, opts: &LayoutOptions) -> Vec<u8> {
    let layout: Layout = paginate(script, opts);
    let mut b = PdfBuilder::new();

    // Fonts (objects 1 and 2).
    let f0 = b.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>".to_vec());
    let f1 = b.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>".to_vec());

    let has_title = !script.title_page.is_empty();
    let mut content_ids: Vec<usize> = Vec::new();
    if has_title {
        let stream = title_page_stream(&script.title_page);
        content_ids.push(add_stream(&mut b, &stream));
    }
    for page in &layout.pages {
        // Page 1 traditionally hides its number.
        let stream = page_stream(page, opts, page.number > 1);
        content_ids.push(add_stream(&mut b, &stream));
    }

    // Reserve object ids: pages then the page tree then catalog.
    let n_pages = content_ids.len();
    let first_page_obj = b.objects.len() + 1;
    let pages_obj = first_page_obj + n_pages;
    let catalog_obj = pages_obj + 1;

    for content in &content_ids {
        b.add(
            format!(
                "<< /Type /Page /Parent {} 0 R /MediaBox [0 0 {} {}] /Contents {} 0 R /Resources << /Font << /F0 {} 0 R /F1 {} 0 R >> >> >>",
                pages_obj, PAGE_W, PAGE_H, content, f0, f1
            )
            .into_bytes(),
        );
    }
    let kids: Vec<String> = (0..n_pages).map(|i| format!("{} 0 R", first_page_obj + i)).collect();
    b.add(
        format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids.join(" "),
            n_pages
        )
        .into_bytes(),
    );
    b.add(format!("<< /Type /Catalog /Pages {} 0 R >>", pages_obj).into_bytes());

    b.finish(catalog_obj)
}

fn add_stream(b: &mut PdfBuilder, content: &str) -> usize {
    let bytes = content.as_bytes();
    let mut body = format!("<< /Length {} >>\nstream\n", bytes.len()).into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\nendstream");
    b.add(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Element, ElementKind};

    #[test]
    fn renders_valid_pdf_skeleton() {
        let mut s = Script::default();
        s.title_page.push(("Title".into(), "TEST".into()));
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. ROOM - DAY"));
        s.elements.push(Element::new(ElementKind::Action, "A table."));
        let bytes = render(&s, &LayoutOptions::default());
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/Type /Catalog"));
        assert!(text.contains("INT. ROOM - DAY"));
        assert!(text.ends_with("%%EOF\n"));
        // Two pages: title + one body page.
        assert!(text.contains("/Count 2"));
    }

    #[test]
    fn escapes_parentheses_in_text() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::Action, "He (almost) falls."));
        let bytes = render(&s, &LayoutOptions::default());
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("He \\(almost\\) falls."));
    }
}
