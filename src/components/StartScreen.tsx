import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { lastOpenedAt, useApp } from "../store";
import {
  BUILTIN_TEMPLATES,
  deleteUserTemplate,
  listUserTemplates,
  type UserTemplate,
} from "../templates";
import type { Script } from "../types";
import { getEditorView, replaceEditorScript } from "../editor/editorRef";

interface PosterData {
  path: string;
  name: string;
  pages: number | null;
  scenes: number;
  colors: (string | null)[];
  lastOpened: number | null;
}

function relativeTime(ts: number | null): string {
  if (!ts) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

async function loadPoster(path: string): Promise<PosterData> {
  const name = path.split(/[\\/]/).pop() ?? path;
  try {
    const data = await api.openProject(path);
    const scenes = data.script.elements.filter((e) => e.kind === "scene_heading");
    let pages: number | null = null;
    try {
      const pm = await api.computePageMap(data.script, { scene_numbering: "none" });
      pages = pm.page_count;
    } catch {
      pages = null;
    }
    return {
      path,
      name: data.meta.name || name,
      pages,
      scenes: scenes.length,
      colors: scenes.slice(0, 24).map((s) => s.color ?? null),
      lastOpened: lastOpenedAt(path),
    };
  } catch {
    return { path, name, pages: null, scenes: 0, colors: [], lastOpened: lastOpenedAt(path) };
  }
}

export function StartScreen() {
  const loadProject = useApp((s) => s.loadProject);
  const [posters, setPosters] = useState<PosterData[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .recentProjects()
      .then(async (paths) => {
        const loaded = await Promise.all(paths.map(loadPoster));
        if (!cancelled) setPosters(loaded);
      })
      .catch(() => setPosters([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const openFolder = async () => {
    const picked = await open({ directory: true, title: "Open project folder" });
    if (typeof picked === "string") {
      try {
        await loadProject(picked);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  return (
    <div className="start-screen view-enter" role="main" aria-label="Start screen">
      <div className="start-inner">
        <header className="start-masthead">
          <p className="start-kicker">Scene 1 · Take 1 · Int. Your Story — Day</p>
          <h1 className="start-title">
            Open<span style={{ color: "var(--os-accent)" }}>Scene</span>
          </h1>
          <p className="start-subtitle">
            Free, open-source, offline screenwriting. Your scripts are plain files on your disk —
            forever.
          </p>
        </header>

        {error && (
          <div className="start-error" role="alert">
            {error}
          </div>
        )}

        <div className="start-grid">
          <button
            className="poster poster-new"
            onClick={() => setGalleryOpen(true)}
            aria-label="New project from template"
            style={{ animationDelay: "0ms" }}
          >
            <span className="poster-kicker">Production no. {posters.length + 1}</span>
            <span className="poster-new-plus" aria-hidden="true">
              +
            </span>
            <span className="poster-title">New Project</span>
          </button>

          {posters.map((p, i) => (
            <button
              key={p.path}
              className="poster"
              style={{ animationDelay: `${Math.min(i + 1, 8) * 40}ms` }}
              onClick={() => loadProject(p.path).catch((e) => setError(String(e)))}
              aria-label={`Open project ${p.name}${p.pages ? `, ${p.pages} pages` : ""}`}
            >
              <span className="poster-kicker">{relativeTime(p.lastOpened) || "on disk"}</span>
              <span className="poster-title">{p.name}</span>
              <span className="poster-meta">
                {p.pages !== null ? `${p.pages} PP` : "—"} · {p.scenes} SC
              </span>
              <span className="poster-strip" aria-hidden="true">
                {(p.colors.length ? p.colors : [null]).map((c, ci) => (
                  <span key={ci} style={c ? { background: c } : undefined} />
                ))}
              </span>
            </button>
          ))}
        </div>

        <div className="start-open-row">
          <button className="btn" onClick={openFolder} aria-label="Open an existing project folder">
            Open Project Folder…
          </button>
        </div>
      </div>

      {galleryOpen && <TemplateGallery onClose={() => setGalleryOpen(false)} onError={setError} />}
    </div>
  );
}

function TemplateGallery({ onClose, onError }: { onClose: () => void; onError: (e: string) => void }) {
  const loadProject = useApp((s) => s.loadProject);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>("feature");
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>(listUserTemplates());
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) {
      if (!name.trim()) onError("Give the project a name.");
      return;
    }
    const parent = await open({
      directory: true,
      title: "Where should the project folder be created?",
    });
    if (typeof parent !== "string") return;
    setBusy(true);
    try {
      const user = userTemplates.find((t) => t.id === selected);
      const data = await api.createProject(parent, name.trim(), user ? "short" : selected);
      await loadProject(data.path);
      if (user) {
        // Stamp the user template's format + title page + boilerplate.
        const script: Script = {
          title_page: user.titlePage.map(([k, v]) =>
            k.toLowerCase() === "title" ? ([k, name.trim().toUpperCase()] as [string, string]) : ([k, v] as [string, string]),
          ),
          elements: user.elements,
        };
        const st = useApp.getState();
        st.setTitlePage(script.title_page);
        st.setSceneNumbering(user.sceneNumbering);
        // The editor mounts asynchronously after loadProject; retry briefly.
        const stamp = (attempt = 0) => {
          if (getEditorView()) {
            replaceEditorScript(script);
            void useApp.getState().saveNow();
          } else if (attempt < 20) {
            setTimeout(() => stamp(attempt + 1), 50);
          }
        };
        stamp();
      }
      onClose();
    } catch (e) {
      onError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={{ width: 640 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New project"
      >
        <h2 className="modal-title">New Project</h2>
        <label className="field-label" htmlFor="np-name">
          Project name
        </label>
        <input
          id="np-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="My Screenplay"
          autoFocus
        />

        <label className="field-label">Template</label>
        <div className="template-grid" role="radiogroup" aria-label="Project template">
          {BUILTIN_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={`template-card${selected === t.id ? " selected" : ""}`}
              role="radio"
              aria-checked={selected === t.id}
              onClick={() => setSelected(t.id)}
            >
              <div className="template-page" aria-hidden="true" />
              <div className="template-name">{t.name}</div>
              <div className="template-desc">{t.description}</div>
            </button>
          ))}
          {userTemplates.map((t) => (
            <button
              key={t.id}
              className={`template-card${selected === t.id ? " selected" : ""}`}
              role="radio"
              aria-checked={selected === t.id}
              onClick={() => setSelected(t.id)}
            >
              <span
                className="template-delete"
                role="button"
                tabIndex={0}
                aria-label={`Delete template ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteUserTemplate(t.id);
                  setUserTemplates(listUserTemplates());
                  if (selected === t.id) setSelected("feature");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    deleteUserTemplate(t.id);
                    setUserTemplates(listUserTemplates());
                  }
                }}
              >
                ✕
              </span>
              <div className="template-page" aria-hidden="true" />
              <div className="template-name">{t.name}</div>
              <div className="template-desc">{t.description || "Your saved template"}</div>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create Project"}
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
