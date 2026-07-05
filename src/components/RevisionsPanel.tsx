import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { forceRepaginate, getEditorView, replaceEditorScript } from "../editor/editorRef";
import {
  REVISION_COLORS,
  REVISION_SWATCHES,
  type RevisionSet,
  type Script,
  type ScriptElement,
  type SnapshotMeta,
} from "../types";
import { t } from "../i18n";
import { useFocusTrap } from "../ui/useFocusTrap";

export function RevisionsPanel() {
  const projectPath = useApp((s) => s.projectPath);
  const projectMeta = useApp((s) => s.projectMeta);
  const showMarks = useApp((s) => s.showRevisionMarks);
  const setShowMarks = useApp((s) => s.setShowRevisionMarks);
  const setStatus = useApp((s) => s.setStatus);
  const [label, setLabel] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [lockConfirm, setLockConfirm] = useState<null | "lock" | "unlock">(null);
  const lockTrapRef = useFocusTrap<HTMLDivElement>(lockConfirm !== null, () => setLockConfirm(null));

  if (!projectPath || !projectMeta) return null;
  const revisions = projectMeta.revisions ?? [];
  const active = projectMeta.active_revision ?? null;
  const locked = projectMeta.locked ?? null;

  const saveMeta = async (meta: typeof projectMeta) => {
    useApp.setState({ projectMeta: meta });
    await api.saveProjectMeta(projectPath, meta).catch(() => {});
  };

  const doLock = async () => {
    const st = useApp.getState();
    await st.milestoneBackup("lock pages");
    const full = { ...st.script, title_page: st.titlePage };
    const result = await api.lockPages(full, st.layoutOptions());
    // Materialized scene numbers go back into the document.
    replaceEditorScript(result.script);
    await saveMeta({ ...projectMeta, locked: result.locked });
    forceRepaginate();
    setStatus(t("lock.lockedStatus", { date: result.locked.date ?? "" }));
    setLockConfirm(null);
  };

  const doUnlock = async () => {
    const st = useApp.getState();
    await st.milestoneBackup("unlock pages");
    await saveMeta({ ...projectMeta, locked: null });
    forceRepaginate();
    setStatus(t("lock.unlockedStatus"));
    setLockConfirm(null);
  };

  const startSet = async () => {
    const color = REVISION_COLORS[Math.min(revisions.length, REVISION_COLORS.length - 1)];
    const set: RevisionSet = {
      id: `rev-${Date.now()}`,
      color,
      label: label.trim() || `${color} Draft`,
      date: new Date().toISOString().slice(0, 10),
    };
    await saveMeta({
      ...projectMeta,
      revisions: [...revisions, set],
      active_revision: set.id,
    });
    setLabel("");
  };

  const activate = (id: string | null) => {
    void saveMeta({ ...projectMeta, active_revision: id });
  };

  const clearMarks = async (set: RevisionSet) => {
    const view = getEditorView();
    if (!view) return;
    await useApp.getState().milestoneBackup("clear revision marks");
    let tr = view.state.tr;
    let changed = false;
    view.state.doc.forEach((node, pos) => {
      if (node.type.isTextblock && node.attrs.revision === set.id) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, revision: null });
        changed = true;
      }
    });
    if (changed) view.dispatch(tr);
    setStatus(t("rev.marksCleared", { name: set.label }));
  };

  return (
    <div className="panel" role="complementary" aria-label={t("rev.panel")}>
      <div className="panel-header">{t("rev.panel")}</div>
      <div className="note-add">
        <input
          className="input"
          value={label}
          placeholder={t("rev.newSetPlaceholder")}
          aria-label={t("rev.newSetAria")}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && startSet()}
        />
        <div className="note-add-row">
          <button className="btn btn-primary" onClick={startSet}>
            {t("rev.start")}
          </button>
          <button className="btn" onClick={() => setCompareOpen(true)}>
            {t("rev.compare")}
          </button>
        </div>
        <label className="find-toggle" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={showMarks}
            onChange={(e) => setShowMarks(e.target.checked)}
          />
          {t("rev.showMarks")}
        </label>
        <div className="lock-row">
          {locked ? (
            <>
              <span className="badge">{t("lock.badge", { date: locked.date ?? "" })}</span>
              <button className="btn btn-small" onClick={() => setLockConfirm("unlock")}>
                {t("lock.unlock")}
              </button>
            </>
          ) : (
            <button className="btn btn-small" onClick={() => setLockConfirm("lock")}>
              {t("lock.lock")}
            </button>
          )}
        </div>
      </div>
      {lockConfirm && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLockConfirm(null)}>
          <div
            ref={lockTrapRef}
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label={lockConfirm === "lock" ? t("lock.confirmLockTitle") : t("lock.confirmUnlockTitle")}
          >
            <h2 className="modal-title">
              {lockConfirm === "lock" ? t("lock.confirmLockTitle") : t("lock.confirmUnlockTitle")}
            </h2>
            <p className="panel-hint" style={{ padding: 0 }}>
              {lockConfirm === "lock" ? t("lock.confirmLockBody") : t("lock.confirmUnlockBody")}
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => void (lockConfirm === "lock" ? doLock() : doUnlock())}
              >
                {lockConfirm === "lock" ? t("lock.lock") : t("lock.unlock")}
              </button>
              <button className="btn" onClick={() => setLockConfirm(null)}>
                {t("safety.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="panel-body">
        {revisions.length === 0 && <div className="panel-empty">{t("rev.noSets")}</div>}
        {revisions.map((set) => {
          const isActive = set.id === active;
          return (
            <div key={set.id} className={`rev-set${isActive ? " active" : ""}`}>
              <span
                className="rev-swatch"
                style={{ background: REVISION_SWATCHES[set.color] ?? "var(--os-line-strong)" }}
                aria-hidden="true"
              />
              <div className="rev-main">
                <div className="rev-label">{set.label}</div>
                <div className="rev-meta">
                  <span className="edgecode">{set.color}</span> · {set.date}
                </div>
              </div>
              {isActive ? (
                <button className="btn btn-small active" onClick={() => activate(null)}>
                  {t("rev.deactivate")}
                </button>
              ) : (
                <button className="btn btn-small" onClick={() => activate(set.id)}>
                  {t("rev.activate")}
                </button>
              )}
              <button
                className="btn btn-small btn-ghost"
                onClick={() => void clearMarks(set)}
                aria-label={t("rev.clearMarksAria", { name: set.label })}
              >
                {t("rev.clearMarks")}
              </button>
            </div>
          );
        })}
      </div>
      {compareOpen && <CompareDrafts onClose={() => setCompareOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft comparison v0: scene-level diff between two versions (read-only).
// ---------------------------------------------------------------------------

interface SceneBlock {
  heading: string;
  lines: string[];
}

function scenesOf(script: Script): SceneBlock[] {
  const out: SceneBlock[] = [];
  let cur: SceneBlock | null = null;
  const push = () => {
    if (cur) out.push(cur);
  };
  const lineOf = (e: ScriptElement) => `${e.kind}: ${e.text}`;
  for (const e of script.elements) {
    if (e.kind === "scene_heading") {
      push();
      cur = { heading: e.text, lines: [] };
    } else if (cur) {
      cur.lines.push(lineOf(e));
    } else {
      cur = { heading: "", lines: [lineOf(e)] };
    }
  }
  push();
  return out;
}

type SceneDiff =
  | { kind: "added"; heading: string }
  | { kind: "removed"; heading: string }
  | { kind: "unchanged"; heading: string }
  | { kind: "changed"; heading: string; added: string[]; removed: string[] };

function diffScenes(a: Script, b: Script): SceneDiff[] {
  const as = scenesOf(a);
  const bs = scenesOf(b);
  const aByHeading = new Map(as.map((s) => [s.heading, s]));
  const bHeadings = new Set(bs.map((s) => s.heading));
  const out: SceneDiff[] = [];
  for (const sb of bs) {
    const sa = aByHeading.get(sb.heading);
    if (!sa) {
      out.push({ kind: "added", heading: sb.heading });
      continue;
    }
    const aSet = new Set(sa.lines);
    const bSet = new Set(sb.lines);
    const added = sb.lines.filter((l) => !aSet.has(l));
    const removed = sa.lines.filter((l) => !bSet.has(l));
    if (added.length === 0 && removed.length === 0) {
      out.push({ kind: "unchanged", heading: sb.heading });
    } else {
      out.push({ kind: "changed", heading: sb.heading, added, removed });
    }
  }
  for (const sa of as) {
    if (!bHeadings.has(sa.heading)) {
      out.push({ kind: "removed", heading: sa.heading });
    }
  }
  return out;
}

function CompareDrafts({ onClose }: { onClose: () => void }) {
  const projectPath = useApp((s) => s.projectPath);
  const script = useApp((s) => s.script);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("current");
  const [aScript, setAScript] = useState<Script | null>(null);
  const [bScript, setBScript] = useState<Script | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);

  useEffect(() => {
    if (!projectPath) return;
    api
      .listSnapshots(projectPath)
      .then((all) => {
        const scripts = all.filter((s) => s.file.startsWith("script-"));
        setSnapshots(scripts);
        if (scripts.length > 0) setAId(scripts[0].file);
      })
      .catch(() => {});
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    const load = async (id: string, set: (s: Script | null) => void) => {
      if (id === "current") {
        set(script);
      } else if (id) {
        set(await api.readSnapshot(projectPath, id).catch(() => null));
      } else {
        set(null);
      }
    };
    void load(aId, setAScript);
    void load(bId, setBScript);
  }, [aId, bId, projectPath, script]);

  const diffs = useMemo(
    () => (aScript && bScript ? diffScenes(aScript, bScript) : []),
    [aScript, bScript],
  );

  const label = (s: SnapshotMeta) => `${s.name ?? (s.automatic ? t("versions.autoSnapshot") : t("versions.version"))} · ${s.timestamp}`;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={trapRef}
        className="modal"
        style={{ width: 760 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("rev.compareTitle")}
      >
        <h2 className="modal-title">{t("rev.compareTitle")}</h2>
        <div className="compare-selects">
          <div style={{ flex: 1 }}>
            <label className="field-label">{t("rev.compareA")}</label>
            <select className="input" value={aId} onChange={(e) => setAId(e.target.value)} aria-label={t("rev.compareA")}>
              {snapshots.map((s) => (
                <option key={s.file} value={s.file}>
                  {label(s)}
                </option>
              ))}
              <option value="current">{t("rev.current")}</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">{t("rev.compareB")}</label>
            <select className="input" value={bId} onChange={(e) => setBId(e.target.value)} aria-label={t("rev.compareB")}>
              <option value="current">{t("rev.current")}</option>
              {snapshots.map((s) => (
                <option key={s.file} value={s.file}>
                  {label(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="compare-results">
          {diffs.length === 0 && <div className="panel-empty">{t("rev.noChanges")}</div>}
          {diffs.every((d) => d.kind === "unchanged") && diffs.length > 0 && (
            <div className="panel-empty">{t("rev.noChanges")}</div>
          )}
          {diffs
            .filter((d) => d.kind !== "unchanged")
            .map((d, i) => (
              <div key={i} className={`compare-scene compare-${d.kind}`}>
                <div className="compare-scene-head">
                  <span className={`badge${d.kind === "removed" ? " warn" : ""}`}>
                    {d.kind === "added"
                      ? t("rev.sceneAdded")
                      : d.kind === "removed"
                        ? t("rev.sceneRemoved")
                        : t("rev.sceneChanged")}
                  </span>
                  <span className="compare-heading">{d.heading || "—"}</span>
                </div>
                {d.kind === "changed" && (
                  <div className="compare-lines">
                    {d.removed.map((l, j) => (
                      <div key={`r${j}`} className="compare-line removed">
                        − {l}
                      </div>
                    ))}
                    {d.added.map((l, j) => (
                      <div key={`a${j}`} className="compare-line added">
                        + {l}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t("rev.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
