//! Tauri command layer: a thin, JSON-in/JSON-out bridge over openscene-core.
//! Every command is pure file I/O or pure computation. Zero network.

use openscene_core::model::{LayoutOptions, Script};
use openscene_core::paginate::PageMap;
use openscene_core::safety::{self, Heartbeat};
use openscene_core::snapshots::{self, SnapshotMeta};
use openscene_core::stats::ScriptStats;
use openscene_core::{backup, fdx, fountain, paginate, pdf, stats};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectMeta {
    pub name: String,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub backup_dir: Option<String>,
    #[serde(default)]
    pub scene_numbering: Option<String>,
    /// Per-project custom spelling dictionary (user-added words).
    #[serde(default)]
    pub dictionary: Vec<String>,
    /// Revision sets (ordered by the standard color ladder).
    #[serde(default)]
    pub revisions: Vec<openscene_core::model::RevisionSet>,
    /// Id of the active revision set (edits get marked while set).
    #[serde(default)]
    pub active_revision: Option<String>,
    /// Locked pagination state (production drafts). None = free reflow.
    #[serde(default)]
    pub locked: Option<openscene_core::model::LockedState>,
    /// Script format (None = US Feature standard).
    #[serde(default)]
    pub format: Option<openscene_core::model::FormatSpec>,
    /// Table-read voice assignment per character (cue base -> voice URI).
    #[serde(default)]
    pub voices: std::collections::HashMap<String, String>,
    /// Optional gender metadata per character (inclusivity analysis).
    #[serde(default)]
    pub genders: std::collections::HashMap<String, String>,
    /// Pinned quick-access items ("scene:<number>", "note:<name>").
    #[serde(default)]
    pub pins: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ProjectData {
    pub path: String,
    pub meta: ProjectMeta,
    pub script: Script,
    pub fountain_text: String,
}

fn project_json_path(dir: &Path) -> PathBuf {
    dir.join("project.json")
}

fn script_path(dir: &Path) -> PathBuf {
    dir.join("script.fountain")
}

const FEATURE_TEMPLATE: &str = "Title: UNTITLED FEATURE\nCredit: written by\nAuthor: Your Name\nDraft date: DRAFT\nContact: your@email\n\nINT. LOCATION - DAY\n\nDescribe the opening image.\n";
const SHORT_TEMPLATE: &str = "Title: UNTITLED SHORT\nCredit: written by\nAuthor: Your Name\nDraft date: DRAFT\n\nINT. LOCATION - DAY\n\nA short film begins.\n";

#[tauri::command]
fn create_project(path: String, name: String, template: String) -> CmdResult<OpenResult> {
    let dir = PathBuf::from(&path).join(&name);
    if dir.exists() && fs::read_dir(&dir).map_err(err)?.next().is_some() {
        return Err(format!("Folder {} already exists and is not empty", dir.display()));
    }
    fs::create_dir_all(&dir).map_err(err)?;
    fs::create_dir_all(dir.join("snapshots")).map_err(err)?;
    let body = match template.as_str() {
        "short" => SHORT_TEMPLATE,
        _ => FEATURE_TEMPLATE,
    };
    let body = body.replace("UNTITLED FEATURE", &name.to_uppercase()).replace("UNTITLED SHORT", &name.to_uppercase());
    snapshots::atomic_write(&script_path(&dir), body.as_bytes()).map_err(err)?;
    let meta = ProjectMeta {
        name: name.clone(),
        created: chrono::Local::now().format("%Y-%m-%d").to_string(),
        backup_dir: None,
        scene_numbering: None,
        dictionary: Vec::new(),
        revisions: Vec::new(),
        active_revision: None,
        locked: None,
        format: None,
        voices: std::collections::HashMap::new(),
        genders: std::collections::HashMap::new(),
        pins: Vec::new(),
    };
    snapshots::atomic_write(
        &project_json_path(&dir),
        serde_json::to_string_pretty(&meta).map_err(err)?.as_bytes(),
    )
    .map_err(err)?;
    open_project(dir.to_string_lossy().to_string())
}

/// Result of verify-on-open. Exactly one of `data` / `corrupt` is set.
#[derive(Debug, Serialize)]
pub struct OpenResult {
    pub data: Option<ProjectData>,
    /// Human-readable corruption reason; recovery points are in `snapshots`.
    pub corrupt: Option<String>,
    pub snapshots: Vec<SnapshotMeta>,
    /// True when another live writer holds the project (open read-only).
    pub read_only: bool,
    pub other_writer: Option<Heartbeat>,
    /// Sync-conflict artifact file names found in the project folder.
    pub conflicts: Vec<String>,
}

fn default_meta(dir: &Path) -> ProjectMeta {
    ProjectMeta {
        name: dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Project".into()),
        created: String::new(),
        backup_dir: None,
        scene_numbering: None,
        dictionary: Vec::new(),
        revisions: Vec::new(),
        active_revision: None,
        locked: None,
        format: None,
        voices: std::collections::HashMap::new(),
        genders: std::collections::HashMap::new(),
        pins: Vec::new(),
    }
}

fn corrupt_result(dir: &Path, reason: String) -> OpenResult {
    OpenResult {
        data: None,
        corrupt: Some(reason),
        snapshots: snapshots::list(dir),
        read_only: false,
        other_writer: None,
        conflicts: Vec::new(),
    }
}

/// Verify-on-open: validate project.json, ensure the script is readable, and
/// check for competing writers and sync-conflict artifacts. Never opens a
/// project partially: corruption yields a recovery result instead of data.
#[tauri::command]
fn open_project(path: String) -> CmdResult<OpenResult> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }

    // 1. project.json must be absent (legacy) or valid JSON with our schema.
    let meta: ProjectMeta = match fs::read_to_string(project_json_path(&dir)) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(m) => m,
            Err(e) => return Ok(corrupt_result(&dir, format!("project.json is not valid: {}", e))),
        },
        Err(_) => default_meta(&dir),
    };

    // 2. script.fountain must be readable UTF-8. A missing script with
    //    existing snapshots means the project lost its main document.
    let sp = script_path(&dir);
    let text = if sp.exists() {
        match fs::read_to_string(&sp) {
            Ok(t) => t,
            Err(e) => {
                return Ok(corrupt_result(&dir, format!("script.fountain is unreadable: {}", e)))
            }
        }
    } else if !snapshots::list(&dir).is_empty() {
        return Ok(corrupt_result(
            &dir,
            "script.fountain is missing but snapshots exist".to_string(),
        ));
    } else {
        String::new()
    };

    // 3. Single-writer check (advisory heartbeat, no lockfiles).
    let other_writer = safety::other_live_writer(&dir);
    let read_only = other_writer.is_some();
    if !read_only {
        let _ = safety::write_heartbeat(&dir);
    }

    // 4. Sync-conflict artifacts.
    let conflicts = safety::find_conflict_files(&dir);

    let script = fountain::parse(&text);
    Ok(OpenResult {
        data: Some(ProjectData {
            path: dir.to_string_lossy().to_string(),
            meta,
            script,
            fountain_text: text,
        }),
        corrupt: None,
        snapshots: Vec::new(),
        read_only,
        other_writer,
        conflicts,
    })
}

