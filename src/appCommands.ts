// Central command registry: drives the command palette, global keyboard
// shortcuts, and toolbar buttons, so every action is discoverable everywhere.

import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { useApp } from "./store";
import { getEditorView, forceRepaginate, replaceEditorScript } from "./editor/editorRef";
import { insertPageBreak, setElementKind, toggleDualDialogue } from "./editor/commands";
import type { ElementKind, SceneNumbering, Script } from "./types";

export interface AppCommand {
  id: string;
  title: string;
  shortcut?: string;
  /** Only shown/enabled when a project is open. */
  needsProject?: boolean;
  run: () => void | Promise<void>;
}

function fullScript(): Script {
  const s = useApp.getState();
  return { ...s.script, title_page: s.titlePage };
}

function runEditorCommand(cmd: (state: never, dispatch: never) => boolean) {
  const view = getEditorView();
  if (!view) return;
  (cmd as (s: unknown, d: unknown) => boolean)(view.state, view.dispatch.bind(view));
  view.focus();
}

async function exportAs(kind: "pdf" | "fdx" | "fountain") {
  const s = useApp.getState();
  if (!s.projectPath) return;
  const name = s.projectMeta?.name ?? "script";
  const filters = {
    pdf: [{ name: "PDF", extensions: ["pdf"] }],
    fdx: [{ name: "Final Draft", extensions: ["fdx"] }],
    fountain: [{ name: "Fountain", extensions: ["fountain"] }],
  }[kind];
  const file = await save({ defaultPath: `${name}.${kind}`, filters });
  if (!file) return;
  try {
    if (kind === "pdf") await api.exportPdf(file, fullScript(), s.layoutOptions());
    else if (kind === "fdx") await api.exportFdx(file, fullScript());
    else await api.exportFountain(file, fullScript());
    s.setStatus(`Exported ${file.split(/[\\/]/).pop()}`);
  } catch (e) {
    s.setStatus(`Export failed: ${e}`);
  }
}

