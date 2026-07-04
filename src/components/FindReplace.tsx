import { useEffect, useRef, useState } from "react";
import { TextSelection } from "prosemirror-state";
import { useApp } from "../store";
import { getEditorView } from "../editor/editorRef";

interface Match {
  from: number;
  to: number;
}

function findMatches(query: string, matchCase: boolean, wholeWord: boolean): Match[] {
  const view = getEditorView();
  if (!view || !query) return [];
  const matches: Match[] = [];
  const isWordChar = (c: string) => /[\p{L}\p{N}_']/u.test(c);
  view.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    const hay = matchCase ? node.text : node.text.toLowerCase();
    const needle = matchCase ? query : query.toLowerCase();
    let idx = hay.indexOf(needle);
    while (idx >= 0) {
      const before = idx > 0 ? node.text[idx - 1] : "";
      const after = idx + needle.length < node.text.length ? node.text[idx + needle.length] : "";
      const ok = !wholeWord || ((!before || !isWordChar(before)) && (!after || !isWordChar(after)));
      if (ok) matches.push({ from: pos + idx, to: pos + idx + needle.length });
      idx = hay.indexOf(needle, idx + 1);
    }
    return true;
  });
  return matches;
}

export function FindReplace() {
  const isOpen = useApp((s) => s.findOpen);
  const setOpen = useApp((s) => s.setFindOpen);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    setCount(findMatches(query, matchCase, wholeWord).length);
    setCurrent(0);
  }, [query, matchCase, wholeWord]);

  if (!isOpen) return null;

  const select = (m: Match) => {
    const view = getEditorView();
    if (!view) return;
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to));
    view.dispatch(tr.scrollIntoView());
  };

  const go = (dir: 1 | -1) => {
    const matches = findMatches(query, matchCase, wholeWord);
    setCount(matches.length);
    if (matches.length === 0) return;
    const next = (current + dir + matches.length) % matches.length;
    setCurrent(next);
    select(matches[next]);
  };

  const replaceOne = () => {
    const view = getEditorView();
    if (!view) return;
    const matches = findMatches(query, matchCase, wholeWord);
    if (matches.length === 0) return;
    const idx = Math.min(current, matches.length - 1);
    const m = matches[idx];
    view.dispatch(view.state.tr.insertText(replacement, m.from, m.to));
    const after = findMatches(query, matchCase, wholeWord);
    setCount(after.length);
    if (after.length > 0) {
      const next = Math.min(idx, after.length - 1);
      setCurrent(next);
      select(after[next]);
    }
  };

  const replaceAll = () => {
    const view = getEditorView();
    if (!view) return;
    const matches = findMatches(query, matchCase, wholeWord);
    if (matches.length === 0) return;
    let tr = view.state.tr;
    // Apply from the end so earlier positions stay valid.
    for (const m of [...matches].reverse()) {
      tr = tr.insertText(replacement, m.from, m.to);
    }
    view.dispatch(tr);
    setCount(0);
    useApp.getState().setStatus(`Replaced ${matches.length} occurrence${matches.length === 1 ? "" : "s"}`);
  };

  return (
    <div className="find-bar" role="search" aria-label="Find and replace">
      <input
        ref={inputRef}
        className="input find-input"
        value={query}
        placeholder="Find…"
        aria-label="Find text"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <input
        className="input find-input"
        value={replacement}
        placeholder="Replace with…"
        aria-label="Replacement text"
        onChange={(e) => setReplacement(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      <span className="find-count" aria-live="polite">
        {count > 0 ? `${Math.min(current + 1, count)}/${count}` : query ? "0" : ""}
      </span>
      <button className="btn btn-small" onClick={() => go(-1)} aria-label="Previous match">
        ↑
      </button>
      <button className="btn btn-small" onClick={() => go(1)} aria-label="Next match">
        ↓
      </button>
      <label className="find-toggle">
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Aa
      </label>
      <label className="find-toggle">
        <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Word
      </label>
      <button className="btn btn-small" onClick={replaceOne}>
        Replace
      </button>
      <button className="btn btn-small" onClick={replaceAll}>
        All
      </button>
      <button className="btn btn-small" onClick={() => setOpen(false)} aria-label="Close find bar">
        ×
      </button>
    </div>
  );
}
