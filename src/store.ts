import { useMemo } from "react";
import { create } from "zustand";
import { api } from "./api";
import type {
  LayoutOptions,
  PageMap,
  ProjectMeta,
  SceneInfo,
  SceneNumbering,
  Script,
  TitlePage,
} from "./types";

// ---------------------------------------------------------------------------
// Design-language: "Backlot" — see DESIGN.md. Theme + appearance settings.
// ---------------------------------------------------------------------------

export type ThemePref = "system" | "light" | "dark" | "midnight";
export type ResolvedTheme = "light" | "dark" | "midnight";
export type PageFont = "courier-prime" | "courier-prime-sans" | "opendyslexic" | "system-mono";
export type CursorStyle = "accent" | "ink" | "block";
export type PanelName = "navigator" | "notes" | "stats" | "snapshots";
export type MainView = "start" | "write" | "cards";

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
  pageFont: PageFont;
  pageZoom: number;
  lineFocus: boolean;
  cursorStyle: CursorStyle;
  typewriter: boolean;
  distractionFree: boolean;

  panel: PanelName | null;
  findOpen: boolean;
  paletteOpen: boolean;
  titlePageOpen: boolean;
  renameOpen: boolean;
  formatOpen: boolean;
  dirty: boolean;
  lastSaved: string | null;
  statusMessage: string | null;

  layoutOptions: () => LayoutOptions;
  scenes: () => SceneInfo[];
  setView: (v: MainView) => void;
  setThemePref: (t: ThemePref) => void;
  setPageFont: (f: PageFont) => void;
  setPageZoom: (z: number) => void;
  setLineFocus: (b: boolean) => void;
  setCursorStyle: (c: CursorStyle) => void;
  setTypewriter: (b: boolean) => void;
  setDistractionFree: (b: boolean) => void;
  togglePanel: (p: PanelName) => void;
  setFindOpen: (b: boolean) => void;
  setPaletteOpen: (b: boolean) => void;
  setTitlePageOpen: (b: boolean) => void;
  setRenameOpen: (b: boolean) => void;
  setFormatOpen: (b: boolean) => void;
  setSceneNumbering: (n: SceneNumbering) => void;
  setScript: (s: Script) => void;
  setPageMap: (pm: PageMap) => void;
  setTitlePage: (tp: TitlePage) => void;
  setStatus: (msg: string | null) => void;

  loadProject: (path: string) => Promise<void>;
  closeProject: () => Promise<void>;
  saveNow: () => Promise<void>;
  markDirty: () => void;
  setBackupDir: (dir: string) => Promise<void>;
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
  pageFont: loadPref<PageFont>("pageFont", "courier-prime"),
  pageZoom: loadPref<number>("pageZoom", 1),
  lineFocus: loadPref<boolean>("lineFocus", false),
  cursorStyle: loadPref<CursorStyle>("cursorStyle", "accent"),
  typewriter: loadPref("typewriter", false),
  distractionFree: false,

  panel: "navigator",
  findOpen: false,
  paletteOpen: false,
  titlePageOpen: false,
  renameOpen: false,
  formatOpen: false,
  dirty: false,
  lastSaved: null,
  statusMessage: null,

  layoutOptions: () => ({ scene_numbering: get().sceneNumbering }),

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

  loadProject: async (path) => {
    const data = await api.openProject(path);
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
    });
  },

  closeProject: async () => {
    const { dirty } = get();
    if (dirty) await get().saveNow();
    set({
      view: "start",
      projectPath: null,
      projectMeta: null,
      titlePage: [],
      script: emptyScript,
      pageMap: null,
      dirty: false,
    });
  },

  saveNow: async () => {
    const { projectPath, script, titlePage } = get();
    if (!projectPath) return;
    const full: Script = { ...script, title_page: titlePage };
    await api.saveScript(projectPath, full);
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
}));

export function computeScenes(script: Script, pageMap: PageMap | null): SceneInfo[] {
  const out: SceneInfo[] = [];
  let autoNum = 0;
  script.elements.forEach((e, i) => {
    if (e.kind !== "scene_heading") return;
    autoNum++;
    out.push({
      elementIndex: i,
      heading: e.text,
      number: e.scene_number ?? String(autoNum),
      synopsis: e.synopsis ?? "",
      color: e.color ?? null,
      page: pageMap?.element_pages[i] ?? 1,
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
  document.documentElement.setAttribute("data-theme", resolveTheme(s.themePref));
  applyPageAppearance(s.pageFont, s.pageZoom, s.cursorStyle);
  systemDark?.addEventListener?.("change", () => {
    const st = useApp.getState();
    if (st.themePref === "system") applyTheme("system");
  });
}
