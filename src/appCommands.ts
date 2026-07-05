// Central command registry: drives the command palette, global keyboard
// shortcuts, and toolbar buttons, so every action is discoverable everywhere.

import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { ACCENTS, THEMES, useApp } from "./store";
import { t } from "./i18n";
import { getEditorView, forceRepaginate, replaceEditorScript } from "./editor/editorRef";
import { insertPageBreak, setElementKind, toggleDualDialogue } from "./editor/commands";
import { addAlternate, cycleAlternate } from "./editor/editorRef";
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
    if (kind === "pdf") await api.exportPdf(file, fullScript(), s.layoutOptions(), s.projectPath);
    else if (kind === "fdx") await api.exportFdx(file, fullScript());
    else await api.exportFountain(file, fullScript());
    s.setStatus(t("cmd.exported", { name: file.split(/[\\/]/).pop() ?? "" }));
  } catch (e) {
    s.setStatus(t("cmd.exportFailed", { error: String(e) }));
  }
}

export function buildCommands(): AppCommand[] {
  const app = () => useApp.getState();
  const kindCmd = (kind: ElementKind, n: number): AppCommand => ({
    id: `element.${kind}`,
    title: t("cmd.element", { kind: kind.replace("_", " ") }),
    shortcut: `Mod-${n}`,
    needsProject: true,
    run: () => runEditorCommand(setElementKind(kind) as never),
  });
  const numberingCmd = (n: SceneNumbering): AppCommand => ({
    id: `numbering.${n}`,
    title: t("cmd.numbering", { mode: n }),
    needsProject: true,
    run: () => {
      app().setSceneNumbering(n);
      forceRepaginate();
    },
  });

  return [
    {
      id: "file.save",
      title: t("cmd.save"),
      shortcut: "Mod-s",
      needsProject: true,
      run: async () => {
        await app().saveNow();
        app().setStatus(t("cmd.savedStatus"));
      },
    },
    {
      id: "file.saveVersion",
      title: t("cmd.saveVersion"),
      shortcut: "Mod-Shift-s",
      needsProject: true,
      run: () => {
        if (app().panel !== "snapshots") app().togglePanel("snapshots");
        window.dispatchEvent(new CustomEvent("openscene:focus-version-name"));
      },
    },
    {
      id: "file.exportPdf",
      title: t("cmd.exportPdf"),
      shortcut: "Mod-Shift-e",
      needsProject: true,
      run: () => exportAs("pdf"),
    },
    { id: "file.exportFdx", title: t("cmd.exportFdx"), needsProject: true, run: () => exportAs("fdx") },
    { id: "file.exportFountain", title: t("cmd.exportFountain"), needsProject: true, run: () => exportAs("fountain") },
    {
      id: "file.print",
      title: t("cmd.print"),
      shortcut: "Mod-p",
      needsProject: true,
      run: async () => {
        const s = app();
        try {
          const path = await api.exportPdfTemp(fullScript(), s.layoutOptions(), s.projectPath);
          await openPath(path);
        } catch (e) {
          s.setStatus(t("cmd.printFailed", { error: String(e) }));
        }
      },
    },
    {
      id: "file.import",
      title: t("cmd.import"),
      needsProject: true,
      run: async () => {
        const file = await open({
          multiple: false,
          filters: [{ name: "Scripts", extensions: ["fountain", "fdx", "txt"] }],
        });
        if (typeof file !== "string") return;
        const s = app();
        try {
          // Safety: snapshot + zipped backup before an import overwrites.
          if (s.projectPath) await api.takeSnapshot(s.projectPath, fullScript(), "before import", false);
          await s.milestoneBackup("import");
          const script = await api.importScript(file);
          replaceEditorScript(script);
          if (script.title_page.length) s.setTitlePage(script.title_page);
          s.setStatus(t("cmd.imported", { name: file.split(/[\\/]/).pop() ?? "" }));
        } catch (e) {
          s.setStatus(t("cmd.importFailed", { error: String(e) }));
        }
      },
    },
    {
      id: "file.close",
      title: t("cmd.closeProject"),
      shortcut: "Mod-w",
      needsProject: true,
      run: () => app().closeProject(),
    },
    {
      id: "edit.find",
      title: t("cmd.find"),
      shortcut: "Mod-f",
      needsProject: true,
      run: () => app().setFindOpen(true),
    },
    {
      id: "edit.rename",
      title: t("cmd.rename"),
      needsProject: true,
      run: () => app().setRenameOpen(true),
    },
    {
      id: "edit.dual",
      title: t("cmd.dual"),
      shortcut: "Mod-Alt-d",
      needsProject: true,
      run: () => runEditorCommand(toggleDualDialogue as never),
    },
    {
      id: "edit.pageBreak",
      title: t("cmd.pageBreak"),
      shortcut: "Mod-Enter",
      needsProject: true,
      run: () => runEditorCommand(insertPageBreak as never),
    },
    {
      id: "edit.addAlternate",
      title: t("cmd.addAlternate"),
      shortcut: "Mod-Alt-n",
      needsProject: true,
      run: () => {
        if (addAlternate()) app().setStatus(t("alt.added"));
      },
    },
    {
      id: "edit.cycleAlternate",
      title: t("cmd.cycleAlternate"),
      shortcut: "Mod-Alt-x",
      needsProject: true,
      run: () => {
        if (!cycleAlternate()) app().setStatus(t("alt.none"));
      },
    },
    {
      id: "edit.addNote",
      title: t("cmd.addNote"),
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
    kindCmd("act_header", 8),
    kindCmd("lyrics", 9),
    {
      id: "view.write",
      title: t("cmd.viewScript"),
      needsProject: true,
      run: () => app().setView("write"),
    },
    {
      id: "view.cards",
      title: t("cmd.viewCards"),
      needsProject: true,
      run: () => app().setView("cards"),
    },
    {
      id: "view.navigator",
      title: t("cmd.toggleNavigator"),
      shortcut: "Mod-Shift-1",
      needsProject: true,
      run: () => app().togglePanel("navigator"),
    },
    {
      id: "view.notes",
      title: t("cmd.toggleNotes"),
      shortcut: "Mod-Shift-2",
      needsProject: true,
      run: () => app().togglePanel("notes"),
    },
    {
      id: "view.stats",
      title: t("cmd.toggleStats"),
      shortcut: "Mod-Shift-3",
      needsProject: true,
      run: () => app().togglePanel("stats"),
    },
    {
      id: "view.snapshots",
      title: t("cmd.toggleVersions"),
      shortcut: "Mod-Shift-4",
      needsProject: true,
      run: () => app().togglePanel("snapshots"),
    },
    {
      id: "view.revisions",
      title: t("cmd.toggleRevisions"),
      shortcut: "Mod-Shift-5",
      needsProject: true,
      run: () => app().togglePanel("revisions"),
    },
    {
      id: "view.titlePage",
      title: t("cmd.titlePage"),
      needsProject: true,
      run: () => app().setTitlePageOpen(true),
    },
    {
      id: "view.distractionFree",
      title: t("cmd.distractionFree"),
      shortcut: "Mod-Shift-f",
      run: () => app().setDistractionFree(!app().distractionFree),
    },
    {
      id: "view.typewriter",
      title: t("cmd.typewriter"),
      run: () => app().setTypewriter(!app().typewriter),
    },
    {
      id: "view.lineFocus",
      title: t("cmd.lineFocus"),
      run: () => app().setLineFocus(!app().lineFocus),
    },
    {
      id: "view.tableRead",
      title: t("cmd.tableRead"),
      needsProject: true,
      run: () => app().setTableReadOpen(!app().tableReadOpen),
    },
    {
      id: "view.format",
      title: t("cmd.format"),
      shortcut: "Mod-,",
      run: () => app().setFormatOpen(true),
    },
    { id: "theme.system", title: t("cmd.themeSystem"), run: () => app().setThemePref("system") },
    ...THEMES.map((th) => ({
      id: `theme.${th.id}`,
      title: t("cmd.theme", { name: t(th.labelKey) }),
      run: () => app().setThemePref(th.id),
    })),
    ...ACCENTS.map((a) => ({
      id: `accent.${a.id}`,
      title: t("cmd.accent", { name: t(a.labelKey) }),
      run: () => app().setAccent(a.id),
    })),
    numberingCmd("none"),
    numberingCmd("left"),
    numberingCmd("right"),
    numberingCmd("both"),
    {
      id: "view.uiZoomIn",
      title: t("cmd.uiZoomIn"),
      shortcut: "Mod-Shift-=",
      run: () => app().setUiZoom(app().uiZoom + 0.05),
    },
    {
      id: "view.uiZoomOut",
      title: t("cmd.uiZoomOut"),
      shortcut: "Mod-Shift--",
      run: () => app().setUiZoom(app().uiZoom - 0.05),
    },
    {
      id: "view.uiZoomReset",
      title: t("cmd.uiZoomReset"),
      run: () => app().setUiZoom(1),
    },
    {
      id: "backup.now",
      title: t("cmd.backupNow"),
      needsProject: true,
      run: async () => {
        const s = app();
        if (!s.projectPath) return;
        let dir = s.projectMeta?.backup_dir ?? null;
        if (!dir) {
          const picked = await open({ directory: true, title: t("cmd.chooseBackupTitle") });
          if (typeof picked !== "string") return;
          dir = picked;
          await s.setBackupDir(dir);
        }
        try {
          await s.saveNow();
          const name = await api.createBackup(s.projectPath, dir);
          s.setStatus(t("cmd.backedUp", { name }));
        } catch (e) {
          s.setStatus(t("cmd.backupFailed", { error: String(e) }));
        }
      },
    },
    {
      id: "backup.chooseDir",
      title: t("cmd.chooseBackupDir"),
      needsProject: true,
      run: async () => {
        const picked = await open({ directory: true, title: t("cmd.chooseBackupTitle") });
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
  else if (e.code === "Equal") key = "=";
  else if (e.code === "Minus") key = "-";
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
