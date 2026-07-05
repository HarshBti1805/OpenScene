import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { lastOpenedAt, useApp } from "../store";
import {
  builtinTemplates,
  deleteUserTemplate,
  listUserTemplates,
  TEMPLATE_CATEGORIES,
  type BuiltinTemplate,
  type UserTemplate,
} from "../templates";
import { defaultFormatSpec, type Script } from "../types";
import { getEditorView, replaceEditorScript } from "../editor/editorRef";
import { t } from "../i18n";
import { useFocusTrap } from "../ui/useFocusTrap";

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
  if (mins < 1) return t("start.justNow");
  if (mins < 60) return t("start.minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("start.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("start.daysAgo", { n: days });
  return new Date(ts).toLocaleDateString();
}

async function loadPoster(path: string): Promise<PosterData> {
  const name = path.split(/[\\/]/).pop() ?? path;
  try {
    // peek: read-only, no heartbeat/verification side effects
    const data = await api.peekProject(path);
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
    const picked = await open({ directory: true, title: t("start.openTitle") });
    if (typeof picked === "string") {
      try {
        await loadProject(picked);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  return (
    <div className="start-screen view-enter" role="main" aria-label={t("app.name")}>
      <div className="start-inner">
        <header className="start-masthead">
          <p className="start-kicker">{t("start.kicker")}</p>
          <h1 className="start-title">
            Open<span style={{ color: "var(--os-accent)" }}>Scene</span>
          </h1>
          <p className="start-subtitle">
            {t("start.subtitle")}
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
            aria-label={t("start.newProject")}
            style={{ animationDelay: "0ms" }}
          >
            <span className="poster-kicker">{t("start.productionNo", { n: posters.length + 1 })}</span>
            <span className="poster-new-plus" aria-hidden="true">
              +
            </span>
            <span className="poster-title">{t("start.newProject")}</span>
          </button>

          {posters.map((p, i) => (
            <button
              key={p.path}
              className="poster"
              style={{ animationDelay: `${Math.min(i + 1, 8) * 40}ms` }}
              onClick={() => loadProject(p.path).catch((e) => setError(String(e)))}
              aria-label={t("start.posterAria", { name: p.name })}
            >
              <span className="poster-kicker">{relativeTime(p.lastOpened) || t("start.onDisk")}</span>
              <span className="poster-title">{p.name}</span>
              <span className="poster-meta">
                {t("start.pagesScenes", { pages: p.pages !== null ? p.pages : "—", scenes: p.scenes })}
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
          <button className="btn" onClick={openFolder} aria-label={t("start.openFolder")}>
            {t("start.openFolder")}
          </button>
        </div>
      </div>

      {galleryOpen && <TemplateGallery onClose={() => setGalleryOpen(false)} onError={setError} />}
    </div>
  );
}

function TemplateGallery({ onClose, onError }: { onClose: () => void; onError: (e: string) => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>("feature");
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>(listUserTemplates());
  const [busy, setBusy] = useState(false);
  const builtins: BuiltinTemplate[] = builtinTemplates();

  const create = async () => {
    if (!name.trim() || busy) {
      if (!name.trim()) onError(t("start.nameRequired"));
      return;
    }
    const parent = await open({
      directory: true,
      title: t("start.whereCreate"),
    });
    if (typeof parent !== "string") return;
    setBusy(true);
    try {
      const user = userTemplates.find((x) => x.id === selected);
      const builtin = builtins.find((x) => x.id === selected);
      const result = await api.createProject(parent, name.trim(), "feature");
      const projectPath = result.data?.path;
      if (!projectPath) throw new Error(result.corrupt ?? "create failed");
      await useApp.getState().applyOpenResult(result, projectPath);

      // Stamp the template: boilerplate/content + format + title page.
      let script: Script | null = null;
      let format = null;
      if (user) {
        script = {
          title_page: user.titlePage.map(([k, v]) =>
            k.toLowerCase() === "title"
              ? ([k, name.trim().toUpperCase()] as [string, string])
              : ([k, v] as [string, string]),
          ),
          elements: user.elements,
        };
        format = user.format ?? null;
      } else if (builtin) {
        const text = builtin.boilerplate.split("{TITLE}").join(name.trim().toUpperCase());
        script = await api.parseFountain(text);
        format = builtin.format ?? null;
        if (builtin.minutesPerPage && !format) {
          format = { ...defaultFormatSpec(), minutes_per_page: builtin.minutesPerPage };
        }
      }
      if (script) {
        const st = useApp.getState();
        st.setTitlePage(script.title_page);
        if (user) st.setSceneNumbering(user.sceneNumbering);
        if (format || st.projectMeta) {
          const meta = { ...st.projectMeta!, format };
          useApp.setState({ projectMeta: meta });
          await api.saveProjectMeta(projectPath, meta).catch(() => {});
        }
        // The editor mounts asynchronously; retry briefly.
        const content = script;
        const stamp = (attempt = 0) => {
          if (getEditorView()) {
            replaceEditorScript(content);
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
        ref={trapRef}
        className="modal"
        style={{ width: 640 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("start.newProject")}
      >
        <h2 className="modal-title">{t("start.newProject")}</h2>
        <label className="field-label" htmlFor="np-name">
          {t("start.projectName")}
        </label>
        <input
          id="np-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder={t("start.projectNamePlaceholder")}
          autoFocus
        />

        <label className="field-label">{t("start.template")}</label>
        <div role="radiogroup" aria-label={t("start.template")}>
          {TEMPLATE_CATEGORIES.map((cat) => {
            const group = builtins.filter((x) => x.category === cat.id);
            if (group.length === 0) return null;
            return (
              <div key={cat.id}>
                <div className="template-cat">{t(cat.labelKey)}</div>
                <div className="template-grid">
                  {group.map((tpl) => (
                    <button
                      key={tpl.id}
                      className={`template-card${selected === tpl.id ? " selected" : ""}`}
                      role="radio"
                      aria-checked={selected === tpl.id}
                      onClick={() => setSelected(tpl.id)}
                    >
                      <div className="template-page" aria-hidden="true" />
                      <div className="template-name">{tpl.name}</div>
                      <div className="template-desc">{tpl.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {userTemplates.length > 0 && <div className="template-cat">{t("template.catYours")}</div>}
          <div className="template-grid">
          {userTemplates.map((tpl) => (
            <button
              key={tpl.id}
              className={`template-card${selected === tpl.id ? " selected" : ""}`}
              role="radio"
              aria-checked={selected === tpl.id}
              onClick={() => setSelected(tpl.id)}
            >
              <span
                className="template-delete"
                role="button"
                tabIndex={0}
                aria-label={t("start.deleteTemplate", { name: tpl.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteUserTemplate(tpl.id);
                  setUserTemplates(listUserTemplates());
                  if (selected === tpl.id) setSelected("feature");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    deleteUserTemplate(tpl.id);
                    setUserTemplates(listUserTemplates());
                  }
                }}
              >
                ✕
              </span>
              <div className="template-page" aria-hidden="true" />
              <div className="template-name">{tpl.name}</div>
              <div className="template-desc">{tpl.description || t("start.yourTemplate")}</div>
            </button>
          ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? t("start.creating") : t("start.create")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("start.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
