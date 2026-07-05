import { useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { t } from "../i18n";
import { useFocusTrap } from "../ui/useFocusTrap";

/** Shown when verify-on-open fails: pick a recovery point, never open partially. */
export function RecoveryDialog() {
  const recovery = useApp((s) => s.recovery);
  const setRecovery = useApp((s) => s.setRecovery);
  const applyOpenResult = useApp((s) => s.applyOpenResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(recovery !== null, () => setRecovery(null));

  if (!recovery) return null;

  const restore = async (file: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.recoverProject(recovery.path, file);
      await applyOpenResult(result, recovery.path);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div ref={trapRef} className="modal" role="alertdialog" aria-modal="true" aria-label={t("safety.recoveryTitle")}>
        <h2 className="modal-title">{t("safety.recoveryTitle")}</h2>
        <div className="start-error" role="alert">
          {recovery.reason}
        </div>
        <p className="panel-hint" style={{ padding: 0 }}>
          {t("safety.recoveryHint")}
        </p>
        <div className="rename-list" style={{ marginTop: 10 }}>
          {recovery.snapshots.length === 0 && (
            <div className="panel-empty">
              {t("safety.noSnapshots")}
            </div>
          )}
          {recovery.snapshots.map((s) => (
            <div key={s.file} className="snapshot-item">
              <div className="snapshot-main">
                <div className="snapshot-name">
                  {s.name ?? (s.automatic ? t("versions.autoSnapshot") : t("versions.version"))}
                </div>
                <div className="snapshot-time">{s.timestamp}</div>
              </div>
              <button
                className="btn btn-small btn-primary"
                disabled={busy}
                onClick={() => restore(s.file)}
                aria-label={t("safety.restoreSnapshotAria", { time: s.timestamp })}
              >
                {t("versions.restore")}
              </button>
            </div>
          ))}
        </div>
        {error && (
          <div className="start-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={() => setRecovery(null)} disabled={busy}>
            {t("safety.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sync-conflict artifacts found on open: decide per file, nothing is lost. */
export function ConflictDialog() {
  const conflicts = useApp((s) => s.conflicts);
  const projectPath = useApp((s) => s.projectPath);
  const applyOpenResult = useApp((s) => s.applyOpenResult);
  const setConflicts = useApp((s) => s.setConflicts);
  const setStatus = useApp((s) => s.setStatus);
  const [busy, setBusy] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(conflicts.length > 0, () => setConflicts([]));

  if (conflicts.length === 0 || !projectPath) return null;

  const resolve = async (file: string, action: string) => {
    setBusy(true);
    try {
      const result = await api.resolveConflict(projectPath, file, action);
      await applyOpenResult(result, projectPath);
      setStatus(t("safety.conflictResolved"));
    } catch (e) {
      setStatus(t("safety.conflictFailed", { error: String(e) }));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div ref={trapRef} className="modal" role="alertdialog" aria-modal="true" aria-label={t("safety.conflictTitle")}>
        <h2 className="modal-title">{t("safety.conflictTitle")}</h2>
        <p className="panel-hint" style={{ padding: 0 }}>
          {t("safety.conflictHint")}
        </p>
        {conflicts.map((file) => (
          <div key={file} style={{ marginTop: 12 }}>
            <div className="snapshot-time" style={{ marginBottom: 6 }}>
              {file}
            </div>
            <div className="modal-actions" style={{ marginTop: 0 }}>
              <button
                className="btn btn-small"
                disabled={busy}
                onClick={() => resolve(file, "keep_mine")}
              >
                {t("safety.keepMine")}
              </button>
              <button
                className="btn btn-small"
                disabled={busy}
                onClick={() => resolve(file, "take_theirs")}
              >
                {t("safety.openTheirs")}
              </button>
              <button
                className="btn btn-small"
                disabled={busy}
                onClick={() => resolve(file, "snapshot_both")}
              >
                {t("safety.snapshotBoth")}
              </button>
            </div>
          </div>
        ))}
        <div className="modal-actions">
          <button className="btn" onClick={() => setConflicts([])} disabled={busy}>
            {t("safety.decideLater")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Banner shown while another live writer holds the project. */
export function ReadOnlyBanner() {
  const readOnly = useApp((s) => s.readOnly);
  if (!readOnly) return null;
  return (
    <div className="readonly-banner" role="alert">
      <span className="badge warn">{t("safety.readOnlyBadge")}</span>
      {t("safety.readOnlyBanner")}
    </div>
  );
}
