//! Local version history: full-copy snapshots inside `<project>/snapshots/`.
//!
//! A snapshot is a plain `.fountain` file named
//! `YYYYMMDD-HHMMSS[-name].fountain` plus a JSON index (`snapshots/index.json`)
//! carrying labels. Full copies keep the format human-recoverable: a user can
//! open any snapshot in a text editor. Script files are small (a feature is
//! ~200 KB), so full copies are cheap and indestructible.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotMeta {
    /// File name inside snapshots/ (unique id).
    pub file: String,
    /// RFC3339-ish local timestamp.
    pub timestamp: String,
    /// Optional user-provided name ("Draft 3 — post notes").
    #[serde(default)]
    pub name: Option<String>,
    /// True for automatic (timed) snapshots.
    #[serde(default)]
    pub automatic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SnapshotIndex {
    pub snapshots: Vec<SnapshotMeta>,
}

pub fn snapshots_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("snapshots")
}

fn index_path(project_dir: &Path) -> PathBuf {
    snapshots_dir(project_dir).join("index.json")
}

pub fn load_index(project_dir: &Path) -> SnapshotIndex {
    match fs::read_to_string(index_path(project_dir)) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => SnapshotIndex::default(),
    }
}

fn save_index(project_dir: &Path, index: &SnapshotIndex) -> io::Result<()> {
    let dir = snapshots_dir(project_dir);
    fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(index).map_err(io::Error::other)?;
    atomic_write(&index_path(project_dir), json.as_bytes())
}

/// Write via temp file + rename so a crash can never corrupt the target.
pub fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp~");
    fs::write(&tmp, contents)?;
    // fsync the temp file before renaming over the target.
    let f = fs::OpenOptions::new().write(true).open(&tmp)?;
    f.sync_all()?;
    drop(f);
    fs::rename(&tmp, path)
}

/// Take a snapshot of `content`. Returns the created metadata.
pub fn take(
    project_dir: &Path,
    script_stem: &str,
    content: &str,
    name: Option<String>,
    automatic: bool,
) -> io::Result<SnapshotMeta> {
    let dir = snapshots_dir(project_dir);
    fs::create_dir_all(&dir)?;
    let now = chrono::Local::now();
    let stamp = now.format("%Y%m%d-%H%M%S").to_string();
    let mut file = format!("{}-{}.fountain", script_stem, stamp);
    // De-dup name collisions within the same second.
    let mut counter = 1;
    while dir.join(&file).exists() {
        file = format!("{}-{}-{}.fountain", script_stem, stamp, counter);
        counter += 1;
    }
    atomic_write(&dir.join(&file), content.as_bytes())?;
    let meta = SnapshotMeta {
        file,
        timestamp: now.format("%Y-%m-%d %H:%M:%S").to_string(),
        name,
        automatic,
    };
    let mut index = load_index(project_dir);
    index.snapshots.push(meta.clone());
    prune_automatic(project_dir, &mut index, 100)?;
    save_index(project_dir, &index)?;
    Ok(meta)
}

/// Keep at most `keep` automatic snapshots (named versions are never pruned).
fn prune_automatic(project_dir: &Path, index: &mut SnapshotIndex, keep: usize) -> io::Result<()> {
    let auto_count = index.snapshots.iter().filter(|s| s.automatic).count();
    if auto_count <= keep {
        return Ok(());
    }
    let mut to_remove = auto_count - keep;
    let dir = snapshots_dir(project_dir);
    index.snapshots.retain(|s| {
        if to_remove > 0 && s.automatic {
            let _ = fs::remove_file(dir.join(&s.file));
            to_remove -= 1;
            false
        } else {
            true
        }
    });
    Ok(())
}

pub fn read(project_dir: &Path, file: &str) -> io::Result<String> {
    // Refuse path traversal: snapshot ids are bare file names.
    if file.contains('/') || file.contains('\\') || file.contains("..") {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid snapshot id"));
    }
    fs::read_to_string(snapshots_dir(project_dir).join(file))
}

pub fn list(project_dir: &Path) -> Vec<SnapshotMeta> {
    let mut v = load_index(project_dir).snapshots;
    v.reverse(); // newest first
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_take_list_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("openscene-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let m1 = take(&dir, "script", "INT. A - DAY\n\nOne.\n", None, true).unwrap();
        let m2 = take(&dir, "script", "INT. A - DAY\n\nTwo.\n", Some("Draft 2".into()), false).unwrap();
        assert_ne!(m1.file, m2.file);

        let all = list(&dir);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name.as_deref(), Some("Draft 2")); // newest first

        let content = read(&dir, &m2.file).unwrap();
        assert!(content.contains("Two."));

        assert!(read(&dir, "../escape").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = std::env::temp_dir().join(format!("openscene-aw-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("f.txt");
        atomic_write(&p, b"one").unwrap();
        atomic_write(&p, b"two").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        let _ = fs::remove_dir_all(&dir);
    }
}
