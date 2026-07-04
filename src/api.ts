import { invoke } from "@tauri-apps/api/core";
import type {
  LayoutOptions,
  PageMap,
  ProjectData,
  ProjectMeta,
  Script,
  ScriptStats,
  SnapshotMeta,
} from "./types";

export const api = {
  createProject: (path: string, name: string, template: string) =>
    invoke<ProjectData>("create_project", { path, name, template }),
  openProject: (path: string) => invoke<ProjectData>("open_project", { path }),
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
  exportPdf: (file: string, script: Script, opts: LayoutOptions) =>
    invoke<void>("export_pdf_file", { file, script, opts }),
  exportPdfTemp: (script: Script, opts: LayoutOptions) =>
    invoke<string>("export_pdf_temp", { script, opts }),
  takeSnapshot: (
    path: string,
    script: Script,
    name: string | null,
    automatic: boolean,
  ) => invoke<SnapshotMeta>("take_snapshot", { path, script, name, automatic }),
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
