import { useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { t } from "../i18n";

/** Documents section at the top of the navigator: main script, drafts, notes. */
export function DocumentsSection() {
  const projectPath = useApp((s) => s.projectPath);
  const documents = useApp((s) => s.documents);
  const activeDoc = useApp((s) => s.activeDoc);
  const openNote = useApp((s) => s.openNote);
  const view = useApp((s) => s.view);
  const [adding, setAdding] = useState<"draft" | "note" | null>(null);
  const [newName, setNewName] = useState("");

  if (!projectPath) return null;
  const s = () => useApp.getState();

  const create = async () => {
    const name = newName.trim().replace(/[/\\.]+/g, "-");
    if (!name || !adding) return;
    try {
      if (adding === "draft") {
        await api.createDraft(projectPath, name, true);
        await s().refreshDocuments();
        await s().openDraft(name);
      } else {
        await api.createNote(projectPath, name);
        await s().refreshDocuments();
        s().openNoteDoc(name);
      }
      setAdding(null);
      setNewName("");
    } catch (e) {
      s().setStatus(String(e));
    }
  };

  const remove = async (kind: "draft" | "note", name: string) => {
    try {
      await api.deleteDocument(projectPath, kind, name);
      s().setStatus(t("docs.deleted", { name }));
      if (kind === "draft" && activeDoc.kind === "draft" && activeDoc.name === name) {
        await s().openMainScript();
      }
      if (kind === "note" && openNote === name) {
        useApp.setState({ openNote: null, view: "write" });
      }
      await s().refreshDocuments();
    } catch (e) {
      s().setStatus(String(e));
    }
  };

  const scriptActive = activeDoc.kind === "script" && view !== "note";

  return (
    <div className="docs-section" role="group" aria-label={t("docs.title")}>
      <button
        className={`doc-item${scriptActive ? " active" : ""}`}
        onClick={() => void s().openMainScript()}
        aria-label={t("docs.openAria", { name: t("docs.mainScript") })}
        aria-current={scriptActive ? "true" : undefined}
      >
        <span className="doc-icon" aria-hidden="true">▤</span>
        {t("docs.mainScript")}
      </button>

      {documents.drafts.length > 0 && <div className="doc-group-label">{t("docs.drafts")}</div>}
      {documents.drafts.map((name) => {
        const active = activeDoc.kind === "draft" && activeDoc.name === name && view !== "note";
        return (
          <div key={`d-${name}`} className={`doc-item-row${active ? " active" : ""}`}>
            <button
              className="doc-item"
              onClick={() => void s().openDraft(name).catch((e) => s().setStatus(String(e)))}
              aria-label={t("docs.openAria", { name })}
              aria-current={active ? "true" : undefined}
            >
              <span className="doc-icon" aria-hidden="true">▢</span>
              {name}
            </button>
            <button className="doc-delete" onClick={() => void remove("draft", name)} aria-label={t("docs.deleteAria", { name })}>
              ×
            </button>
          </div>
        );
      })}

      {documents.notes.length > 0 && <div className="doc-group-label">{t("docs.notes")}</div>}
      {documents.notes.map((name) => {
        const active = view === "note" && openNote === name;
        return (
          <div key={`n-${name}`} className={`doc-item-row${active ? " active" : ""}`}>
            <button
              className="doc-item"
              onClick={() => s().openNoteDoc(name)}
              aria-label={t("docs.openAria", { name })}
              aria-current={active ? "true" : undefined}
            >
              <span className="doc-icon" aria-hidden="true">✎</span>
              {name}
            </button>
            <button
              className="doc-delete"
              style={{ opacity: 1 }}
              aria-label={t("pins.toggleNote", { name })}
              aria-pressed={(useApp.getState().projectMeta?.pins ?? []).includes(`note:${name}`)}
              onClick={() => void useApp.getState().togglePin(`note:${name}`)}
            >
              {(useApp.getState().projectMeta?.pins ?? []).includes(`note:${name}`) ? "★" : "☆"}
            </button>
            <button className="doc-delete" onClick={() => void remove("note", name)} aria-label={t("docs.deleteAria", { name })}>
              ×
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="doc-add-row">
          <input
            className="input"
            value={newName}
            autoFocus
            placeholder={t("docs.namePlaceholder")}
            aria-label={t("docs.namePlaceholder")}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
              if (e.key === "Escape") setAdding(null);
            }}
          />
        </div>
      ) : (
        <div className="doc-add-row">
          <button className="btn btn-small btn-ghost" onClick={() => setAdding("draft")}>
            {t("docs.newDraft")}
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => setAdding("note")}>
            {t("docs.newNote")}
          </button>
        </div>
      )}
    </div>
  );
}
