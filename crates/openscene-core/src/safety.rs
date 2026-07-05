//! Sync-safety primitives: single-writer heartbeat detection, sync-conflict
//! artifact discovery, and damaged-file quarantine.
//!
//! No lockfiles: a heartbeat file (`.openscene-writer.json`) carries
//! host + pid + a timestamp refreshed while a writer has the project open.
//! A *live* heartbeat from another host/pid means another OpenScene instance
//! is probably writing; the caller opens read-only. Stale heartbeats (crashed
//! writers) are ignored and reclaimed.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const HEARTBEAT_FILE: &str = ".openscene-writer.json";
/// A heartbeat older than this is considered stale (writer crashed/closed).
pub const STALE_SECS: u64 = 45;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Heartbeat {
    pub host: String,
    pub pid: u32,
    /// Seconds since the unix epoch.
    pub timestamp: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string())
}

pub fn own_heartbeat() -> Heartbeat {
    Heartbeat {
        host: hostname(),
        pid: std::process::id(),
        timestamp: now_secs(),
    }
}

fn heartbeat_path(project_dir: &Path) -> PathBuf {
    project_dir.join(HEARTBEAT_FILE)
}

/// Refresh our heartbeat. Plain write (not atomic): the file is advisory and
/// a torn read is treated as absent.
pub fn write_heartbeat(project_dir: &Path) -> io::Result<()> {
    let hb = own_heartbeat();
    let json = serde_json::to_string(&hb).map_err(io::Error::other)?;
    fs::write(heartbeat_path(project_dir), json)
}

pub fn clear_heartbeat(project_dir: &Path) {
    let _ = fs::remove_file(heartbeat_path(project_dir));
}

/// Returns the other live writer, if any.
pub fn other_live_writer(project_dir: &Path) -> Option<Heartbeat> {
    other_live_writer_at(project_dir, now_secs())
}

fn other_live_writer_at(project_dir: &Path, now: u64) -> Option<Heartbeat> {
    let text = fs::read_to_string(heartbeat_path(project_dir)).ok()?;
    let hb: Heartbeat = serde_json::from_str(&text).ok()?;
    let me = own_heartbeat();
    if hb.host == me.host && hb.pid == me.pid {
        return None;
    }
    if now.saturating_sub(hb.timestamp) > STALE_SECS {
        return None; // stale: crashed or closed writer
    }
    Some(hb)
}

/// Sync-conflict artifacts produced by common sync tools, found at the top
/// level of the project folder.
pub fn find_conflict_files(project_dir: &Path) -> Vec<String> {
    let Ok(rd) = fs::read_dir(project_dir) else {
        return Vec::new();
    };
    let mut out: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| is_conflict_name(n))
        .collect();
    out.sort();
    out
}

/// Dropbox: "name (Someone's conflicted copy 2026-07-04).fountain"
/// Syncthing: "name.sync-conflict-20260704-123456-ABCDEF.fountain"
/// Nextcloud: "name (conflicted copy 2026-07-04 123456).fountain"
pub fn is_conflict_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("conflicted copy")
        || lower.contains(".sync-conflict-")
        || lower.contains("(case conflict")
}

/// Move a damaged file aside as `<name>.damaged-<stamp>`, never overwriting.
/// Returns the quarantine path (or None if the file didn't exist).
pub fn quarantine_damaged(path: &Path) -> io::Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut target = path.with_file_name(format!(
        "{}.damaged-{}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("file"),
        stamp
    ));
    let mut n = 1;
    while target.exists() {
        target = path.with_file_name(format!(
            "{}.damaged-{}-{}",
            path.file_name().and_then(|s| s.to_str()).unwrap_or("file"),
            stamp,
            n
        ));
        n += 1;
    }
    fs::rename(path, &target)?;
    Ok(Some(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("openscene-safety-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn own_heartbeat_is_not_another_writer() {
        let dir = tmp("own");
        write_heartbeat(&dir).unwrap();
        assert!(other_live_writer(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn foreign_live_heartbeat_is_detected_and_stale_is_ignored() {
        let dir = tmp("foreign");
        let hb = Heartbeat {
            host: "other-machine".into(),
            pid: 1,
            timestamp: now_secs(),
        };
        fs::write(dir.join(HEARTBEAT_FILE), serde_json::to_string(&hb).unwrap()).unwrap();
        assert!(other_live_writer(&dir).is_some());
        // Stale (old timestamp): reclaimed.
        let old = Heartbeat {
            timestamp: now_secs() - STALE_SECS - 10,
            ..hb
        };
        fs::write(dir.join(HEARTBEAT_FILE), serde_json::to_string(&old).unwrap()).unwrap();
        assert!(other_live_writer(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn conflict_names_are_recognized() {
        assert!(is_conflict_name("script (Harsh's conflicted copy 2026-07-04).fountain"));
        assert!(is_conflict_name("script.sync-conflict-20260704-123456-ABCDEF.fountain"));
        assert!(!is_conflict_name("script.fountain"));
        assert!(!is_conflict_name("project.json"));
    }

    #[test]
    fn quarantine_moves_file_aside_without_overwriting() {
        let dir = tmp("quarantine");
        let f = dir.join("script.fountain");
        fs::write(&f, "data").unwrap();
        let moved = quarantine_damaged(&f).unwrap().unwrap();
        assert!(!f.exists());
        assert!(moved.exists());
        assert!(moved.file_name().unwrap().to_str().unwrap().contains(".damaged-"));
        assert_eq!(fs::read_to_string(moved).unwrap(), "data");
        assert!(quarantine_damaged(&f).unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