/// Side-effect-free read of a project (start-screen posters): no heartbeat,
/// no verification dialogs — failures just return an error.
#[tauri::command]
fn peek_project(path: String) -> CmdResult<ProjectData> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    let meta: ProjectMeta = fs::read_to_string(project_json_path(&dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| default_meta(&dir));
    let text = fs::read_to_string(script_path(&dir)).unwrap_or_default();
    let script = fountain::parse(&text);
    Ok(ProjectData {
        path: dir.to_string_lossy().to_string(),
        meta,
        script,
        fountain_text: text,
    })
}

/// Restore a project from a snapshot after verify-on-open failed. Damaged
/// originals are quarantined as `*.damaged-<stamp>`, never overwritten.
#[tauri::command]
fn recover_project(path: String, snapshot_file: String) -> CmdResult<OpenResult> {
    let dir = PathBuf::from(&path);
    let content = snapshots::read(&dir, &snapshot_file).map_err(err)?;

    // Quarantine whatever is damaged, then write the recovered state.
    safety::quarantine_damaged(&script_path(&dir)).map_err(err)?;
    snapshots::atomic_write(&script_path(&dir), content.as_bytes()).map_err(err)?;

    let pj = project_json_path(&dir);
    let json_ok = fs::read_to_string(&pj)
        .map(|s| serde_json::from_str::<ProjectMeta>(&s).is_ok())
        .unwrap_or(false);
    if !json_ok {
        safety::quarantine_damaged(&pj).map_err(err)?;
        let meta = default_meta(&dir);
        snapshots::atomic_write(&pj, serde_json::to_string_pretty(&meta).map_err(err)?.as_bytes())
            .map_err(err)?;
    }
    open_project(path)
}

