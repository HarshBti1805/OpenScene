//! Script statistics: pages, scenes, INT/EXT, DAY/NIGHT, character dialogue.

use crate::model::{ElementKind, LayoutOptions, Script};
use crate::paginate::{cue_base, page_map};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterStats {
    pub name: String,
    pub speeches: usize,
    pub words: usize,
    pub scenes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptStats {
    pub page_count: usize,
    pub scene_count: usize,
    pub int_count: usize,
    pub ext_count: usize,
    pub day_count: usize,
    pub night_count: usize,
    pub other_time_count: usize,
    pub dialogue_words: usize,
    pub action_words: usize,
    pub characters: Vec<CharacterStats>,
    pub locations: Vec<String>,
    /// Estimated runtime from the format's timing profile (min/page).
    #[serde(default)]
    pub estimated_minutes: f32,
}

fn word_count(s: &str) -> usize {
    s.split_whitespace().count()
}

/// Location = the slugline between INT./EXT. prefix and the time-of-day dash.
pub fn location_of(heading: &str) -> String {
    let u = heading.trim().to_uppercase();
    let mut rest = u.as_str();
    for p in ["INT./EXT.", "INT/EXT.", "I/E.", "INT.", "EXT.", "EST."] {
        if let Some(r) = rest.strip_prefix(p) {
            rest = r;
            break;
        }
    }
    let rest = rest.trim();
    match rest.rfind(" - ") {
        Some(i) => rest[..i].trim().to_string(),
        None => rest.to_string(),
    }
}

pub fn compute(script: &Script, opts: &LayoutOptions) -> ScriptStats {
    let pm = page_map(script, opts);
    let mut scene_count = 0usize;
    let mut int_count = 0;
    let mut ext_count = 0;
    let mut day_count = 0;
    let mut night_count = 0;
    let mut other_time = 0;
    let mut dialogue_words = 0;
    let mut action_words = 0;
    let mut chars: BTreeMap<String, CharacterStats> = BTreeMap::new();
    let mut char_scene: BTreeMap<String, usize> = BTreeMap::new(); // last scene counted per char
    let mut locations: Vec<String> = Vec::new();
    let mut current_speaker: Option<String> = None;

    for e in &script.elements {
        match e.kind {
            ElementKind::SceneHeading => {
                scene_count += 1;
                let u = e.text.to_uppercase();
                if u.starts_with("INT./EXT.") || u.starts_with("INT/EXT.") || u.starts_with("I/E.") {
                    int_count += 1;
                    ext_count += 1;
                } else if u.starts_with("INT") {
                    int_count += 1;
                } else if u.starts_with("EXT") {
                    ext_count += 1;
                }
                if u.contains("NIGHT") {
                    night_count += 1;
                } else if u.contains("DAY") {
                    day_count += 1;
                } else {
                    other_time += 1;
                }
                let loc = location_of(&e.text);
                if !loc.is_empty() && !locations.contains(&loc) {
                    locations.push(loc);
                }
                current_speaker = None;
            }
            ElementKind::Character => {
                let base = cue_base(&e.text);
                if base.is_empty() {
                    continue;
                }
                let entry = chars.entry(base.clone()).or_insert_with(|| CharacterStats {
                    name: base.clone(),
                    speeches: 0,
                    words: 0,
                    scenes: 0,
                });
                entry.speeches += 1;
                let last = char_scene.get(&base).copied().unwrap_or(usize::MAX);
                if last != scene_count {
                    entry.scenes += 1;
                    char_scene.insert(base.clone(), scene_count);
                }
                current_speaker = Some(base);
            }
            ElementKind::Dialogue => {
                let w = word_count(&e.text);
                dialogue_words += w;
                if let Some(sp) = &current_speaker {
                    if let Some(cs) = chars.get_mut(sp) {
                        cs.words += w;
                    }
                }
            }
            ElementKind::Action | ElementKind::Shot => {
                action_words += word_count(&e.text);
                current_speaker = None;
            }
            _ => {
                current_speaker = None;
            }
        }
    }

    let mut characters: Vec<CharacterStats> = chars.into_values().collect();
    characters.sort_by(|a, b| b.words.cmp(&a.words).then(a.name.cmp(&b.name)));

    let minutes_per_page = opts.format.as_ref().map(|f| f.minutes_per_page).unwrap_or(1.0);

    ScriptStats {
        page_count: pm.page_count,
        estimated_minutes: pm.page_count as f32 * minutes_per_page,
        scene_count,
        int_count,
        ext_count,
        day_count,
        night_count,
        other_time_count: other_time,
        dialogue_words,
        action_words,
        characters,
        locations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Element;

    #[test]
    fn counts_scenes_characters_and_ratios() {
        let mut s = Script::default();
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. LAB - NIGHT"));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Dialogue, "One two three."));
        s.elements.push(Element::new(ElementKind::SceneHeading, "EXT. STREET - DAY"));
        s.elements.push(Element::new(ElementKind::Character, "MAYA (V.O.)"));
        s.elements.push(Element::new(ElementKind::Dialogue, "Four five."));
        s.elements.push(Element::new(ElementKind::Character, "JONES"));
        s.elements.push(Element::new(ElementKind::Dialogue, "Six."));
        let st = compute(&s, &LayoutOptions::default());
        assert_eq!(st.scene_count, 2);
        assert_eq!(st.int_count, 1);
        assert_eq!(st.ext_count, 1);
        assert_eq!(st.day_count, 1);
        assert_eq!(st.night_count, 1);
        assert_eq!(st.characters[0].name, "MAYA");
        assert_eq!(st.characters[0].words, 5);
        assert_eq!(st.characters[0].scenes, 2);
        assert_eq!(st.locations, vec!["LAB".to_string(), "STREET".to_string()]);
    }
}
