import { useEffect, useMemo, useRef, useState } from "react";
import { buildCommands, shortcutLabel, type AppCommand } from "../appCommands";
import { useApp, useScenes } from "../store";
import { jumpToElement } from "../editor/editorRef";

interface PaletteEntry {
  id: string;
  title: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette() {
  const isOpen = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const hasProject = useApp((s) => s.projectPath !== null);
  const scenes = useScenes();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries: PaletteEntry[] = useMemo(() => {
    const cmds: AppCommand[] = buildCommands().filter((c) => hasProject || !c.needsProject);
    const sceneEntries: PaletteEntry[] = hasProject
      ? scenes.map((sc) => ({
          id: `scene.${sc.elementIndex}`,
          title: `Go to scene ${sc.number}: ${sc.heading}`,
          run: () => {
            useApp.getState().setView("write");
            requestAnimationFrame(() => jumpToElement(sc.elementIndex));
          },
        }))
      : [];
    return [...cmds, ...sceneEntries];
  }, [hasProject, scenes]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    return entries.filter((e) => fuzzyMatch(query.trim(), e.title));
  }, [entries, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => setSelected(0), [query]);

  if (!isOpen) return null;

  const runEntry = (e: PaletteEntry) => {
    setOpen(false);
    void e.run();
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div
        className="palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Type a command or scene…"
          aria-label="Command search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && filtered[selected]) {
              runEntry(filtered[selected]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <div className="palette-list" role="listbox" aria-label="Commands">
          {filtered.slice(0, 40).map((entry, i) => (
            <button
              key={entry.id}
              className={`palette-item${i === selected ? " selected" : ""}`}
              role="option"
              aria-selected={i === selected}
              onMouseEnter={() => setSelected(i)}
              onClick={() => runEntry(entry)}
            >
              <span>{entry.title}</span>
              {entry.shortcut && <kbd className="palette-kbd">{shortcutLabel(entry.shortcut)}</kbd>}
            </button>
          ))}
          {filtered.length === 0 && <div className="panel-empty">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
}