/// Refresh this instance's writer heartbeat (called periodically while open).
#[tauri::command]
fn heartbeat_project(path: String) {
    let _ = safety::write_heartbeat(&PathBuf::from(path));
}

/// Release the writer heartbeat when the project closes.
#[tauri::command]
fn release_project(path: String) {
    safety::clear_heartbeat(&PathBuf::from(path));
}

/// Resolve a sync-conflict artifact. Every branch snapshots before deleting
/// anything, so no content can be lost.
#[tauri::command]
fn resolve_conflict(path: String, file: String, action: String) -> CmdResult<OpenResult> {
    let dir = PathBuf::from(&path);
    if file.contains('/') || file.contains('\\') || file.contains("..") {
        return Err("invalid conflict file name".into());
    }
    let conflict_path = dir.join(&file);
    let theirs = fs::read_to_string(&conflict_path).map_err(err)?;
    let mine = fs::read_to_string(script_path(&dir)).unwrap_or_default();

    match action.as_str() {
        "keep_mine" => {
            snapshots::take(&dir, "script", &theirs, Some(format!("conflict copy: {}", file)), false)
                .map_err(err)?;
        }
        "take_theirs" => {
            snapshots::take(&dir, "script", &mine, Some("before taking conflict copy".into()), false)
                .map_err(err)?;
            snapshots::atomic_write(&script_path(&dir), theirs.as_bytes()).map_err(err)?;
        }
        "snapshot_both" => {
            snapshots::take(&dir, "script", &mine, Some("conflict: my copy".into()), false)
                .map_err(err)?;
            snapshots::take(&dir, "script", &theirs, Some(format!("conflict: their copy ({})", file)), false)
                .map_err(err)?;
        }
        other => return Err(format!("unknown conflict action: {}", other)),
    }
    fs::remove_file(&conflict_path).map_err(err)?;
    open_project(path)
}

/// Zipped backup into the app-data fallback (`auto-backups/`), used on quit
/// and before risky operations when no user backup folder is configured.
#[tauri::command]
fn create_auto_backup(app: tauri::AppHandle, path: String) -> CmdResult<String> {
    let dir = app.path().app_config_dir().map_err(err)?.join("auto-backups");
    backup::create(&PathBuf::from(path), &dir, 10).map_err(err)
}

// ---------------------------------------------------------------------------
// Locked pages (production drafts)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct LockResult {
    /// Script with scene numbers materialized (write back to the editor).
    pub script: Script,
    pub locked: openscene_core::model::LockedState,
}

/// Freeze the current pagination and scene numbering.
#[tauri::command]
fn lock_pages(script: Script, opts: LayoutOptions) -> LockResult {
    let (script, locked) = paginate::compute_lock(&script, &opts);
    LockResult { script, locked }
}

// ---------------------------------------------------------------------------
// Multi-document projects: drafts/*.fountain and notes/*.md (+ assets/)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ProjectDocuments {
    pub drafts: Vec<String>,
    pub notes: Vec<String>,
}

