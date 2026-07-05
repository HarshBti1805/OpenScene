import { invoke } from "@tauri-apps/api/core";
import type {
  LayoutOptions,
  LockedState,
  Misspelling,
  OpenResult,
  PageMap,
  ProjectData,
  ProjectMeta,
  Script,
  ScriptStats,
  SnapshotMeta,
} from "./types";

export const api = {
  createProject: (path: string, name: string, template: string) =>
    invoke<OpenResult>("create_project", { path, name, template }),
  openProject: (path: string) => invoke<OpenResult>("open_project", { path }),
  peekProject: (path: string) => invoke<ProjectData>("peek_project", { path }),
  recoverProject: (path: string, snapshotFile: string) =>
    invoke<OpenResult>("recover_project", { path, snapshotFile }),
  heartbeatProject: (path: string) => invoke<void>("heartbeat_project", { path }),
  releaseProject: (path: string) => invoke<void>("release_project", { path }),
  resolveConflict: (path: string, file: string, action: string) =>
    invoke<OpenResult>("resolve_conflict", { path, file, action }),
  createAutoBackup: (path: string) => invoke<string>("create_auto_backup", { path }),
  saveUndoState: (path: string, state: string, stem: string) =>
    invoke<void>("save_undo_state", { path, state, stem }),
  loadUndoState: (path: string, stem: string) =>
    invoke<string | null>("load_undo_state", { path, stem }),
  exportTextFile: (file: string, contents: string) =>
    invoke<void>("export_text_file", { file, contents }),
  saveAssetBase64: (path: string, name: string, data: string) =>
    invoke<string>("save_asset_base64", { path, name, data }),
  spellLanguages: () => invoke<string[]>("spell_languages"),
  spellCheck: (texts: string[], custom: string[]) =>
    invoke<Misspelling[][]>("spell_check", { texts, custom }),
  spellSuggest: (word: string) => invoke<string[]>("spell_suggest", { word }),
  parseFountain: (text: string) => invoke<Script>("parse_fountain", { text }),
  lockPages: (script: Script, opts: LayoutOptions) =>
    invoke<{ script: Script; locked: LockedState }>("lock_pages", { script, opts }),
  saveScript: (path: string, script: Script) =>
    invoke<string>("save_script", { path, script }),
  saveProjectMeta: (path: string, meta: ProjectMeta) =>
    invoke<void>("save_project_meta", { path, meta }),
  recentProjects: () => invoke<string[]>("recent_projects"),
  addRecentProject: (path: string) =>
    invoke<void>("add_recent_project", { path }),
  computePageMap: (script: Script, opts: LayoutOptions) =>
    invoke<PageMap>("compute_page_map", { script, opts }),
  computeStats: (script: Script, opts: LayoutOptions) =>
    invoke<ScriptStats>("compute_stats", { script, opts }),
  importScript: (file: string) => invoke<Script>("import_script", { file }),
  exportFountain: (file: string, script: Script) =>
    invoke<void>("export_fountain_file", { file, script }),
  exportFdx: (file: string, script: Script) =>
    invoke<void>("export_fdx_file", { file, script }),
  exportPdf: (file: string, script: Script, opts: LayoutOptions, project: string | null) =>
    invoke<void>("export_pdf_file", { file, script, opts, project }),
  exportPdfTemp: (script: Script, opts: LayoutOptions, project: string | null) =>
    invoke<string>("export_pdf_temp", { script, opts, project }),
  takeSnapshot: (
    path: string,
    script: Script,
    name: string | null,
    automatic: boolean,
    stem: string | null = null,
  ) => invoke<SnapshotMeta>("take_snapshot", { path, script, name, automatic, stem }),
  listDocuments: (path: string) =>
    invoke<{ drafts: string[]; notes: string[] }>("list_documents", { path }),
  createDraft: (path: string, name: string, fromScript: boolean) =>
    invoke<void>("create_draft", { path, name, fromScript }),
  readDraft: (path: string, name: string) => invoke<Script>("read_draft", { path, name }),
  saveDraft: (path: string, name: string, script: Script) =>
    invoke<void>("save_draft", { path, name, script }),
  createNote: (path: string, name: string) => invoke<void>("create_note", { path, name }),
  readNote: (path: string, name: string) => invoke<string>("read_note", { path, name }),
  saveNote: (path: string, name: string, text: string) =>
    invoke<void>("save_note", { path, name, text }),
  deleteDocument: (path: string, kind: "draft" | "note", name: string) =>
    invoke<void>("delete_document", { path, kind, name }),
  importNoteAsset: (path: string, source: string) =>
    invoke<string>("import_note_asset", { path, source }),
  readAssetBase64: (path: string, name: string) =>
    invoke<string>("read_asset_base64", { path, name }),
  listSnapshots: (path: string) =>
    invoke<SnapshotMeta[]>("list_snapshots", { path }),
  readSnapshot: (path: string, file: string) =>
    invoke<Script>("read_snapshot", { path, file }),
  createBackup: (path: string, backupDir: string) =>
    invoke<string>("create_backup", { path, backupDir }),
  listBackups: (backupDir: string, projectName: string) =>
    invoke<string[]>("list_backups", { backupDir, projectName }),
  restoreBackup: (zipPath: string, targetDir: string) =>
    invoke<void>("restore_backup", { zipPath, targetDir }),
};
