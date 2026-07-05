import { useMemo, useState } from "react";
import { useApp } from "../store";
import { getEditorView } from "../editor/editorRef";
import { t } from "../i18n";
import { useFocusTrap } from "../ui/useFocusTrap";

interface Occurrence {
  from: number;
  to: number;
  blockKind: string;
  preview: string;
}

/** Cue base = name before any parenthetical extension. */
function cueBase(text: string): string {
  const i = text.indexOf("(");
  return (i >= 0 ? text.slice(0, i) : text).trim().toUpperCase();
}

function findOccurrences(name: string): Occurrence[] {
  const view = getEditorView();
  if (!view || !name) return [];
  const target = name.trim().toUpperCase();
  if (!target) return [];
  const out: Occurrence[] = [];
  const isWordChar = (c: string) => /[\p{L}\p{N}_']/u.test(c);

  view.state.doc.forEach((block, blockPos) => {
    if (!block.type.isTextblock) return;
    const kind = block.type.name;
    if (kind === "character") {
      // Match the cue base exactly.
      const text = block.textContent;
      if (cueBase(text) === target) {
        const baseLen = (text.indexOf("(") >= 0 ? text.slice(0, text.indexOf("(")) : text).trimEnd().length;
        out.push({
          from: blockPos + 1,
          to: blockPos + 1 + baseLen,
          blockKind: "character cue",
          preview: text,
        });
      }
      return;
    }
    // Mentions in dialogue/action/etc.: case-insensitive whole-word match.
    block.forEach((child, offset) => {
      if (!child.isText || !child.text) return;
      const hay = child.text.toUpperCase();
      let idx = hay.indexOf(target);
      while (idx >= 0) {
        const before = idx > 0 ? child.text[idx - 1] : "";
        const after = idx + target.length < child.text.length ? child.text[idx + target.length] : "";
        if ((!before || !isWordChar(before)) && (!after || !isWordChar(after))) {
          const start = blockPos + 1 + offset + idx;
          out.push({
            from: start,
            to: start + target.length,
            blockKind: kind.replace("_", " "),
            preview: child.text.slice(Math.max(0, idx - 24), idx + target.length + 24),
          });
        }
        idx = hay.indexOf(target, idx + 1);
      }
    });
  });
  return out;
}

export function RenameDialog() {
  const isOpen = useApp((s) => s.renameOpen);
  const setOpen = useApp((s) => s.setRenameOpen);
  const script = useApp((s) => s.script);
  const setStatus = useApp((s) => s.setStatus);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen, () => setOpen(false));

  const characters = useMemo(() => {
    const names = new Set<string>();
    for (const e of script.elements) {
      if (e.kind === "character") {
        const base = cueBase(e.text);
        if (base) names.add(base);
      }
    }
    return [...names].sort();
  }, [script]);

  const occurrences = useMemo(() => (isOpen ? findOccurrences(from) : []), [from, isOpen]);

  if (!isOpen) return null;

  const apply = async () => {
    const view = getEditorView();
    if (!view || !to.trim() || occurrences.length === 0) return;
    // Mass rename is a milestone: zipped backup first.
    await useApp.getState().milestoneBackup("rename");
    const replacementRaw = to.trim();
    let tr = view.state.tr;
    for (const occ of [...occurrences].sort((a, b) => b.from - a.from)) {
      // Character cues stay uppercase; mentions keep the typed casing.
      const replacement = occ.blockKind === "character cue" ? replacementRaw.toUpperCase() : replacementRaw;
      tr = tr.insertText(replacement, occ.from, occ.to);
    }
    view.dispatch(tr);
    setStatus(t("rename.done", { from: from.toUpperCase(), to: replacementRaw, n: occurrences.length }));
    setOpen(false);
    setFrom("");
    setTo("");
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div ref={trapRef} className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("rename.title")}>
        <h2 className="modal-title">{t("rename.title")}</h2>
        <div className="modal-field">
          <label className="field-label" htmlFor="rename-from">
            {t("rename.character")}
          </label>
          <select id="rename-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{t("rename.choose")}</option>
            {characters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-field">
          <label className="field-label" htmlFor="rename-to">
            {t("rename.newName")}
          </label>
          <input
            id="rename-to"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t("rename.newNamePlaceholder")}
          />
        </div>
        {from && (
          <div className="rename-preview">
            <div className="field-label">{t("rename.occurrences", { n: occurrences.length })}</div>
            <div className="rename-list">
              {occurrences.slice(0, 50).map((o, i) => (
                <div key={i} className="rename-item">
                  <span className="rename-kind">{o.blockKind}</span> …{o.preview}…
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={apply} disabled={!from || !to.trim() || occurrences.length === 0}>
            {t("rename.apply", { suffix: occurrences.length > 0 ? `(${occurrences.length})` : "" })}
          </button>
          <button className="btn" onClick={() => setOpen(false)}>
            {t("rename.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
