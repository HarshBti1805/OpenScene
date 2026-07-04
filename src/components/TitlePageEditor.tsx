import { useEffect, useState } from "react";
import { useApp } from "../store";
import type { TitlePage } from "../types";

const FIELDS: { key: string; label: string; multiline?: boolean }[] = [
  { key: "Title", label: "Title" },
  { key: "Credit", label: "Credit (e.g. written by)" },
  { key: "Author", label: "Byline / Author" },
  { key: "Draft date", label: "Draft date" },
  { key: "Contact", label: "Contact", multiline: true },
];

export function TitlePageEditor() {
  const isOpen = useApp((s) => s.titlePageOpen);
  const setOpen = useApp((s) => s.setTitlePageOpen);
  const titlePage = useApp((s) => s.titlePage);
  const setTitlePage = useApp((s) => s.setTitlePage);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      const v: Record<string, string> = {};
      for (const [k, val] of titlePage) v[k] = val;
      setValues(v);
    }
  }, [isOpen, titlePage]);

  if (!isOpen) return null;

  const apply = () => {
    const tp: TitlePage = [];
    // Preserve field order, keep unknown existing keys at the end.
    for (const f of FIELDS) {
      const v = (values[f.key] ?? "").trim();
      if (v) tp.push([f.key, v]);
    }
    for (const [k, v] of titlePage) {
      if (!FIELDS.some((f) => f.key === k) && v.trim()) tp.push([k, v]);
    }
    setTitlePage(tp);
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Title page editor">
        <h2 className="modal-title">Title Page</h2>
        {FIELDS.map((f) => (
          <div key={f.key} className="modal-field">
            <label className="field-label" htmlFor={`tp-${f.key}`}>
              {f.label}
            </label>
            {f.multiline ? (
              <textarea
                id={`tp-${f.key}`}
                className="input"
                rows={3}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            ) : (
              <input
                id={`tp-${f.key}`}
                className="input"
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={apply}>
            Save
          </button>
          <button className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
