import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useApp } from "../store";
import { assetRefs, renderMarkdown } from "../ui/markdown";
import { t } from "../i18n";

/** Markdown notes editor: edit/preview toggle, images stored under assets/. */
export function NoteEditor() {
  const projectPath = useApp((s) => s.projectPath);
  const name = useApp((s) => s.openNote);
  const readOnly = useApp((s) => s.readOnly);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(false);
  const [html, setHtml] = useState("");
  const dirtyRef = useRef(false);
  const textRef = useRef("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!projectPath || !name) return;
    setLoaded(false);
    api
      .readNote(projectPath, name)
      .then((content) => {
        setText(content);
        textRef.current = content;
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [projectPath, name]);

  const save = useCallback(async () => {
    if (!projectPath || !name || !dirtyRef.current || readOnly) return;
    dirtyRef.current = false;
    await api.saveNote(projectPath, name, textRef.current).catch(() => {});
  }, [projectPath, name, readOnly]);

  // Debounced autosave (atomic writes in the backend) + save on unmount.
  useEffect(() => {
    const interval = setInterval(() => void save(), 2000);
    return () => {
      clearInterval(interval);
      void save();
    };
  }, [save]);

  // Build preview: resolve asset references to data URIs.
  useEffect(() => {
    if (!preview || !projectPath) return;
    let cancelled = false;
    (async () => {
      const refs = assetRefs(text);
      const assets = new Map<string, string>();
      for (const ref of refs) {
        try {
          const b64 = await api.readAssetBase64(projectPath, ref);
          const ext = ref.split(".").pop()?.toLowerCase() ?? "png";
          const mime = ext === "jpg" ? "jpeg" : ext;
          assets.set(ref, `data:image/${mime};base64,${b64}`);
        } catch {
          // Missing asset: renderer shows a placeholder.
        }
      }
      if (!cancelled) setHtml(renderMarkdown(text, assets));
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, text, projectPath]);

  if (!projectPath || !name) return null;

  const insertImage = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const assetName = await api.importNoteAsset(projectPath, picked);
      const area = areaRef.current;
      const insertion = `![](assets/${assetName})`;
      const at = area?.selectionStart ?? text.length;
      const next = text.slice(0, at) + insertion + text.slice(at);
      setText(next);
      textRef.current = next;
      dirtyRef.current = true;
    } catch (e) {
      useApp.getState().setStatus(String(e));
    }
  };

  return (
    <div className="note-editor view-enter" role="main" aria-label={t("docs.notesEditorAria")}>
      <div className="note-editor-bar">
        <span className="note-editor-title">{name}</span>
        <div className="toolbar-spacer" />
        <button className="btn btn-small" onClick={insertImage} disabled={readOnly}>
          + 🖼
        </button>
        <div className="toolbar-group" role="group" aria-label={t("docs.preview")}>
          <button
            className={`btn btn-small${!preview ? " active" : ""}`}
            onClick={() => setPreview(false)}
            aria-pressed={!preview}
          >
            {t("docs.edit")}
          </button>
          <button
            className={`btn btn-small${preview ? " active" : ""}`}
            onClick={() => setPreview(true)}
            aria-pressed={preview}
          >
            {t("docs.preview")}
          </button>
        </div>
      </div>
      {preview ? (
        <div
          className="note-preview"
          // Renderer output is escaped HTML from our own minimal markdown
          // pipeline; no external content ever reaches it.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <textarea
          ref={areaRef}
          className="note-textarea"
          value={loaded ? text : ""}
          readOnly={readOnly || !loaded}
          aria-label={t("docs.notesEditorAria")}
          onChange={(e) => {
            setText(e.target.value);
            textRef.current = e.target.value;
            dirtyRef.current = true;
          }}
        />
      )}
    </div>
  );
}
