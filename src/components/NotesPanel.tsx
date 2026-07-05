import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { getEditorView, jumpToElement } from "../editor/editorRef";
import { insertNote } from "../editor/commands";
import { t } from "../i18n";

const NOTE_CATEGORIES = ["note", "idea", "fix", "research", "beat"];

interface FlatNote {
  elementIndex: number;
  category: string;
  text: string;
  context: string;
}

export function NotesPanel() {
  const script = useApp((s) => s.script);
  const [text, setText] = useState("");
  const [category, setCategory] = useState("note");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("openscene:focus-note-input", focus);
    return () => window.removeEventListener("openscene:focus-note-input", focus);
  }, []);

  const notes: FlatNote[] = [];
  script.elements.forEach((e, i) => {
    for (const n of e.notes ?? []) {
      notes.push({
        elementIndex: i,
        category: n.category,
        text: n.text,
        context: e.text.slice(0, 48) || `(${e.kind.replace("_", " ")})`,
      });
    }
  });

  const add = () => {
    if (!text.trim()) return;
    const view = getEditorView();
    if (!view) return;
    insertNote(category, text.trim())(view.state, view.dispatch.bind(view));
    setText("");
    view.focus();
  };

  const remove = (target: FlatNote) => {
    const view = getEditorView();
    if (!view) return;
    let blockIdx = 0;
    let done = false;
    view.state.doc.forEach((node, pos) => {
      if (done || blockIdx++ !== target.elementIndex) return;
      node.forEach((child, offset) => {
        if (
          !done &&
          child.type.name === "note" &&
          child.attrs.text === target.text &&
          child.attrs.category === target.category
        ) {
          const at = pos + 1 + offset;
          view.dispatch(view.state.tr.delete(at, at + child.nodeSize));
          done = true;
        }
      });
    });
  };

  return (
    <div className="panel" role="complementary" aria-label={t("panel.notes")}>
      <div className="panel-header">{t("panel.notes")}</div>
      <div className="note-add">
        <input
          ref={inputRef}
          className="input"
          value={text}
          placeholder={t("notes.addPlaceholder")}
          aria-label={t("notes.noteText")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <div className="note-add-row">
          <select
            className="input"
            value={category}
            aria-label={t("notes.category")}
            onChange={(e) => setCategory(e.target.value)}
          >
            {NOTE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={add}>
            {t("notes.add")}
          </button>
        </div>
      </div>
      <div className="panel-body">
        {notes.length === 0 && <div className="panel-empty">{t("panel.emptyNotes")}</div>}
        {notes.map((n, i) => (
          <div key={i} className={`note-item note-${n.category}`}>
            <button
              className="note-jump"
              onClick={() => jumpToElement(n.elementIndex)}
              aria-label={t("notes.goTo", { text: n.text })}
            >
              <div className="note-text">{n.text}</div>
              <div className="note-context">
                <span className="note-cat">{n.category}</span> · {n.context}
              </div>
            </button>
            <button className="note-delete" onClick={() => remove(n)} aria-label={t("notes.delete", { text: n.text })}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