/// Reject anything that isn't a bare, safe file stem.
fn safe_stem(name: &str) -> CmdResult<()> {
    if name.is_empty()
        || name.len() > 80
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('.')
    {
        return Err("invalid document name".into());
    }
    Ok(())
}

fn scan_stems(dir: &Path, ext: &str) -> Vec<String> {
    let mut out: Vec<String> = match fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some(ext) {
                    p.file_stem().and_then(|s| s.to_str()).map(String::from)
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    out.sort();
    out
}

#[tauri::command]
fn list_documents(path: String) -> ProjectDocuments {
    let dir = PathBuf::from(&path);
    ProjectDocuments {
        drafts: scan_stems(&dir.join("drafts"), "fountain"),
        notes: scan_stems(&dir.join("notes"), "md"),
    }
}

fn draft_path(dir: &Path, name: &str) -> PathBuf {
    dir.join("drafts").join(format!("{}.fountain", name))
}

fn note_path(dir: &Path, name: &str) -> PathBuf {
    dir.join("notes").join(format!("{}.md", name))
}

/// Create a draft, optionally seeded from the current main script.
#[tauri::command]
fn create_draft(path: String, name: String, from_script: bool) -> CmdResult<()> {
    safe_stem(&name)?;
    let dir = PathBuf::from(&path);
    fs::create_dir_all(dir.join("drafts")).map_err(err)?;
    let target = draft_path(&dir, &name);
    if target.exists() {
        return Err(format!("Draft {} already exists", name));
    }
    let content = if from_script {
        fs::read_to_string(script_path(&dir)).unwrap_or_default()
    } else {
        String::new()
    };
    snapshots::atomic_write(&target, content.as_bytes()).map_err(err)
}

#[tauri::command]
fn read_draft(path: String, name: String) -> CmdResult<Script> {
    safe_stem(&name)?;
    let text = fs::read_to_string(draft_path(&PathBuf::from(&path), &name)).map_err(err)?;
    Ok(fountain::parse(&text))
}

#[tauri::command]
fn save_draft(path: String, name: String, script: Script) -> CmdResult<()> {
    safe_stem(&name)?;
    let dir = PathBuf::from(&path);
    fs::create_dir_all(dir.join("drafts")).map_err(err)?;
    let text = fountain::serialize(&script);
    snapshots::atomic_write(&draft_path(&dir, &name), text.as_bytes()).map_err(err)?;
    let _ = openscene_core::crdt::update(&dir.join("drafts"), &name, &text);
    Ok(())
}

#[tauri::command]
fn create_note(path: String, name: String) -> CmdResult<()> {
    safe_stem(&name)?;
    let dir = PathBuf::from(&path);
    fs::create_dir_all(dir.join("notes")).map_err(err)?;
    let target = note_path(&dir, &name);
    if target.exists() {
        return Err(format!("Note {} already exists", name));
    }
    snapshots::atomic_write(&target, format!("# {}\n\n", name).as_bytes()).map_err(err)
}

#[tauri::command]
fn read_note(path: String, name: String) -> CmdResult<String> {
    safe_stem(&name)?;
    fs::read_to_string(note_path(&PathBuf::from(&path), &name)).map_err(err)
}

#[tauri::command]
fn save_note(path: String, name: String, text: String) -> CmdResult<()> {
    safe_stem(&name)?;
    let dir = PathBuf::from(&path);
    fs::create_dir_all(dir.join("notes")).map_err(err)?;
    snapshots::atomic_write(&note_path(&dir, &name), text.as_bytes()).map_err(err)
}

/// Delete a draft or note. Its content is snapshotted first (with a
/// document-scoped stem), so deletion is always recoverable.
#[tauri::command]
fn delete_document(path: String, kind: String, name: String) -> CmdResult<()> {
    safe_stem(&name)?;
    let dir = PathBuf::from(&path);
    let (file, stem) = match kind.as_str() {
        "draft" => (draft_path(&dir, &name), format!("draft-{}", name)),
        "note" => (note_path(&dir, &name), format!("note-{}", name)),
        other => return Err(format!("unknown document kind: {}", other)),
    };
    if let Ok(content) = fs::read_to_string(&file) {
        snapshots::take(&dir, &stem, &content, Some(format!("deleted {}", name)), false)
            .map_err(err)?;
    }
    fs::remove_file(&file).map_err(err)
}

/// Copy an image into the project's `assets/` folder; returns the file name.
#[tauri::command]
fn import_note_asset(path: String, source: String) -> CmdResult<String> {
    let dir = PathBuf::from(&path);
    let src = PathBuf::from(&source);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        return Err("unsupported image type".into());
    }
    fs::create_dir_all(dir.join("assets")).map_err(err)?;
    let base = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    let mut name = format!("{}.{}", base, ext);
    let mut n = 1;
    while dir.join("assets").join(&name).exists() {
        name = format!("{}-{}.{}", base, n, ext);
        n += 1;
    }
    fs::copy(&src, dir.join("assets").join(&name)).map_err(err)?;
    Ok(name)
}

