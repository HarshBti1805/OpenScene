use serde::{Deserialize, Serialize};

/// A screenplay element type. These are the typed blocks of the document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElementKind {
    SceneHeading,
    Action,
    Character,
    Parenthetical,
    Dialogue,
    Transition,
    Shot,
    /// Forced page break (Fountain `===`).
    PageBreak,
    /// A locked scene that was removed: renders as "12  OMITTED" and keeps
    /// its locked scene number. Fountain superset: `.OMITTED #12#`.
    Omitted,
    /// Act/section header (Fountain `# Act One`); centered in TV formats.
    ActHeader,
    /// Sung text (Fountain `~lyric line`); distinct margins, oblique face.
    Lyrics,
}

/// Which side of a dual-dialogue pair a character block belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DualSide {
    Left,
    Right,
}

/// An inline note anchored at a character offset inside an element's text.
/// Serialized in Fountain as `[[category: text]]` at that offset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    /// Character offset into `Element::text` (chars, not bytes).
    pub offset: usize,
    /// Free-form category used for coloring ("note", "red", "idea", ...).
    pub category: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Element {
    pub kind: ElementKind,
    /// Raw text. May contain `\n` for hard line breaks (action, dialogue).
    pub text: String,
    /// Set on Character elements that are part of a dual-dialogue pair.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dual: Option<DualSide>,
    /// Locked/explicit scene number (scene headings only), e.g. "12" or "A12".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_number: Option<String>,
    /// Scene synopsis (scene headings only), from Fountain `= synopsis` lines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synopsis: Option<String>,
    /// Scene color label (scene headings only), stored as a `[[color: x]]` note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Revision-set id this element was last edited under (revision mode).
    /// Serialized in Fountain as a `[[rev: id]]` marker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<Note>,
}

impl Element {
    pub fn new(kind: ElementKind, text: impl Into<String>) -> Self {
        Element {
            kind,
            text: text.into(),
            dual: None,
            scene_number: None,
            synopsis: None,
            color: None,
            revision: None,
            notes: Vec::new(),
        }
    }
}

/// The industry-standard revision color ladder.
pub const REVISION_COLORS: &[&str] = &[
    "White", "Blue", "Pink", "Yellow", "Green", "Goldenrod", "Buff", "Salmon", "Cherry",
    "Double Blue", "Double Pink", "Double Yellow", "Double Green",
];

/// A named revision set (stored in project.json).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevisionSet {
    pub id: String,
    /// Color name from `REVISION_COLORS`.
    pub color: String,
    pub label: String,
    pub date: String,
}

/// Anchor for a locked page: the element the page started on at lock time,
/// identified by its containing scene's locked number plus an element offset
/// from that scene's heading (0 = the heading itself). Scene numbers are
/// materialized into the document at lock time, so anchors survive edits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockedPageAnchor {
    /// The locked page number label ("12"). A/B overflow pages derive from it.
    pub label: String,
    /// Locked scene number of the containing scene ("" = before scene one).
    pub scene: String,
    /// Element offset from the scene heading (0 = heading; for "" scenes,
    /// offset from the start of the document).
    pub el_offset: usize,
    /// When the lock boundary fell mid-element (split action or dialogue):
    /// non-whitespace characters of that element consumed on earlier pages.
    /// Whitespace-insensitive so re-wrapping can't drift the boundary.
    #[serde(default)]
    pub nonws_offset: usize,
}

/// The frozen pagination captured when a script is locked (production draft).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct LockedState {
    pub pages: Vec<LockedPageAnchor>,
    /// Scene numbers in order at lock time (for A-numbering and OMITTED).
    pub scenes: Vec<String>,
    /// Date of the lock, for the UI.
    #[serde(default)]
    pub date: String,
}

/// Ordered title-page fields (Title, Credit, Author, Contact, Draft date, ...).
pub type TitlePage = Vec<(String, String)>;

/// The whole script document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Script {
    #[serde(default)]
    pub title_page: TitlePage,
    #[serde(default)]
    pub elements: Vec<Element>,
}

impl Script {
    pub fn title(&self) -> Option<&str> {
        self.title_page
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("title"))
            .map(|(_, v)| v.as_str())
    }
}

/// Where scene numbers are printed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SceneNumbering {
    #[default]
    None,
    Left,
    Right,
    Both,
}

/// Horizontal alignment of an element's text within the page columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Align {
    #[default]
    Left,
    Center,
    Right,
}

