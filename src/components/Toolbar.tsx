import { useApp, useScenes } from "../store";

export function Toolbar() {
  const meta = useApp((s) => s.projectMeta);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const panel = useApp((s) => s.panel);
  const togglePanel = useApp((s) => s.togglePanel);
  const setPaletteOpen = useApp((s) => s.setPaletteOpen);
  const closeProject = useApp((s) => s.closeProject);

  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      <button className="btn btn-small" onClick={() => closeProject()} aria-label="Close project, back to start">
        ‹ Projects
      </button>
      <span className="toolbar-title">{meta?.name}</span>
      <div className="toolbar-group" role="group" aria-label="View switcher">
        <button
          className={`btn btn-small${view === "write" ? " active" : ""}`}
          onClick={() => setView("write")}
          aria-pressed={view === "write"}
        >
          Script
        </button>
        <button
          className={`btn btn-small${view === "cards" ? " active" : ""}`}
          onClick={() => setView("cards")}
          aria-pressed={view === "cards"}
        >
          Cards
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group" role="group" aria-label="Panels">
        {(
          [
            ["navigator", "Scenes"],
            ["notes", "Notes"],
            ["stats", "Stats"],
            ["snapshots", "Versions"],
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
      <button className="btn btn-small" onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
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

  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span>{pageMap ? `${pageMap.page_count} page${pageMap.page_count === 1 ? "" : "s"}` : "…"}</span>
      <span>
        {scenes.length} scene{scenes.length === 1 ? "" : "s"}
      </span>
      {typewriter && <span>typewriter</span>}
      <span className="toolbar-spacer" />
      {statusMessage && <span className="status-msg">{statusMessage}</span>}
      <span>{dirty ? "Unsaved changes…" : lastSaved ? `Saved ${lastSaved}` : "Saved"}</span>
    </div>
  );
}