export function buildCommands(): AppCommand[] {
  const app = () => useApp.getState();
  const kindCmd = (kind: ElementKind, n: number): AppCommand => ({
    id: `element.${kind}`,
    title: `Element: ${kind.replace("_", " ")}`,
    shortcut: `Mod-${n}`,
    needsProject: true,
    run: () => runEditorCommand(setElementKind(kind) as never),
  });
  const numberingCmd = (n: SceneNumbering): AppCommand => ({
    id: `numbering.${n}`,
    title: `Scene numbers: ${n}`,
    needsProject: true,
    run: () => {
      app().setSceneNumbering(n);
      forceRepaginate();
    },
  });

  return [
    {
      id: "file.save",
      title: "Save",
      shortcut: "Mod-s",
      needsProject: true,
      run: async () => {
        await app().saveNow();
        app().setStatus("Saved");
      },
    },
    {
      id: "file.saveVersion",
      title: "Save Version…",
      shortcut: "Mod-Shift-s",
      needsProject: true,
      run: () => {
        if (app().panel !== "snapshots") app().togglePanel("snapshots");
        window.dispatchEvent(new CustomEvent("openscene:focus-version-name"));
      },
    },
    {
      id: "file.exportPdf",
      title: "Export PDF…",
      shortcut: "Mod-Shift-e",
      needsProject: true,
      run: () => exportAs("pdf"),
    },
    { id: "file.exportFdx", title: "Export Final Draft (FDX)…", needsProject: true, run: () => exportAs("fdx") },
    { id: "file.exportFountain", title: "Export Fountain…", needsProject: true, run: () => exportAs("fountain") },
    {
      id: "file.print",
      title: "Print (opens PDF in system viewer)",
      shortcut: "Mod-p",
      needsProject: true,
      run: async () => {
        const s = app();
        try {
          const path = await api.exportPdfTemp(fullScript(), s.layoutOptions());
          await openPath(path);
        } catch (e) {
          s.setStatus(`Print failed: ${e}`);
        }
      },
    },
    {
      id: "file.import",
      title: "Import Fountain / FDX into current script…",
      needsProject: true,
      run: async () => {
        const file = await open({
          multiple: false,
          filters: [{ name: "Scripts", extensions: ["fountain", "fdx", "txt"] }],
        });
        if (typeof file !== "string") return;
        const s = app();
        try {
          // Safety: snapshot before an import overwrites the document.
          if (s.projectPath) await api.takeSnapshot(s.projectPath, fullScript(), "before import", false);
          const script = await api.importScript(file);
          replaceEditorScript(script);
          if (script.title_page.length) s.setTitlePage(script.title_page);
          s.setStatus(`Imported ${file.split(/[\\/]/).pop()}`);
        } catch (e) {
          s.setStatus(`Import failed: ${e}`);
        }
      },
    },
    {
      id: "file.close",
      title: "Close project",
      shortcut: "Mod-w",
      needsProject: true,
      run: () => app().closeProject(),
    },
    {
      id: "edit.find",
      title: "Find and Replace",
      shortcut: "Mod-f",
      needsProject: true,
      run: () => app().setFindOpen(true),
    },
    {
      id: "edit.rename",
      title: "Rename character everywhere…",
      needsProject: true,
      run: () => app().setRenameOpen(true),
    },
    {
      id: "edit.dual",
      title: "Toggle dual dialogue",
      shortcut: "Mod-Alt-d",
      needsProject: true,
      run: () => runEditorCommand(toggleDualDialogue as never),
    },
    {
      id: "edit.pageBreak",
      title: "Insert forced page break",
      shortcut: "Mod-Enter",
      needsProject: true,
      run: () => runEditorCommand(insertPageBreak as never),
    },
    {
      id: "edit.addNote",
      title: "Add script note at cursor…",
      needsProject: true,
      run: () => {
        if (app().panel !== "notes") app().togglePanel("notes");
        window.dispatchEvent(new CustomEvent("openscene:focus-note-input"));
      },
    },
    kindCmd("scene_heading", 1),
    kindCmd("action", 2),
    kindCmd("character", 3),
    kindCmd("parenthetical", 4),
    kindCmd("dialogue", 5),
    kindCmd("transition", 6),
    kindCmd("shot", 7),
    {
      id: "view.write",
      title: "View: Script",
      needsProject: true,
      run: () => app().setView("write"),
    },
    {
      id: "view.cards",
      title: "View: Index cards",
      needsProject: true,
      run: () => app().setView("cards"),
    },
    {
      id: "view.navigator",
      title: "Toggle scene navigator",
      shortcut: "Mod-Shift-1",
      needsProject: true,
      run: () => app().togglePanel("navigator"),
    },
    {
      id: "view.notes",
      title: "Toggle notes panel",
      shortcut: "Mod-Shift-2",
      needsProject: true,
      run: () => app().togglePanel("notes"),
    },
    {
      id: "view.stats",
      title: "Toggle statistics panel",
      shortcut: "Mod-Shift-3",
      needsProject: true,
      run: () => app().togglePanel("stats"),
    },
    {
      id: "view.snapshots",
      title: "Toggle version history",
      shortcut: "Mod-Shift-4",
      needsProject: true,
      run: () => app().togglePanel("snapshots"),
    },
    {
      id: "view.titlePage",
      title: "Edit title page…",
      needsProject: true,
      run: () => app().setTitlePageOpen(true),
    },
    {
      id: "view.distractionFree",
      title: "Toggle distraction-free mode",
      shortcut: "Mod-Shift-f",
      run: () => app().setDistractionFree(!app().distractionFree),
    },
    {
      id: "view.typewriter",
      title: "Toggle typewriter scrolling",
      run: () => app().setTypewriter(!app().typewriter),
    },
    {
      id: "view.lineFocus",
      title: "Toggle line focus dimming",
      run: () => app().setLineFocus(!app().lineFocus),
    },
    {
      id: "view.format",
      title: "Format & Appearance…",
      shortcut: "Mod-,",
      run: () => app().setFormatOpen(true),
    },
    { id: "theme.system", title: "Theme: Follow system", run: () => app().setThemePref("system") },
    { id: "theme.light", title: "Theme: Light", run: () => app().setThemePref("light") },
    { id: "theme.dark", title: "Theme: Dark", run: () => app().setThemePref("dark") },
    { id: "theme.midnight", title: "Theme: Midnight", run: () => app().setThemePref("midnight") },
    numberingCmd("none"),
    numberingCmd("left"),
    numberingCmd("right"),
    numberingCmd("both"),
    {
      id: "backup.now",
      title: "Back up project now…",
      needsProject: true,
      run: async () => {
        const s = app();
        if (!s.projectPath) return;
        let dir = s.projectMeta?.backup_dir ?? null;
        if (!dir) {
          const picked = await open({ directory: true, title: "Choose backup folder" });
          if (typeof picked !== "string") return;
          dir = picked;
          await s.setBackupDir(dir);
        }
        try {
          await s.saveNow();
          const name = await api.createBackup(s.projectPath, dir);
          s.setStatus(`Backed up: ${name}`);
        } catch (e) {
          s.setStatus(`Backup failed: ${e}`);
        }
      },
    },
    {
      id: "backup.chooseDir",
      title: "Choose backup folder…",
      needsProject: true,
      run: async () => {
        const picked = await open({ directory: true, title: "Choose backup folder" });
        if (typeof picked === "string") await app().setBackupDir(picked);
      },
    },
  ];
}

/** Normalize a KeyboardEvent to our "Mod-Shift-x" shortcut syntax. */
export function eventShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key;
  // Shift+digit produces symbols ("!", "@"); recover the digit from e.code.
  if (e.code.startsWith("Digit")) key = e.code.slice(5);
  else if (key !== "Enter" && key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join("-");
}

export function shortcutLabel(sc: string): string {
  const mac = navigator.platform.toUpperCase().includes("MAC");
  return sc
    .replace("Mod", mac ? "⌘" : "Ctrl")
    .replace("Alt", mac ? "⌥" : "Alt")
    .replace("Shift", mac ? "⇧" : "Shift")
    .split("-")
    .join(mac ? "" : "+");
}