/// Per-element format parameters (columns are character cells at 10 cpi).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElementFormat {
    pub indent_cols: usize,
    pub width_cols: usize,
    #[serde(default)]
    pub uppercase: bool,
    /// Blank lines before the element.
    #[serde(default)]
    pub space_before: usize,
    #[serde(default)]
    pub align: Align,
    /// 1 = single, 2 = double (multicam dialogue).
    #[serde(default = "one")]
    pub line_spacing: u8,
    #[serde(default)]
    pub underline: bool,
}

fn one() -> u8 {
    1
}

impl ElementFormat {
    const fn new(indent: usize, width: usize, upper: bool, space: usize) -> Self {
        ElementFormat {
            indent_cols: indent,
            width_cols: width,
            uppercase: upper,
            space_before: space,
            align: Align::Left,
            line_spacing: 1,
            underline: false,
        }
    }
}

/// A complete script format. `FormatSpec::default()` is the US feature-film
/// standard and MUST paginate byte-identically to the historical constants
/// (regression-tested).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FormatSpec {
    pub scene_heading: ElementFormat,
    pub action: ElementFormat,
    pub character: ElementFormat,
    pub parenthetical: ElementFormat,
    pub dialogue: ElementFormat,
    pub transition: ElementFormat,
    pub shot: ElementFormat,
    #[serde(default = "default_act_header")]
    pub act_header: ElementFormat,
    #[serde(default = "default_lyrics")]
    pub lyrics: ElementFormat,
    /// Every scene starts a new page (multicam).
    #[serde(default)]
    pub scene_per_page: bool,
    /// Scenes letter A, B, C… instead of 1, 2, 3 (multicam).
    #[serde(default)]
    pub lettered_scenes: bool,
    /// Timing profile for runtime estimates (1.0 = a minute per page).
    #[serde(default = "default_mpp")]
    pub minutes_per_page: f32,
}

fn default_mpp() -> f32 {
    1.0
}

fn default_act_header() -> ElementFormat {
    ElementFormat {
        align: Align::Center,
        uppercase: true,
        underline: true,
        ..ElementFormat::new(15, 60, true, 2)
    }
}

fn default_lyrics() -> ElementFormat {
    ElementFormat::new(25, 35, false, 0)
}

impl Default for FormatSpec {
    fn default() -> Self {
        FormatSpec {
            scene_heading: ElementFormat::new(15, 60, true, 2),
            action: ElementFormat::new(15, 60, false, 1),
            character: ElementFormat::new(37, 33, true, 1),
            parenthetical: ElementFormat::new(30, 25, false, 0),
            dialogue: ElementFormat::new(25, 35, false, 0),
            // Right-aligned so text ends at column 75 (indent + width).
            transition: ElementFormat {
                align: Align::Right,
                ..ElementFormat::new(45, 30, true, 1)
            },
            shot: ElementFormat::new(15, 60, true, 1),
            act_header: default_act_header(),
            lyrics: default_lyrics(),
            scene_per_page: false,
            lettered_scenes: false,
            minutes_per_page: 1.0,
        }
    }
}

/// Pagination / export options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutOptions {
    #[serde(default)]
    pub scene_numbering: SceneNumbering,
    /// Header text for revised pages, e.g. "Blue Draft — 2026-07-05".
    /// Set when a revision set is active; None hides revision headers.
    #[serde(default)]
    pub revision_label: Option<String>,
    /// Draw revision asterisks in the right margin (default true).
    #[serde(default = "default_true")]
    pub show_revision_marks: bool,
    /// Locked pagination (production drafts). None = free reflow.
    #[serde(default)]
    pub locked: Option<LockedState>,
    /// Script format. None = US Feature standard (identical to
    /// `FormatSpec::default()`; regression-tested byte-identical).
    #[serde(default)]
    pub format: Option<FormatSpec>,
}

fn default_true() -> bool {
    true
}

impl Default for LayoutOptions {
    fn default() -> Self {
        LayoutOptions {
            scene_numbering: SceneNumbering::None,
            revision_label: None,
            show_revision_marks: true,
            locked: None,
            format: None,
        }
    }
}

pub fn is_uppercase_line(s: &str) -> bool {
    let mut has_letter = false;
    for c in s.chars() {
        if c.is_alphabetic() {
            has_letter = true;
            if c.is_lowercase() {
                return false;
            }
        }
    }
    has_letter
}