/// Read a project asset as base64 (for Markdown preview inside the webview).
#[tauri::command]
fn read_asset_base64(path: String, name: String) -> CmdResult<String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid asset name".into());
    }
    let bytes = fs::read(PathBuf::from(&path).join("assets").join(&name)).map_err(err)?;
    Ok(base64_encode(&bytes))
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

// ---------------------------------------------------------------------------
// Spell check (bundled Hunspell en_US; extra dictionaries from app data)
// ---------------------------------------------------------------------------

use openscene_core::spell::{self, Misspelling};

/// Load extra Hunspell dictionaries dropped into `<app-config>/dictionaries/`
/// and return every available language (multi-language groundwork).
#[tauri::command]
fn spell_languages(app: tauri::AppHandle) -> Vec<String> {
    if let Ok(dir) = app.path().app_config_dir() {
        return spell::load_extra_dictionaries(&dir.join("dictionaries"));
    }
    spell::available_languages()
}

#[tauri::command]
fn spell_check(texts: Vec<String>, custom: Vec<String>) -> Vec<Vec<Misspelling>> {
    spell::check_texts(spell::DEFAULT_LANG, &texts, &custom)
}

#[tauri::command]
fn spell_suggest(word: String) -> Vec<String> {
    spell::suggest(spell::DEFAULT_LANG, &word, 6)
}

// ---------------------------------------------------------------------------
// Persisted undo (session undo stack survives relaunch)
// ---------------------------------------------------------------------------

fn undo_path(dir: &Path, stem: &str) -> PathBuf {
    if stem == "script" {
        dir.join(".openscene-undo.json")
    } else {
        dir.join(format!(".openscene-undo-{}.json", stem))
    }
}

fn safe_undo_stem(stem: &Option<String>) -> CmdResult<String> {
    let s = stem.clone().unwrap_or_else(|| "script".into());
    if s.contains('/') || s.contains('\\') || s.contains("..") {
        return Err("invalid undo stem".into());
    }
    Ok(s)
}

#[tauri::command]
fn save_undo_state(path: String, state: String, stem: Option<String>) -> CmdResult<()> {
    let stem = safe_undo_stem(&stem)?;
    snapshots::atomic_write(&undo_path(&PathBuf::from(path), &stem), state.as_bytes()).map_err(err)
}

#[tauri::command]
fn load_undo_state(path: String, stem: Option<String>) -> Option<String> {
    let stem = safe_undo_stem(&stem).ok()?;
    fs::read_to_string(undo_path(&PathBuf::from(path), &stem)).ok()
}

/// Write a plain text export (reports, CSV) via atomic write.
#[tauri::command]
fn export_text_file(file: String, contents: String) -> CmdResult<()> {
    snapshots::atomic_write(&PathBuf::from(file), contents.as_bytes()).map_err(err)
}

