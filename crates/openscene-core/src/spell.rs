//! In-app spell checking on Hunspell dictionaries (pure Rust, offline).
//!
//! The bundled en_US dictionary (LibreOffice/SCOWL) is embedded in the
//! binary; additional Hunspell dictionaries can be dropped as
//! `<name>.aff` + `<name>.dic` pairs into a local dictionaries folder and
//! loaded by name (multi-language groundwork; en_US is the only shipped UI).
//!
//! Checking is designed for the editor's idle pass: the caller sends block
//! texts plus the project's custom words (user dictionary + auto-learned
//! character/location names); we return char ranges of misspellings.

use serde::{Deserialize, Serialize};
use spellbook::Dictionary;
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

const EN_US_AFF: &str = include_str!("../assets/dict/en_US.aff");
const EN_US_DIC: &str = include_str!("../assets/dict/en_US.dic");

pub const DEFAULT_LANG: &str = "en_US";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Misspelling {
    /// Char offset range [start, end) into the checked text.
    pub start: usize,
    pub end: usize,
    pub word: String,
}

struct Registry {
    dicts: HashMap<String, Dictionary>,
}

fn registry() -> &'static Mutex<Registry> {
    static REG: OnceLock<Mutex<Registry>> = OnceLock::new();
    REG.get_or_init(|| {
        let mut dicts = HashMap::new();
        if let Ok(d) = Dictionary::new(EN_US_AFF, EN_US_DIC) {
            dicts.insert(DEFAULT_LANG.to_string(), d);
        }
        Mutex::new(Registry { dicts })
    })
}

/// Load extra dictionaries (`*.aff` + `*.dic` pairs) from a folder.
/// Returns the language names now available.
pub fn load_extra_dictionaries(folder: &Path) -> Vec<String> {
    let mut reg = registry().lock().unwrap();
    if let Ok(rd) = std::fs::read_dir(folder) {
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("aff") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()).map(String::from) else {
                continue;
            };
            if reg.dicts.contains_key(&stem) {
                continue;
            }
            let dic_path = path.with_extension("dic");
            if let (Ok(aff), Ok(dic)) = (
                std::fs::read_to_string(&path),
                std::fs::read_to_string(&dic_path),
            ) {
                if let Ok(d) = Dictionary::new(&aff, &dic) {
                    reg.dicts.insert(stem, d);
                }
            }
        }
    }
    let mut names: Vec<String> = reg.dicts.keys().cloned().collect();
    names.sort();
    names
}

pub fn available_languages() -> Vec<String> {
    let reg = registry().lock().unwrap();
    let mut names: Vec<String> = reg.dicts.keys().cloned().collect();
    names.sort();
    names
}

fn is_word_char(c: char) -> bool {
    c.is_alphabetic() || c == '\'' || c == '\u{2019}'
}

/// Tokenize `text` into words with char offsets. Apostrophes are part of a
/// word only when internal (keeps "don't" whole but strips quotes).
fn words(text: &str) -> Vec<(usize, usize, String)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if is_word_char(chars[i]) {
            let start = i;
            while i < chars.len() && is_word_char(chars[i]) {
                i += 1;
            }
            let mut s = start;
            let mut e = i;
            while s < e && (chars[s] == '\'' || chars[s] == '\u{2019}') {
                s += 1;
            }
            while e > s && (chars[e - 1] == '\'' || chars[e - 1] == '\u{2019}') {
                e -= 1;
            }
            if e > s {
                out.push((s, e, chars[s..e].iter().collect::<String>()));
            }
        } else {
            i += 1;
        }
    }
    out
}

fn word_is_ok(dict: &Dictionary, custom: &HashSet<String>, word: &str) -> bool {
    if word.chars().any(|c| c.is_ascii_digit()) {
        return true; // "10th", "M16": never flag
    }
    let lower = word.to_lowercase();
    if custom.contains(&lower) {
        return true;
    }
    if dict.check(word) {
        return true;
    }
    // Screenplays shout: check ALL-CAPS words against their lowercase and
    // capitalized forms ("WAREHOUSE" -> "warehouse").
    if word.chars().all(|c| !c.is_lowercase()) {
        let mut cap = String::new();
        let mut chars = lower.chars();
        if let Some(f) = chars.next() {
            cap.extend(f.to_uppercase());
            cap.push_str(chars.as_str());
        }
        if dict.check(&lower) || dict.check(&cap) {
            return true;
        }
    }
    false
}

/// Check many texts at once. `custom` words are compared lowercased.
pub fn check_texts(lang: &str, texts: &[String], custom: &[String]) -> Vec<Vec<Misspelling>> {
    let reg = registry().lock().unwrap();
    let Some(dict) = reg.dicts.get(lang) else {
        return texts.iter().map(|_| Vec::new()).collect();
    };
    let custom_set: HashSet<String> = custom.iter().map(|w| w.to_lowercase()).collect();
    texts
        .iter()
        .map(|text| {
            words(text)
                .into_iter()
                .filter(|(_, _, w)| !word_is_ok(dict, &custom_set, w))
                .map(|(start, end, word)| Misspelling { start, end, word })
                .collect()
        })
        .collect()
}

pub fn suggest(lang: &str, word: &str, limit: usize) -> Vec<String> {
    let reg = registry().lock().unwrap();
    let Some(dict) = reg.dicts.get(lang) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    dict.suggest(word, &mut out);
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_misspellings_with_char_offsets() {
        let texts = vec!["Maya wlaks to the door.".to_string()];
        let misses = check_texts(DEFAULT_LANG, &texts, &[]);
        assert_eq!(misses[0].len(), 1);
        assert_eq!(misses[0][0].word, "wlaks");
        assert_eq!(misses[0][0].start, 5);
        assert_eq!(misses[0][0].end, 10);
    }

    #[test]
    fn custom_words_and_names_are_never_flagged() {
        let texts = vec!["MAYA enters Xylophoria.".to_string()];
        let misses = check_texts(DEFAULT_LANG, &texts, &["xylophoria".to_string()]);
        assert!(misses[0].is_empty(), "{:?}", misses[0]);
    }

    #[test]
    fn uppercase_words_check_against_lowercase_form() {
        let texts = vec!["INT. WAREHOUSE - NIGHT".to_string()];
        let misses = check_texts(DEFAULT_LANG, &texts, &[]);
        assert!(misses[0].is_empty(), "{:?}", misses[0]);
    }

    #[test]
    fn contractions_and_numbers_pass() {
        let texts = vec!["Don't worry, it's the 3rd take.".to_string()];
        let misses = check_texts(DEFAULT_LANG, &texts, &[]);
        assert!(misses[0].is_empty(), "{:?}", misses[0]);
    }

    #[test]
    fn suggestions_include_the_correction() {
        let s = suggest(DEFAULT_LANG, "wlaks", 8);
        assert!(s.iter().any(|w| w == "walks"), "{:?}", s);
    }
}
