import { useEffect } from "react";
import { useApp } from "./store";
import { api } from "./api";
import { buildCommands, eventShortcut } from "./appCommands";
import { Editor } from "./editor/Editor";
import { StartScreen } from "./components/StartScreen";
import { SceneNavigator } from "./components/SceneNavigator";
import { IndexCards } from "./components/IndexCards";
import { NotesPanel } from "./components/NotesPanel";
import { StatsPanel } from "./components/StatsPanel";
import { SnapshotsPanel } from "./components/SnapshotsPanel";
import { CommandPalette } from "./components/CommandPalette";
import { FindReplace } from "./components/FindReplace";
import { TitlePageEditor } from "./components/TitlePageEditor";
import { RenameDialog } from "./components/RenameDialog";
import { FormatPanel } from "./components/FormatPanel";
import { Titlebar } from "./components/Titlebar";
import { Toolbar, StatusBar } from "./components/Toolbar";

const AUTOSAVE_MS = 2000;
const AUTO_SNAPSHOT_MS = 10 * 60 * 1000;

export default function App() {
  const view = useApp((s) => s.view);
  const panel = useApp((s) => s.panel);
  const distractionFree = useApp((s) => s.distractionFree);
  const projectPath = useApp((s) => s.projectPath);

  // Global keyboard shortcuts (palette first so Mod-k always works).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The ProseMirror keymap may already have consumed this key.
      if (e.defaultPrevented) return;
      const sc = eventShortcut(e);
      if (sc === "Mod-k") {
        e.preventDefault();
        useApp.getState().setPaletteOpen(!useApp.getState().paletteOpen);
        return;
      }
      if (sc === "Escape" && useApp.getState().distractionFree) {
        useApp.getState().setDistractionFree(false);
        return;
      }
      // Don't fire global commands while typing in inputs/dialogs, except
      // for the modifier-based ones which are unambiguous.
      if (!e.metaKey && !e.ctrlKey) return;
      const cmd = buildCommands().find((c) => c.shortcut === sc);
      if (cmd && (projectPath || !cmd.needsProject)) {
        e.preventDefault();
        void cmd.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectPath]);

  // Autosave loop: debounced continuous save; save on window blur and close.
  useEffect(() => {
    if (!projectPath) return;
    const interval = setInterval(() => {
      const s = useApp.getState();
      if (s.dirty) void s.saveNow();
    }, AUTOSAVE_MS);
    const onBlur = () => {
      const s = useApp.getState();
      if (s.dirty) void s.saveNow();
    };
    const onBeforeUnload = () => {
      const s = useApp.getState();
      if (s.dirty) void s.saveNow();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [projectPath]);

  // Automatic timed snapshots (only when the script actually changed).
  useEffect(() => {
    if (!projectPath) return;
    let lastSnapshotText = "";
    const snap = async () => {
      const s = useApp.getState();
      if (!s.projectPath) return;
      const full = { ...s.script, title_page: s.titlePage };
      const textKey = JSON.stringify(full);
      if (textKey === lastSnapshotText) return;
      lastSnapshotText = textKey;
      try {
        await api.takeSnapshot(s.projectPath, full, null, true);
      } catch {
        // Snapshots must never interrupt writing.
      }
    };
    // Snapshot on open, then periodically.
    const t0 = setTimeout(snap, 3000);
    const interval = setInterval(snap, AUTO_SNAPSHOT_MS);
    return () => {
      clearTimeout(t0);
      clearInterval(interval);
    };
  }, [projectPath]);

  if (view === "start") {
    return (
      <div className="app-shell">
        <Titlebar />
        <div className="app-main" style={{ display: "block", overflow: "hidden" }}>
          <StartScreen />
        </div>
        <CommandPalette />
        <FormatPanel />
      </div>
    );
  }

  return (
    <div className={`app-shell${distractionFree ? " distraction-free" : ""}`}>
      <Titlebar />
      <Toolbar />
      <FindReplace />
      <div className="app-main view-enter">
        {panel === "navigator" && <SceneNavigator />}
        {panel === "notes" && <NotesPanel />}
        {panel === "stats" && <StatsPanel />}
        {panel === "snapshots" && <SnapshotsPanel />}
        <div className="app-content">
          {/* Editor stays mounted in Cards view (hidden) so cards can edit
              synopses/reorder through the same undoable document. */}
          <div style={{ display: view === "cards" ? "none" : "contents" }}>
            <Editor />
          </div>
          {view === "cards" && <IndexCards />}
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      <TitlePageEditor />
      <RenameDialog />
      <FormatPanel />
    </div>
  );
}
