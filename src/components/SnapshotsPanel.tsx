import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useApp } from "../store";
import { replaceEditorScript } from "../editor/editorRef";
import type { SnapshotMeta } from "../types";

export function SnapshotsPanel() {
  const projectPath = useApp((s) => s.projectPath);
  const projectMeta = useApp((s) => s.projectMeta);
  const script = useApp((s) => s.script);
  const titlePage = useApp((s) => s.titlePage);
  const setStatus = useApp((s) => s.setStatus);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [backups, setBackups] = useState<string[]>([]);
  const [versionName, setVersionName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    if (!projectPath) return;
    api.listSnapshots(projectPath).then(setSnapshots).catch(() => {});
    const dir = projectMeta?.backup_dir;
    if (dir && projectMeta) {
      api.listBackups(dir, projectMeta.name).then(setBackups).catch(() => {});
    }
  }, [projectPath, projectMeta]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const focus = () => nameRef.current?.focus();
    window.addEventListener("openscene:focus-version-name", focus);
    return () => window.removeEventListener("openscene:focus-version-name", focus);
  }, []);

  const saveVersion = async () => {
    if (!projectPath) return;
    await api.takeSnapshot(projectPath, { ...script, title_page: titlePage }, versionName.trim() || null, false);
    setVersionName("");
    setStatus("Version saved");
    refresh();
  };

  const restore = async (snap: SnapshotMeta) => {
    if (!projectPath) return;
    // Snapshot the current state first, so restore itself is reversible.
    await api.takeSnapshot(projectPath, { ...script, title_page: titlePage }, "before restore", false);
    const restored = await api.readSnapshot(projectPath, snap.file);
    replaceEditorScript(restored);
    if (restored.title_page.length) useApp.getState().setTitlePage(restored.title_page);
    setStatus(`Restored ${snap.name ?? snap.timestamp}`);
    refresh();
  };

  return (
    <div className="panel" role="complementary" aria-label="Version history">
      <div className="panel-header">Versions</div>
      <div className="note-add">
        <input
          ref={nameRef}
          className="input"
          value={versionName}
          placeholder='Version name, e.g. "Draft 2"'
          aria-label="Version name"
          onChange={(e) => setVersionName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveVersion()}
        />
        <button className="btn btn-primary" onClick={saveVersion}>
          Save Version
        </button>
      </div>
      <div className="panel-body">
        {snapshots.length === 0 && <div className="panel-empty">No versions yet.</div>}
        {snapshots.map((snap) => (
          <div key={snap.file} className="snapshot-item">
            <div className="snapshot-main">
              <div className="snapshot-name">{snap.name ?? (snap.automatic ? "Auto snapshot" : "Version")}</div>
              <div className="snapshot-time">{snap.timestamp}</div>
            </div>
            <button className="btn btn-small" onClick={() => restore(snap)} aria-label={`Restore ${snap.name ?? snap.timestamp}`}>
              Restore
            </button>
          </div>
        ))}
        {projectMeta?.backup_dir && (
          <>
            <h3 className="stats-subhead">Backups in {projectMeta.backup_dir}</h3>
            {backups.length === 0 && <div className="panel-empty">No backups yet. Run "Back up project now".</div>}
            {backups.map((b) => (
              <div key={b} className="snapshot-item">
                <div className="snapshot-main">
                  <div className="snapshot-time">{b}</div>
                </div>
                <button
                  className="btn btn-small"
                  aria-label={`Restore backup ${b}`}
                  onClick={async () => {
                    const dir = projectMeta.backup_dir;
                    if (!dir) return;
                    const parent = await open({
                      directory: true,
                      title: "Choose an empty folder to restore the backup into",
                    });
                    if (typeof parent !== "string") return;
                    const target = `${parent}/${b.replace(/\.openscene\.zip$/, "")}`;
                    try {
                      await api.restoreBackup(`${dir}/${b}`, target);
                      await useApp.getState().loadProject(target);
                      setStatus(`Backup restored to ${target}`);
                    } catch (e) {
                      setStatus(`Restore failed: ${e}`);
                    }
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
            <div className="panel-hint">Backups are plain zip files of the whole project folder.</div>
          </>
        )}
      </div>
    </div>
  );
}
