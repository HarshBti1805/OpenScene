import { useMemo } from "react";
import { create } from "zustand";
import { api } from "./api";
import type {
  LayoutOptions,
  OpenResult,
  PageMap,
  ProjectMeta,
  SceneInfo,
  SceneNumbering,
  Script,
  SnapshotMeta,
  TitlePage,
} from "./types";

// ---------------------------------------------------------------------------
// Design-language: "Backlot" — see DESIGN.md. Theme + appearance settings.
// ---------------------------------------------------------------------------

export type ThemeId =
  | "light"
  | "dark"
  | "midnight"
  | "writers-room"
  | "matinee"
  | "darkroom"
  | "noir"
  | "greenroom"
  | "blueprint";
export type ThemePref = "system" | ThemeId;
export type ResolvedTheme = ThemeId;
export type AccentId = "signal" | "amber" | "crimson" | "cyan" | "green" | "violet" | "silver";
export type UiDensity = "comfortable" | "compact";
export type MotionPref = "full" | "reduced";
export type PageFont = "courier-prime" | "courier-prime-sans" | "opendyslexic" | "system-mono";
export type CursorStyle = "accent" | "ink" | "block";
export type PanelName = "navigator" | "notes" | "stats" | "snapshots" | "revisions";
export type MainView = "start" | "write" | "cards" | "note";

/** Theme registry: ids + swatch colors for pickers (values mirror styles.css). */
export const THEMES: {
  id: ThemeId;
  labelKey: string;
  /** App background / page color for the preview swatch. */
  bg: string;
  page: string;
  dark: boolean;
}[] = [
  { id: "light", labelKey: "format.themeLight", bg: "#ece5d4", page: "#fdfbf3", dark: false },
  { id: "writers-room", labelKey: "format.themeWritersRoom", bg: "#dfe3e8", page: "#ffffff", dark: false },
  { id: "matinee", labelKey: "format.themeMatinee", bg: "#e8dcc8", page: "#fbf5e8", dark: false },
  { id: "dark", labelKey: "format.themeDark", bg: "#16130e", page: "#201d16", dark: true },
  { id: "greenroom", labelKey: "format.themeGreenroom", bg: "#0e1410", page: "#131a14", dark: true },
  { id: "blueprint", labelKey: "format.themeBlueprint", bg: "#0e1319", page: "#121924", dark: true },
  { id: "darkroom", labelKey: "format.themeDarkroom", bg: "#120c0c", page: "#1a1212", dark: true },
  { id: "noir", labelKey: "format.themeNoir", bg: "#0d0d0e", page: "#151517", dark: true },
  { id: "midnight", labelKey: "format.themeMidnight", bg: "#0a0907", page: "#0e0d0a", dark: true },
];

/** Accent registry: "signal" keeps the theme's own accent (no override). */
export const ACCENTS: { id: AccentId; labelKey: string; swatch: string }[] = [
  { id: "signal", labelKey: "format.accentSignal", swatch: "#f2a33c" },
  { id: "amber", labelKey: "format.accentAmber", swatch: "#e8a33f" },
  { id: "crimson", labelKey: "format.accentCrimson", swatch: "#e0564e" },
  { id: "cyan", labelKey: "format.accentCyan", swatch: "#4db8e8" },
  { id: "green", labelKey: "format.accentGreen", swatch: "#6fbf73" },
  { id: "violet", labelKey: "format.accentViolet", swatch: "#b48ee8" },
  { id: "silver", labelKey: "format.accentSilver", swatch: "#d7d7dc" },
];

/** Which document the script editor is editing. */
export type ActiveDoc = { kind: "script" } | { kind: "draft"; name: string };

