import { useApp, useScenes } from "../store";
import { t } from "../i18n";

export function Toolbar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const panel = useApp((s) => s.panel);
  const togglePanel = useApp((s) => s.togglePanel);
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const setFormatOpen = useApp((s) => s.setFormatOpen);
  const closeProject = useApp((s) => s.closeProject);

  return (
    <div className="toolbar" role="toolbar" aria-label={t("toolbar.script")}>
      <button
        className="btn btn-small btn-ghost"
        onClick={() => closeProject()}
        aria-label={t("toolbar.backToProjects")}
        data-tip={t("toolbar.backToProjects")}
      >
        {t("toolbar.lot")}
      </button>
      <div className="toolbar-group" role="group" aria-label={t("toolbar.script")}>
        <button
          className={`btn btn-small${view === "write" ? " active" : ""}`}
          onClick={() => setView("write")}
          aria-pressed={view === "write"}
        >
          {t("toolbar.script")}
        </button>
        <button
          className={`btn btn-small${view === "cards" ? " active" : ""}`}
          onClick={() => setView("cards")}
          aria-pressed={view === "cards"}
        >
          {t("toolbar.cards")}
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group" role="group" aria-label={t("panel.documents")}>
        {(
          [
            ["navigator", t("toolbar.scenes")],
            ["notes", t("toolbar.notes")],
            ["stats", t("toolbar.stats")],
            ["snapshots", t("toolbar.versions")],
            ["revisions", t("panel.revisions")],
          ] as const
        ).map(([p, label]) => (
          <button
            key={p}
            className={`btn btn-small${panel === p ? " active" : ""}`}
            onClick={() => togglePanel(p)}
            aria-pressed={panel === p}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        className="btn btn-small"
        onClick={() => setFormatOpen(true)}
        aria-label={t("toolbar.formatSettings")}
        data-tip={t("toolbar.formatSettings")}
      >
        Aa
      </button>
      <button
        className="btn btn-small"
        onClick={() => setPaletteOpen(true)}
        aria-label={t("toolbar.palette")}
        data-tip={t("toolbar.palette")}
      >
        ⌘K
      </button>
    </div>
  );
}

export function StatusBar() {
  const pageMap = useApp((s) => s.pageMap);
  const scenes = useScenes();
  const dirty = useApp((s) => s.dirty);
  const lastSaved = useApp((s) => s.lastSaved);
  const statusMessage = useApp((s) => s.statusMessage);
  const typewriter = useApp((s) => s.typewriter);
  const lineFocus = useApp((s) => s.lineFocus);
  const locked = useApp((s) => s.projectMeta?.locked ?? null);

  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span>{pageMap ? t("status.pages", { n: pageMap.page_count }) : "· · ·"}</span>
      <span>{t("status.scenes", { n: scenes.length })}</span>
      {locked && <span className="status-locked">{t("status.locked")}</span>}
      {typewriter && <span>{t("status.typewriter")}</span>}
      {lineFocus && <span>{t("status.focus")}</span>}
      <span className="toolbar-spacer" />
      {statusMessage && <span className="status-msg">{statusMessage}</span>}
      <span>{dirty ? t("status.unsaved") : lastSaved ? t("status.savedAt", { time: lastSaved }) : t("status.saved")}</span>
    </div>
  );
}
