import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { getEditorView, jumpToElement } from "../editor/editorRef";
import { insertNote } from "../editor/commands";

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
    <div className="panel" role="complementary" aria-label="Script notes">
      <div className="panel-header">Notes</div>
      <div className="note-add">
        <input
          ref={inputRef}
          className="input"
          value={text}
          placeholder="Add note at cursor…"
          aria-label="Note text"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <div className="note-add-row">
          <select
            className="input"
            value={category}
            aria-label="Note category"
            onChange={(e) => setCategory(e.target.value)}
          >
            {NOTE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={add}>
            Add
          </button>
        </div>
      </div>
      <div className="panel-body">
        {notes.length === 0 && <div className="panel-empty">No notes. Place the cursor and add one above.</div>}
        {notes.map((n, i) => (
          <div key={i} className={`note-item note-${n.category}`}>
            <button
              className="note-jump"
              onClick={() => jumpToElement(n.elementIndex)}
              aria-label={`Go to note: ${n.text}`}
            >
              <div className="note-text">{n.text}</div>
              <div className="note-context">
                <span className="note-cat">{n.category}</span> · {n.context}
              </div>
            </button>
            <button className="note-delete" onClick={() => remove(n)} aria-label={`Delete note: ${n.text}`}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