export const PAGE_FONTS: { id: PageFont; label: string; stack: string; standard: boolean }[] = [
  {
    id: "courier-prime",
    label: "Courier Prime",
    stack: '"Courier Prime", "Courier New", Courier, monospace',
    standard: true,
  },
  {
    id: "courier-prime-sans",
    label: "Courier Prime Sans",
    stack: '"Courier Prime Sans", "Courier Prime", monospace',
    standard: false,
  },
  {
    id: "opendyslexic",
    label: "OpenDyslexic",
    stack: '"OpenDyslexic", "Courier Prime", monospace',
    standard: false,
  },
  {
    id: "system-mono",
    label: "System monospace",
    stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    standard: false,
  },
];

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`openscene.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`openscene.${key}`, JSON.stringify(value));
  } catch {
    // Preferences are best-effort.
  }
}

const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "system") return systemDark?.matches ? "dark" : "light";
  return pref;
}

/** Applies theme with a soft 150ms crossfade (chrome only, off typing path). */
function applyTheme(pref: ThemePref) {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  if (root.getAttribute("data-theme") === resolved) return;
  root.classList.add("theme-switching");
  root.setAttribute("data-theme", resolved);
  window.setTimeout(() => root.classList.remove("theme-switching"), 220);
}

/** Accent override; "signal" removes the attribute so the theme's own accent wins. */
function applyAccent(accent: AccentId) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  if (accent === "signal") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", accent);
  window.setTimeout(() => root.classList.remove("theme-switching"), 220);
}

function applyDensity(density: UiDensity) {
  const root = document.documentElement;
  if (density === "comfortable") root.removeAttribute("data-density");
  else root.setAttribute("data-density", density);
}

function applyMotion(motion: MotionPref) {
  const root = document.documentElement;
  if (motion === "full") root.removeAttribute("data-motion");
  else root.setAttribute("data-motion", motion);
}

function applyPageAppearance(font: PageFont, zoom: number, cursor: CursorStyle) {
  const root = document.documentElement;
  const def = PAGE_FONTS.find((f) => f.id === font) ?? PAGE_FONTS[0];
  root.style.setProperty("--os-page-font", def.stack);
  root.style.setProperty("--os-page-zoom", String(zoom));
  root.setAttribute("data-cursor", cursor);
}

interface AppState {
  view: MainView;
  projectPath: string | null;
  projectMeta: ProjectMeta | null;
  titlePage: TitlePage;
  /** Latest script synced from the editor document. */
  script: Script;
  pageMap: PageMap | null;
  sceneNumbering: SceneNumbering;

  // Appearance settings (Backlot / Format & Appearance panel)
  themePref: ThemePref;
  accent: AccentId;
  uiDensity: UiDensity;
  motionPref: MotionPref;
  pageFont: PageFont;
  pageZoom: number;
  uiZoom: number;
  showRevisionMarks: boolean;
  lineFocus: boolean;
  cursorStyle: CursorStyle;
  typewriter: boolean;
  distractionFree: boolean;

  panel: PanelName | null;
  findOpen: boolean;
  paletteOpen: boolean;
  tableReadOpen: boolean;
  titlePageOpen: boolean;
  renameOpen: boolean;
  formatOpen: boolean;
  dirty: boolean;
  lastSaved: string | null;
  statusMessage: string | null;
  /** Another live writer holds the project: editing disabled. */
  readOnly: boolean;
  /** Sync-conflict artifact file names awaiting a decision. */
  conflicts: string[];
  /** Set when verify-on-open failed; drives the recovery dialog. */
  recovery: { path: string; reason: string; snapshots: SnapshotMeta[] } | null;
  /** Document open in the script editor (main script or a draft). */
  activeDoc: ActiveDoc;
  /** Markdown note open in the note view. */
  openNote: string | null;
  /** drafts/notes listing for the documents section. */
  documents: { drafts: string[]; notes: string[] };
  /** Scene filter (navigator + cards). */
  sceneFilter: import("./components/SceneFilter").SceneFilterState;

  layoutOptions: () => LayoutOptions;
  scenes: () => SceneInfo[];
  setView: (v: MainView) => void;
  setThemePref: (t: ThemePref) => void;
  setAccent: (a: AccentId) => void;
  setUiDensity: (d: UiDensity) => void;
  setMotionPref: (m: MotionPref) => void;
  setPageFont: (f: PageFont) => void;
  setPageZoom: (z: number) => void;
  setUiZoom: (z: number) => void;
  setShowRevisionMarks: (b: boolean) => void;
  setLineFocus: (b: boolean) => void;
  setCursorStyle: (c: CursorStyle) => void;
  setTypewriter: (b: boolean) => void;
  setDistractionFree: (b: boolean) => void;
  togglePanel: (p: PanelName) => void;
  setFindOpen: (b: boolean) => void;
  setPaletteOpen: (b: boolean) => void;
  setTableReadOpen: (b: boolean) => void;
  setTitlePageOpen: (b: boolean) => void;
  setRenameOpen: (b: boolean) => void;
  setFormatOpen: (b: boolean) => void;
  setSceneNumbering: (n: SceneNumbering) => void;
  setScript: (s: Script) => void;
  setPageMap: (pm: PageMap) => void;
  setTitlePage: (tp: TitlePage) => void;
  setStatus: (msg: string | null) => void;
  setRecovery: (r: AppState["recovery"]) => void;
  setConflicts: (c: string[]) => void;
  setSceneFilter: (f: import("./components/SceneFilter").SceneFilterState) => void;
  /** Toggle a pinned quick-access item ("scene:12" / "note:name"). */
  togglePin: (pin: string) => Promise<void>;

  loadProject: (path: string) => Promise<void>;
  /** Apply an OpenResult from open/create/recover/resolve commands. */
  applyOpenResult: (result: OpenResult, path: string) => Promise<void>;
  closeProject: () => Promise<void>;
  saveNow: () => Promise<void>;
  markDirty: () => void;
  setBackupDir: (dir: string) => Promise<void>;
  /** Zipped backup before risky operations (user dir or app-data fallback). */
  milestoneBackup: (reason: string) => Promise<void>;

  /** Key identifying the open editor document (drives editor remounts). */
  docKey: () => string;
  /** Snapshot stem for the active document. */
  snapshotStem: () => string;
  refreshDocuments: () => Promise<void>;
  openDraft: (name: string) => Promise<void>;
  openMainScript: () => Promise<void>;
  openNoteDoc: (name: string) => void;
}

const emptyScript: Script = { title_page: [], elements: [] };

export const useApp = create<AppState>((set, get) => ({
  view: "start",
  projectPath: null,
  projectMeta: null,
  titlePage: [],
  script: emptyScript,
  pageMap: null,
  sceneNumbering: "none",

  themePref: loadPref<ThemePref>("themePref", "system"),
  accent: loadPref<AccentId>("accent", "signal"),
  uiDensity: loadPref<UiDensity>("uiDensity", "comfortable"),
  motionPref: loadPref<MotionPref>("motionPref", "full"),
  pageFont: loadPref<PageFont>("pageFont", "courier-prime"),
  pageZoom: loadPref<number>("pageZoom", 1),
  uiZoom: loadPref<number>("uiZoom", 1),
  showRevisionMarks: loadPref<boolean>("showRevisionMarks", true),
  lineFocus: loadPref<boolean>("lineFocus", false),
  cursorStyle: loadPref<CursorStyle>("cursorStyle", "accent"),
  typewriter: loadPref("typewriter", false),
  distractionFree: false,

  panel: "navigator",
  findOpen: false,
  paletteOpen: false,
  tableReadOpen: false,
  titlePageOpen: false,
  renameOpen: false,
  formatOpen: false,
  dirty: false,
  lastSaved: null,
  statusMessage: null,
  readOnly: false,
  conflicts: [],
  recovery: null,
  activeDoc: { kind: "script" },
  openNote: null,
  documents: { drafts: [], notes: [] },
  sceneFilter: { character: "", location: "", intExt: "", dayNight: "", color: "" },

  layoutOptions: () => {
    const meta = get().projectMeta;
    const active = meta?.revisions?.find((r) => r.id === meta?.active_revision) ?? null;
    return {
      scene_numbering: get().sceneNumbering,
      revision_label: active ? `${active.label} — ${active.date}` : null,
      show_revision_marks: get().showRevisionMarks,
      locked: meta?.locked ?? null,
      format: meta?.format ?? null,
    };
  },

  scenes: () => {
    const { script, pageMap } = get();
    return computeScenes(script, pageMap);
  },

  setView: (v) => set({ view: v }),
  setThemePref: (t) => {
    savePref("themePref", t);
    applyTheme(t);
    set({ themePref: t });
  },
  setAccent: (a) => {
    savePref("accent", a);
    applyAccent(a);
    set({ accent: a });
  },
  setUiDensity: (d) => {
    savePref("uiDensity", d);
    applyDensity(d);
    set({ uiDensity: d });
  },
  setMotionPref: (m) => {
    savePref("motionPref", m);
    applyMotion(m);
    set({ motionPref: m });
  },
  setPageFont: (f) => {
    savePref("pageFont", f);
    applyPageAppearance(f, get().pageZoom, get().cursorStyle);
    set({ pageFont: f });
  },
  setPageZoom: (z) => {
    const zoom = Math.min(1.6, Math.max(0.7, z));
    savePref("pageZoom", zoom);
    applyPageAppearance(get().pageFont, zoom, get().cursorStyle);
    set({ pageZoom: zoom });
  },
  setShowRevisionMarks: (b) => {
    savePref("showRevisionMarks", b);
    set({ showRevisionMarks: b });
  },
  setUiZoom: (z) => {
    const zoom = Math.min(1.4, Math.max(0.8, Math.round(z * 20) / 20));
    savePref("uiZoom", zoom);
    document.documentElement.style.setProperty("--os-ui-zoom", String(zoom));
    set({ uiZoom: zoom });
  },
  setLineFocus: (b) => {
    savePref("lineFocus", b);
    set({ lineFocus: b });
  },
  setCursorStyle: (c) => {
    savePref("cursorStyle", c);
    applyPageAppearance(get().pageFont, get().pageZoom, c);
    set({ cursorStyle: c });
  },
  setTypewriter: (b) => {
    savePref("typewriter", b);
    set({ typewriter: b });
  },
  setDistractionFree: (b) => {
    set({ distractionFree: b });
    const el = document.documentElement;
    if (b && !document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    if (!b && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  },
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? null : p })),
  setFindOpen: (b) => set({ findOpen: b }),
  setPaletteOpen: (b) => set({ paletteOpen: b }),
  setTableReadOpen: (b) => set({ tableReadOpen: b }),
  setTitlePageOpen: (b) => set({ titlePageOpen: b }),
  setRenameOpen: (b) => set({ renameOpen: b }),
  setFormatOpen: (b) => set({ formatOpen: b }),
  setSceneNumbering: (n) => {
    set({ sceneNumbering: n });
    const { projectPath, projectMeta } = get();
    if (projectPath && projectMeta) {
      const meta = { ...projectMeta, scene_numbering: n };
      set({ projectMeta: meta });
      void api.saveProjectMeta(projectPath, meta);
    }
  },
  setScript: (s) => set({ script: s }),
  setPageMap: (pm) => set({ pageMap: pm }),
  setTitlePage: (tp) => {
    set({ titlePage: tp, dirty: true });
  },
  setStatus: (msg) => set({ statusMessage: msg }),
  setRecovery: (r) => set({ recovery: r }),
  setConflicts: (c) => set({ conflicts: c }),
  setSceneFilter: (f) => set({ sceneFilter: f }),
  togglePin: async (pin) => {
    const { projectPath, projectMeta } = get();
    if (!projectPath || !projectMeta) return;
    const pins = [...(projectMeta.pins ?? [])];
    const idx = pins.indexOf(pin);
    if (idx >= 0) pins.splice(idx, 1);
    else pins.push(pin);
    const meta = { ...projectMeta, pins };
    set({ projectMeta: meta });
    await api.saveProjectMeta(projectPath, meta).catch(() => {});
  },

  loadProject: async (path) => {
    const result = await api.openProject(path);
    await get().applyOpenResult(result, path);
  },

  applyOpenResult: async (result, path) => {
    if (result.corrupt !== null) {
      // Verify-on-open failed: never open partially, offer recovery.
      set({
        recovery: {
          path,
          reason: result.corrupt,
          snapshots: result.snapshots,
        },
      });
      return;
    }
    const data = result.data;
    if (!data) return;
    await api.addRecentProject(data.path);
    savePref(`lastOpened:${data.path}`, Date.now());
    set({
      view: "write",
      projectPath: data.path,
      projectMeta: data.meta,
      titlePage: data.script.title_page,
      script: data.script,
      sceneNumbering: (data.meta.scene_numbering as SceneNumbering) || "none",
      pageMap: null,
      dirty: false,
      lastSaved: null,
      readOnly: result.read_only,
      conflicts: result.conflicts,
      recovery: null,
      activeDoc: { kind: "script" },
      openNote: null,
    });
    await get().refreshDocuments();
  },

  closeProject: async () => {
    const { dirty, projectPath, readOnly } = get();
    if (dirty && !readOnly) await get().saveNow();
    if (projectPath && !readOnly) await api.releaseProject(projectPath).catch(() => {});
    set({
      view: "start",
      projectPath: null,
      projectMeta: null,
      titlePage: [],
      script: emptyScript,
      pageMap: null,
      dirty: false,
      readOnly: false,
      conflicts: [],
    });
  },

  saveNow: async () => {
    const { projectPath, script, titlePage, activeDoc } = get();
    if (!projectPath) return;
    const full: Script = { ...script, title_page: titlePage };
    if (activeDoc.kind === "draft") {
      await api.saveDraft(projectPath, activeDoc.name, full);
    } else {
      await api.saveScript(projectPath, full);
    }
    savePref(`lastOpened:${projectPath}`, Date.now());
    set({ dirty: false, lastSaved: new Date().toLocaleTimeString() });
  },

  markDirty: () => set({ dirty: true }),

  setBackupDir: async (dir) => {
    const { projectPath, projectMeta } = get();
    if (!projectPath || !projectMeta) return;
    const meta = { ...projectMeta, backup_dir: dir };
    set({ projectMeta: meta });
    await api.saveProjectMeta(projectPath, meta);
  },

  docKey: () => {
    const { projectPath, activeDoc } = get();
    return `${projectPath ?? ""}::${activeDoc.kind === "draft" ? `draft:${activeDoc.name}` : "script"}`;
  },

  snapshotStem: () => {
    const { activeDoc } = get();
    return activeDoc.kind === "draft" ? `draft-${activeDoc.name}` : "script";
  },

  refreshDocuments: async () => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      const documents = await api.listDocuments(projectPath);
      set({ documents });
    } catch {
      set({ documents: { drafts: [], notes: [] } });
    }
  },

  openDraft: async (name) => {
    const { projectPath, dirty, readOnly } = get();
    if (!projectPath) return;
    if (dirty && !readOnly) await get().saveNow();
    const script = await api.readDraft(projectPath, name);
    set({
      activeDoc: { kind: "draft", name },
      script,
      titlePage: script.title_page,
      pageMap: null,
      dirty: false,
      view: "write",
      openNote: null,
    });
  },

  openMainScript: async () => {
    const { projectPath, dirty, readOnly, activeDoc } = get();
    if (!projectPath || activeDoc.kind === "script") {
      set({ view: "write", openNote: null });
      return;
    }
    if (dirty && !readOnly) await get().saveNow();
    const data = await api.peekProject(projectPath);
    set({
      activeDoc: { kind: "script" },
      script: data.script,
      titlePage: data.script.title_page,
      pageMap: null,
      dirty: false,
      view: "write",
      openNote: null,
    });
  },

  openNoteDoc: (name) => {
    set({ openNote: name, view: "note" });
  },

  milestoneBackup: async (reason) => {
    const { projectPath, projectMeta, readOnly } = get();
    if (!projectPath || readOnly) return;
    try {
      if (get().dirty) await get().saveNow();
      if (projectMeta?.backup_dir) {
        await api.createBackup(projectPath, projectMeta.backup_dir);
      } else {
        await api.createAutoBackup(projectPath);
      }
    } catch {
      // A failed milestone backup must never block the operation itself;
      // snapshots still protect the content.
      get().setStatus(`Backup before ${reason} failed`);
    }
  },
}));

export function computeScenes(script: Script, pageMap: PageMap | null): SceneInfo[] {
  const out: SceneInfo[] = [];
  let autoNum = 0;
  script.elements.forEach((e, i) => {
    if (e.kind !== "scene_heading" && e.kind !== "omitted") return;
    autoNum++;
    const engineNumber = pageMap?.scene_numbers?.[i] ?? null;
    const ordinal = pageMap?.element_pages[i] ?? 1;
    out.push({
      elementIndex: i,
      heading: e.kind === "omitted" ? "OMITTED" : e.text,
      number: engineNumber ?? e.scene_number ?? String(autoNum),
      synopsis: e.synopsis ?? "",
      color: e.color ?? null,
      page: ordinal,
      pageLabel: pageMap?.page_labels?.[ordinal - 1] ?? String(ordinal),
      omitted: e.kind === "omitted",
    });
  });
  return out;
}

/** Reactive scene list. Memoized: selecting `s.scenes()` directly from the
 *  store would return a fresh array every snapshot and loop re-renders. */
export function useScenes(): SceneInfo[] {
  const script = useApp((s) => s.script);
  const pageMap = useApp((s) => s.pageMap);
  return useMemo(() => computeScenes(script, pageMap), [script, pageMap]);
}

export function lastOpenedAt(path: string): number | null {
  return loadPref<number | null>(`lastOpened:${path}`, null);
}

// Apply persisted appearance on module load; follow OS theme changes live.
{
  const s = useApp.getState();
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(s.themePref));
  if (s.accent !== "signal") root.setAttribute("data-accent", s.accent);
  applyDensity(s.uiDensity);
  applyMotion(s.motionPref);
  applyPageAppearance(s.pageFont, s.pageZoom, s.cursorStyle);
  document.documentElement.style.setProperty("--os-ui-zoom", String(s.uiZoom));
  systemDark?.addEventListener?.("change", () => {
    const st = useApp.getState();
    if (st.themePref === "system") applyTheme("system");
  });
}
