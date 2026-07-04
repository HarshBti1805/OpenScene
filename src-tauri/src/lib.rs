//! Tauri command layer: a thin, JSON-in/JSON-out bridge over openscene-core.
//! Every command is pure file I/O or pure computation. Zero network.

use openscene_core::model::{LayoutOptions, Script};
use openscene_core::paginate::PageMap;
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
fn create_project(path: String, name: String, template: String) -> CmdResult<ProjectData> {
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
    };
    snapshots::atomic_write(
        &project_json_path(&dir),
        serde_json::to_string_pretty(&meta).map_err(err)?.as_bytes(),
    )
    .map_err(err)?;
    open_project(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn open_project(path: String) -> CmdResult<ProjectData> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    let meta: ProjectMeta = match fs::read_to_string(project_json_path(&dir)) {
        Ok(s) => serde_json::from_str(&s).map_err(err)?,
        Err(_) => ProjectMeta {
            name: dir
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Project".into()),
            created: String::new(),
            backup_dir: None,
            scene_numbering: None,
        },
    };
    let text = fs::read_to_string(script_path(&dir)).unwrap_or_default();
    let script = fountain::parse(&text);
    Ok(ProjectData {
        path: dir.to_string_lossy().to_string(),
        meta,
        script,
        fountain_text: text,
    })
}

#[tauri::command]
fn save_script(path: String, script: Script) -> CmdResult<String> {
    let dir = PathBuf::from(&path);
    let text = fountain::serialize(&script);
    snapshots::atomic_write(&script_path(&dir), text.as_bytes()).map_err(err)?;
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

#[tauri::command]
fn export_pdf_file(file: String, script: Script, opts: LayoutOptions) -> CmdResult<()> {
    let bytes = pdf::render(&script, &opts);
    snapshots::atomic_write(&PathBuf::from(file), &bytes).map_err(err)
}

/// Render a PDF into the OS temp dir (used for Print: open in system viewer).
#[tauri::command]
fn export_pdf_temp(script: Script, opts: LayoutOptions) -> CmdResult<String> {
    let bytes = pdf::render(&script, &opts);
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
) -> CmdResult<SnapshotMeta> {
    let dir = PathBuf::from(&path);
    let text = fountain::serialize(&script);
    snapshots::take(&dir, "script", &text, name, automatic).map_err(err)
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