/// Save base64 content as a project asset (canvas-converted images).
#[tauri::command]
fn save_asset_base64(path: String, name: String, data: String) -> CmdResult<String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid asset name".into());
    }
    let dir = PathBuf::from(&path).join("assets");
    fs::create_dir_all(&dir).map_err(err)?;
    let bytes = base64_decode(&data).ok_or_else(|| "invalid base64".to_string())?;
    snapshots::atomic_write(&dir.join(&name), &bytes).map_err(err)?;
    Ok(name)
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let clean: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        if chunk.len() < 2 {
            return None;
        }
        let a = val(chunk[0])?;
        let b = val(chunk[1])?;
        out.push(((a << 2) | (b >> 4)) as u8);
        if chunk.len() > 2 && chunk[2] != b'=' {
            let c = val(chunk[2])?;
            out.push((((b & 15) << 4) | (c >> 2)) as u8);
            if chunk.len() > 3 && chunk[3] != b'=' {
                let d = val(chunk[3])?;
                out.push((((c & 3) << 6) | d) as u8);
            }
        }
    }
    Some(out)
}

#[tauri::command]
fn save_script(path: String, script: Script) -> CmdResult<String> {
    let dir = PathBuf::from(&path);
    let text = fountain::serialize(&script);
    snapshots::atomic_write(&script_path(&dir), text.as_bytes()).map_err(err)?;
    // CRDT history (auxiliary; a failure never blocks the save itself).
    let _ = openscene_core::crdt::update(&dir, "script", &text);
    Ok(text)
}

#[tauri::command]
fn save_project_meta(path: String, meta: ProjectMeta) -> CmdResult<()> {
    let dir = PathBuf::from(&path);
    snapshots::atomic_write(
        &project_json_path(&dir),
        serde_json::to_string_pretty(&meta).map_err(err)?.as_bytes(),
    )
    .map_err(err)
}

// ---------------------------------------------------------------------------
// Recent projects (stored in the app config dir; plain JSON)
// ---------------------------------------------------------------------------

fn recents_path(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("recent-projects.json"))
}

#[tauri::command]
fn recent_projects(app: tauri::AppHandle) -> CmdResult<Vec<String>> {
    let p = recents_path(&app)?;
    let list: Vec<String> = match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    // Keep only paths that still exist.
    Ok(list.into_iter().filter(|p| Path::new(p).is_dir()).collect())
}

#[tauri::command]
fn add_recent_project(app: tauri::AppHandle, path: String) -> CmdResult<()> {
    let p = recents_path(&app)?;
    let mut list: Vec<String> = match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    list.retain(|x| x != &path);
    list.insert(0, path);
    list.truncate(15);
    snapshots::atomic_write(&p, serde_json::to_string_pretty(&list).map_err(err)?.as_bytes()).map_err(err)
}

// ---------------------------------------------------------------------------
// Format engine
// ---------------------------------------------------------------------------

#[tauri::command]
fn compute_page_map(script: Script, opts: LayoutOptions) -> PageMap {
    paginate::page_map(&script, &opts)
}

#[tauri::command]
fn compute_stats(script: Script, opts: LayoutOptions) -> ScriptStats {
    stats::compute(&script, &opts)
}

#[tauri::command]
fn parse_fountain(text: String) -> Script {
    fountain::parse(&text)
}

#[tauri::command]
fn serialize_fountain(script: Script) -> String {
    fountain::serialize(&script)
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

#[tauri::command]
fn import_script(file: String) -> CmdResult<Script> {
    let path = PathBuf::from(&file);
    let text = fs::read_to_string(&path).map_err(err)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    Ok(match ext.as_str() {
        "fdx" => fdx::import(&text),
        _ => fountain::parse(&text),
    })
}

#[tauri::command]
fn export_fountain_file(file: String, script: Script) -> CmdResult<()> {
    snapshots::atomic_write(&PathBuf::from(file), fountain::serialize(&script).as_bytes()).map_err(err)
}

#[tauri::command]
fn export_fdx_file(file: String, script: Script) -> CmdResult<()> {
    snapshots::atomic_write(&PathBuf::from(file), fdx::export(&script).as_bytes()).map_err(err)
}

fn title_image_bytes(script: &Script, project: &Option<String>) -> Option<Vec<u8>> {
    let name = script
        .title_page
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("image"))
        .map(|(_, v)| v.clone())?;
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return None;
    }
    let dir = PathBuf::from(project.as_ref()?);
    fs::read(dir.join("assets").join(name)).ok()
}

