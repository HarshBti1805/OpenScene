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

export type Theme = "light" | "dark" | "midnight";
export type PanelName = "navigator" | "notes" | "stats" | "snapshots";
export type MainView = "start" | "write" | "cards";

interface AppState {
  view: MainView;
  projectPath: string | null;
  projectMeta: ProjectMeta | null;
  titlePage: TitlePage;
  /** Latest script synced from the editor document. */
  script: Script;
  pageMap: PageMap | null;
  sceneNumbering: SceneNumbering;
  theme: Theme;
  typewriter: boolean;
  distractionFree: boolean;
  panel: PanelName | null;
  findOpen: boolean;
  paletteOpen: boolean;
  titlePageOpen: boolean;
  renameOpen: boolean;
  dirty: boolean;
  lastSaved: string | null;
  statusMessage: string | null;

  layoutOptions: () => LayoutOptions;
  scenes: () => SceneInfo[];
  setView: (v: MainView) => void;
  setTheme: (t: Theme) => void;
  setTypewriter: (b: boolean) => void;
  setDistractionFree: (b: boolean) => void;
  togglePanel: (p: PanelName) => void;
  setFindOpen: (b: boolean) => void;
  setPaletteOpen: (b: boolean) => void;
  setTitlePageOpen: (b: boolean) => void;
  setRenameOpen: (b: boolean) => void;
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

export const useApp = create<AppState>((set, get) => ({
  view: "start",
  projectPath: null,
  projectMeta: null,
  titlePage: [],
  script: emptyScript,
  pageMap: null,
  sceneNumbering: "none",
  theme: loadPref<Theme>("theme", "dark"),
  typewriter: loadPref("typewriter", false),
  distractionFree: false,
  panel: "navigator",
  findOpen: false,
  paletteOpen: false,
  titlePageOpen: false,
  renameOpen: false,
  dirty: false,
  lastSaved: null,
  statusMessage: null,

  layoutOptions: () => ({ scene_numbering: get().sceneNumbering }),

  scenes: () => {
    const { script, pageMap } = get();
    return computeScenes(script, pageMap);
  },

  setView: (v) => set({ view: v }),
  setTheme: (t) => {
    savePref("theme", t);
    document.documentElement.setAttribute("data-theme", t);
    set({ theme: t });
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

// Apply persisted theme on module load.
document.documentElement.setAttribute("data-theme", loadPref<Theme>("theme", "dark"));
