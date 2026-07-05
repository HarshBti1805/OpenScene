import { useEffect, useRef, useState } from "react";
import { TextSelection } from "prosemirror-state";
import { useApp } from "../store";
import { getEditorView } from "../editor/editorRef";
import { t } from "../i18n";

interface Match {
  from: number;
  to: number;
}

export type FindScope = "all" | "dialogue" | "action" | "heading";

interface FindFilter {
  scope: FindScope;
  /** Restrict dialogue matches to this character's speeches (cue base). */
  character: string | null;
}

const SCOPE_KINDS: Record<Exclude<FindScope, "all">, Set<string>> = {
  dialogue: new Set(["dialogue", "parenthetical"]),
  action: new Set(["action", "shot"]),
  heading: new Set(["scene_heading", "transition"]),
};

function cueBase(text: string): string {
  const i = text.indexOf("(");
  return (i >= 0 ? text.slice(0, i) : text).trim().toUpperCase();
}

/** Walk blocks in order (tracking the current speaker) and match text. */
function findMatches(query: string, matchCase: boolean, wholeWord: boolean, filter: FindFilter): Match[] {
  const view = getEditorView();
  if (!view || !query) return [];
  const matches: Match[] = [];
  const isWordChar = (c: string) => /[\p{L}\p{N}_']/u.test(c);
  const needle = matchCase ? query : query.toLowerCase();
  let speaker: string | null = null;

  view.state.doc.forEach((block, blockPos) => {
    const kind = block.type.name;
    if (kind === "character") speaker = cueBase(block.textContent);
    else if (kind === "scene_heading" || kind === "transition" || kind === "omitted") speaker = null;

    if (!block.type.isTextblock) return;
    if (filter.scope !== "all" && !SCOPE_KINDS[filter.scope].has(kind)) {
      // Character-scoped search also covers the cue lines themselves.
      if (!(filter.character && kind === "character")) return;
    }
    if (filter.character) {
      const inSpeech =
        (kind === "dialogue" || kind === "parenthetical") && speaker === filter.character;
      const isCue = kind === "character" && cueBase(block.textContent) === filter.character;
      if (!inSpeech && !isCue) return;
    }

    block.forEach((child, offset) => {
      if (!child.isText || !child.text) return;
      const hay = matchCase ? child.text : child.text.toLowerCase();
      let idx = hay.indexOf(needle);
      while (idx >= 0) {
        const before = idx > 0 ? child.text[idx - 1] : "";
        const after = idx + needle.length < child.text.length ? child.text[idx + needle.length] : "";
        const ok = !wholeWord || ((!before || !isWordChar(before)) && (!after || !isWordChar(after)));
        if (ok) {
          const start = blockPos + 1 + offset + idx;
          matches.push({ from: start, to: start + needle.length });
        }
        idx = hay.indexOf(needle, idx + 1);
      }
    });
  });
  return matches;
}

export function FindReplace() {
  const isOpen = useApp((s) => s.findOpen);
  const setOpen = useApp((s) => s.setFindOpen);
  const script = useApp((s) => s.script);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<FindScope>("all");
  const [character, setCharacter] = useState<string>("");
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const characters = Array.from(
    new Set(
      script.elements
        .filter((e) => e.kind === "character")
        .map((e) => cueBase(e.text))
        .filter(Boolean),
    ),
  ).sort();

  const filter: FindFilter = { scope, character: character || null };

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    setCount(findMatches(query, matchCase, wholeWord, filter).length);
    setCurrent(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase, wholeWord, scope, character]);

  if (!isOpen) return null;

  const select = (m: Match) => {
    const view = getEditorView();
    if (!view) return;
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to));
    view.dispatch(tr.scrollIntoView());
  };

  const go = (dir: 1 | -1) => {
    const matches = findMatches(query, matchCase, wholeWord, filter);
    setCount(matches.length);
    if (matches.length === 0) return;
    const next = (current + dir + matches.length) % matches.length;
    setCurrent(next);
    select(matches[next]);
  };

  const replaceOne = () => {
    const view = getEditorView();
    if (!view) return;
    const matches = findMatches(query, matchCase, wholeWord, filter);
    if (matches.length === 0) return;
    const idx = Math.min(current, matches.length - 1);
    const m = matches[idx];
    view.dispatch(view.state.tr.insertText(replacement, m.from, m.to));
    const after = findMatches(query, matchCase, wholeWord, filter);
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
    const matches = findMatches(query, matchCase, wholeWord, filter);
    if (matches.length === 0) return;
    let tr = view.state.tr;
    for (const m of [...matches].reverse()) {
      tr = tr.insertText(replacement, m.from, m.to);
    }
    view.dispatch(tr);
    setCount(0);
    useApp.getState().setStatus(t("find.replaced", { n: matches.length }));
  };

  const scopes: { id: FindScope; label: string }[] = [
    { id: "all", label: t("find.scopeAll") },
    { id: "dialogue", label: t("find.scopeDialogue") },
    { id: "action", label: t("find.scopeAction") },
    { id: "heading", label: t("find.scopeHeadings") },
  ];

  return (
    <div className="find-bar" role="search" aria-label={t("cmd.find")}>
      <input
        ref={inputRef}
        className="input find-input"
        value={query}
        placeholder={t("find.placeholder")}
        aria-label={t("find.findAria")}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <input
        className="input find-input"
        value={replacement}
        placeholder={t("find.replacePlaceholder")}
        aria-label={t("find.replaceAria")}
        onChange={(e) => setReplacement(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      <div className="scope-chips" role="radiogroup" aria-label={t("find.scopeAria")}>
        {scopes.map((sc) => (
          <button
            key={sc.id}
            className={`scope-chip${scope === sc.id ? " active" : ""}`}
            role="radio"
            aria-checked={scope === sc.id}
            onClick={() => setScope(sc.id)}
          >
            {sc.label}
          </button>
        ))}
      </div>
      <select
        className="input"
        style={{ width: 120 }}
        value={character}
        aria-label={t("find.characterAria")}
        onChange={(e) => setCharacter(e.target.value)}
      >
        <option value="">{t("find.anyCharacter")}</option>
        {characters.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="find-count" aria-live="polite">
        {count > 0 ? `${Math.min(current + 1, count)}/${count}` : query ? "0" : ""}
      </span>
      <button className="btn btn-small" onClick={() => go(-1)} aria-label={t("find.prev")}>
        ↑
      </button>
      <button className="btn btn-small" onClick={() => go(1)} aria-label={t("find.next")}>
        ↓
      </button>
      <label className="find-toggle">
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> {t("find.matchCase")}
      </label>
      <label className="find-toggle">
        <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> {t("find.wholeWord")}
      </label>
      <button className="btn btn-small" onClick={replaceOne}>
        {t("find.replace")}
      </button>
      <button className="btn btn-small" onClick={replaceAll}>
        {t("find.replaceAll")}
      </button>
      <button className="btn btn-small" onClick={() => setOpen(false)} aria-label={t("find.close")}>
        ×
      </button>
    </div>
  );
}