#[tauri::command]
fn export_pdf_file(
    file: String,
    script: Script,
    opts: LayoutOptions,
    project: Option<String>,
) -> CmdResult<()> {
    let img = title_image_bytes(&script, &project);
    let bytes = pdf::render_with_image(&script, &opts, img.as_deref());
    snapshots::atomic_write(&PathBuf::from(file), &bytes).map_err(err)
}

/// Render a PDF into the OS temp dir (used for Print: open in system viewer).
#[tauri::command]
fn export_pdf_temp(script: Script, opts: LayoutOptions, project: Option<String>) -> CmdResult<String> {
    let img = title_image_bytes(&script, &project);
    let bytes = pdf::render_with_image(&script, &opts, img.as_deref());
    let name = format!(
        "openscene-print-{}.pdf",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let path = std::env::temp_dir().join(name);
    fs::write(&path, &bytes).map_err(err)?;
    Ok(path.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Snapshots & backups
// ---------------------------------------------------------------------------

#[tauri::command]
fn take_snapshot(
    path: String,
    script: Script,
    name: Option<String>,
    automatic: bool,
    stem: Option<String>,
) -> CmdResult<SnapshotMeta> {
    let dir = PathBuf::from(&path);
    let stem = stem.unwrap_or_else(|| "script".into());
    if stem.contains('/') || stem.contains('\\') || stem.contains("..") {
        return Err("invalid snapshot stem".into());
    }
    let text = fountain::serialize(&script);
    let meta = snapshots::take(&dir, &stem, &text, name, automatic).map_err(err)?;
    // Named versions capture exact CRDT history alongside the plain copy.
    if !automatic && stem == "script" {
        let _ = openscene_core::crdt::update(&dir, &stem, &text);
        let _ = openscene_core::crdt::capture_for_snapshot(&dir, &stem, &meta.file);
    }
    Ok(meta)
}

#[tauri::command]
fn list_snapshots(path: String) -> Vec<SnapshotMeta> {
    snapshots::list(&PathBuf::from(path))
}

#[tauri::command]
fn read_snapshot(path: String, file: String) -> CmdResult<Script> {
    let text = snapshots::read(&PathBuf::from(path), &file).map_err(err)?;
    Ok(fountain::parse(&text))
}

#[tauri::command]
fn create_backup(path: String, backup_dir: String) -> CmdResult<String> {
    backup::create(&PathBuf::from(path), &PathBuf::from(backup_dir), 20).map_err(err)
}

#[tauri::command]
fn list_backups(backup_dir: String, project_name: String) -> Vec<String> {
    backup::list(&PathBuf::from(backup_dir), &project_name)
}

#[tauri::command]
fn restore_backup(zip_path: String, target_dir: String) -> CmdResult<()> {
    backup::restore(&PathBuf::from(zip_path), &PathBuf::from(target_dir)).map_err(err)
}

// ---------------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            peek_project,
            recover_project,
            heartbeat_project,
            release_project,
            resolve_conflict,
            create_auto_backup,
            save_undo_state,
            load_undo_state,
            export_text_file,
            save_asset_base64,
            spell_languages,
            spell_check,
            spell_suggest,
            lock_pages,
            list_documents,
            create_draft,
            read_draft,
            save_draft,
            create_note,
            read_note,
            save_note,
            delete_document,
            import_note_asset,
            read_asset_base64,
            save_script,
            save_project_meta,
            recent_projects,
            add_recent_project,
            compute_page_map,
            compute_stats,
            parse_fountain,
            serialize_fountain,
            import_script,
            export_fountain_file,
            export_fdx_file,
            export_pdf_file,
            export_pdf_temp,
            take_snapshot,
            list_snapshots,
            read_snapshot,
            create_backup,
            list_backups,
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenScene");
}
