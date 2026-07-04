import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useApp } from "../store";

export function StartScreen() {
  const loadProject = useApp((s) => s.loadProject);
  const [recents, setRecents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"feature" | "short">("feature");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.recentProjects().then(setRecents).catch(() => setRecents([]));
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

  const create = async () => {
    if (!name.trim()) {
      setError("Give the project a name.");
      return;
    }
    const parent = await open({ directory: true, title: "Where should the project folder be created?" });
    if (typeof parent !== "string") return;
    try {
      const data = await api.createProject(parent, name.trim(), template);
      await loadProject(data.path);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="start-screen" role="main" aria-label="Start screen">
      <div className="start-inner">
        <h1 className="start-title">OpenScene</h1>
        <p className="start-subtitle">Free, open-source, offline screenwriting</p>

        {error && (
          <div className="start-error" role="alert">
            {error}
          </div>
        )}

        {!creating ? (
          <div className="start-actions">
            <button className="btn btn-primary" onClick={() => setCreating(true)} aria-label="New project">
              New Project
            </button>
            <button className="btn" onClick={openFolder} aria-label="Open project folder">
              Open Project Folder…
            </button>
          </div>
        ) : (
          <div className="start-create">
            <label className="field-label" htmlFor="proj-name">
              Project name
            </label>
            <input
              id="proj-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="My Screenplay"
              autoFocus
            />
            <label className="field-label" htmlFor="proj-template">
              Template
            </label>
            <select
              id="proj-template"
              className="input"
              value={template}
              onChange={(e) => setTemplate(e.target.value as "feature" | "short")}
            >
              <option value="feature">Feature Film</option>
              <option value="short">Short Film</option>
            </select>
            <div className="start-actions">
              <button className="btn btn-primary" onClick={create}>
                Create
              </button>
              <button className="btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {recents.length > 0 && (
          <div className="recent-list">
            <h2 className="recent-heading">Recent projects</h2>
            {recents.map((p) => (
              <button
                key={p}
                className="recent-item"
                onClick={() => loadProject(p).catch((e) => setError(String(e)))}
                aria-label={`Open recent project ${p}`}
              >
                <span className="recent-name">{p.split(/[\\/]/).pop()}</span>
                <span className="recent-path">{p}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
