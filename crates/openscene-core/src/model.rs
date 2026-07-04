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
            notes: Vec::new(),
        }
    }
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

/// Pagination / export options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutOptions {
    #[serde(default)]
    pub scene_numbering: SceneNumbering,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        LayoutOptions {
            scene_numbering: SceneNumbering::None,
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
