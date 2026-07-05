//! CRDT groundwork (Loro).
//!
//! Scope (deliberate, see PROGRESS.md): Loro is wired into the *save path*,
//! not the keystroke path. Every save diffs the new Fountain serialization
//! into a persistent LoroDoc (edits become CRDT text operations at save
//! granularity) and writes the binary state alongside the script as
//! `<stem>.loro`. `script.fountain` stays the human-readable source of
//! truth; the CRDT file carries exact per-save history for future features
//! (per-edit replay, offline merge). Invariant, test-enforced:
//! fountain -> CRDT -> fountain is byte-identical.

use loro::{ExportMode, LoroDoc};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const TEXT_CONTAINER: &str = "script";

pub fn crdt_path(project_dir: &Path, stem: &str) -> PathBuf {
    project_dir.join(format!("{}.loro", stem))
}

fn load_doc(path: &Path) -> LoroDoc {
    let doc = LoroDoc::new();
    if let Ok(bytes) = fs::read(path) {
        // A corrupt/incompatible state file starts history fresh rather than
        // failing the save: the fountain file is the source of truth.
        let _ = doc.import(&bytes);
    }
    doc
}

/// Fold the latest fountain serialization into the CRDT state (diff-based)
/// and persist it atomically. Returns the exported byte size.
pub fn update(project_dir: &Path, stem: &str, fountain_text: &str) -> io::Result<usize> {
    let path = crdt_path(project_dir, stem);
    let doc = load_doc(&path);
    let text = doc.get_text(TEXT_CONTAINER);
    text.update(fountain_text, Default::default())
        .map_err(|e| io::Error::other(format!("loro update: {:?}", e)))?;
    doc.commit();
    let bytes = doc
        .export(ExportMode::Snapshot)
        .map_err(|e| io::Error::other(format!("loro export: {:?}", e)))?;
    crate::snapshots::atomic_write(&path, &bytes)?;
    Ok(bytes.len())
}

/// Read the current text back out of the persisted CRDT state.
pub fn read_text(project_dir: &Path, stem: &str) -> Option<String> {
    let path = crdt_path(project_dir, stem);
    if !path.exists() {
        return None;
    }
    let doc = load_doc(&path);
    Some(doc.get_text(TEXT_CONTAINER).to_string())
}

/// Copy the current CRDT state next to a snapshot file so named versions
/// capture exact history up to that point.
pub fn capture_for_snapshot(project_dir: &Path, stem: &str, snapshot_file: &str) -> io::Result<()> {
    let src = crdt_path(project_dir, stem);
    if !src.exists() {
        return Ok(());
    }
    let dst = crate::snapshots::snapshots_dir(project_dir).join(format!("{}.loro", snapshot_file));
    fs::copy(&src, &dst).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fountain;
    use crate::model::{Element, ElementKind, Script};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("openscene-crdt-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn fountain_to_crdt_to_fountain_is_byte_identical() {
        let dir = tmp("roundtrip");
        let mut s = Script::default();
        s.title_page = vec![("Title".into(), "THE LONG NIGHT".into())];
        s.elements.push(Element::new(ElementKind::SceneHeading, "INT. LAB - NIGHT"));
        s.elements.push(Element::new(ElementKind::Action, "Sparks fly.\nSmoke everywhere."));
        s.elements.push(Element::new(ElementKind::Character, "MAYA"));
        s.elements.push(Element::new(ElementKind::Dialogue, "It's alive."));
        let text = fountain::serialize(&s);

        update(&dir, "script", &text).unwrap();
        let back = read_text(&dir, "script").unwrap();
        assert_eq!(text, back, "fountain -> CRDT -> fountain must be byte-identical");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn incremental_updates_accumulate_history() {
        let dir = tmp("incremental");
        update(&dir, "script", "INT. A - DAY\n\nOne.\n").unwrap();
        update(&dir, "script", "INT. A - DAY\n\nOne. Two.\n").unwrap();
        update(&dir, "script", "INT. A - NIGHT\n\nOne. Two.\n").unwrap();
        let back = read_text(&dir, "script").unwrap();
        assert_eq!(back, "INT. A - NIGHT\n\nOne. Two.\n");
        // History survives reload: the doc has multiple ops, not one blob.
        let doc = load_doc(&crdt_path(&dir, "script"));
        assert!(doc.len_changes() >= 3, "changes: {}", doc.len_changes());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_state_file_recovers_fresh() {
        let dir = tmp("corrupt");
        fs::write(crdt_path(&dir, "script"), b"not a loro file").unwrap();
        update(&dir, "script", "INT. B - DAY\n\nFine.\n").unwrap();
        assert_eq!(read_text(&dir, "script").unwrap(), "INT. B - DAY\n\nFine.\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_capture_copies_state() {
        let dir = tmp("snapcap");
        fs::create_dir_all(crate::snapshots::snapshots_dir(&dir)).unwrap();
        update(&dir, "script", "INT. C - DAY\n\nX.\n").unwrap();
        capture_for_snapshot(&dir, "script", "script-20260101-000000.fountain").unwrap();
        assert!(crate::snapshots::snapshots_dir(&dir)
            .join("script-20260101-000000.fountain.loro")
            .exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
