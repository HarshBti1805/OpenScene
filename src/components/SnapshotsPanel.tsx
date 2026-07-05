import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useApp } from "../store";
import { replaceEditorScript } from "../editor/editorRef";
import type { SnapshotMeta } from "../types";
import { t } from "../i18n";

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

  const stem = useApp((s) => s.snapshotStem());

  const refresh = useCallback(() => {
    if (!projectPath) return;
    api
      .listSnapshots(projectPath)
      // Only versions of the document currently open in the editor.
      .then((all) => setSnapshots(all.filter((s) => s.file.startsWith(`${stem}-`))))
      .catch(() => {});
    const dir = projectMeta?.backup_dir;
    if (dir && projectMeta) {
      api.listBackups(dir, projectMeta.name).then(setBackups).catch(() => {});
    }
  }, [projectPath, projectMeta, stem]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const focus = () => nameRef.current?.focus();
    window.addEventListener("openscene:focus-version-name", focus);
    return () => window.removeEventListener("openscene:focus-version-name", focus);
  }, []);

  const saveVersion = async () => {
    if (!projectPath) return;
    await api.takeSnapshot(
      projectPath,
      { ...script, title_page: titlePage },
      versionName.trim() || null,
      false,
      stem,
    );
    setVersionName("");
    setStatus(t("versions.saved"));
    refresh();
  };

  const restore = async (snap: SnapshotMeta) => {
    if (!projectPath) return;
    // Snapshot + zipped backup first, so restore itself is reversible.
    await api.takeSnapshot(projectPath, { ...script, title_page: titlePage }, "before restore", false, stem);
    await useApp.getState().milestoneBackup("restore");
    const restored = await api.readSnapshot(projectPath, snap.file);
    replaceEditorScript(restored);
    if (restored.title_page.length) useApp.getState().setTitlePage(restored.title_page);
    setStatus(t("versions.restored", { name: snap.name ?? snap.timestamp }));
    refresh();
  };

  return (
    <div className="panel" role="complementary" aria-label={t("panel.versions")}>
      <div className="panel-header">{t("panel.versions")}</div>
      <div className="note-add">
        <input
          ref={nameRef}
          className="input"
          value={versionName}
          placeholder={t("versions.namePlaceholder")}
          aria-label={t("versions.nameAria")}
          onChange={(e) => setVersionName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveVersion()}
        />
        <button className="btn btn-primary" onClick={saveVersion}>
          {t("versions.save")}
        </button>
      </div>
      <div className="panel-body">
        {snapshots.length === 0 && <div className="panel-empty">{t("panel.emptyVersions")}</div>}
        {snapshots.map((snap) => (
          <div key={snap.file} className="snapshot-item">
            <div className="snapshot-main">
              <div className="snapshot-name">{snap.name ?? (snap.automatic ? t("versions.autoSnapshot") : t("versions.version"))}</div>
              <div className="snapshot-time">{snap.timestamp}</div>
            </div>
            <button className="btn btn-small" onClick={() => restore(snap)} aria-label={t("versions.restoreAria", { name: snap.name ?? snap.timestamp })}>
              {t("versions.restore")}
            </button>
          </div>
        ))}
        {projectMeta?.backup_dir && (
          <>
            <h3 className="stats-subhead">{t("versions.backupsIn", { dir: projectMeta.backup_dir })}</h3>
            {backups.length === 0 && <div className="panel-empty">{t("versions.noBackups")}</div>}
            {backups.map((b) => (
              <div key={b} className="snapshot-item">
                <div className="snapshot-main">
                  <div className="snapshot-time">{b}</div>
                </div>
                <button
                  className="btn btn-small"
                  aria-label={t("versions.restoreBackupAria", { name: b })}
                  onClick={async () => {
                    const dir = projectMeta.backup_dir;
                    if (!dir) return;
                    const parent = await open({
                      directory: true,
                      title: t("versions.chooseRestoreFolder"),
                    });
                    if (typeof parent !== "string") return;
                    const target = `${parent}/${b.replace(/\.openscene\.zip$/, "")}`;
                    try {
                      await api.restoreBackup(`${dir}/${b}`, target);
                      await useApp.getState().loadProject(target);
                      setStatus(t("versions.backupRestored", { path: target }));
                    } catch (e) {
                      setStatus(t("versions.restoreFailed", { error: String(e) }));
                    }
                  }}
                >
                  {t("versions.restore")}
                </button>
              </div>
            ))}
            <div className="panel-hint">{t("versions.backupsHint")}</div>
          </>
        )}
      </div>
    </div>
  );
}
