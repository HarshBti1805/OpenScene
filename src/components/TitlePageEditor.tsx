import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useApp } from "../store";
import { convertAssetToJpeg } from "../ui/useAsset";
import type { TitlePage } from "../types";
import { t } from "../i18n";
import { useFocusTrap } from "../ui/useFocusTrap";

const FIELDS: { key: string; label: string; multiline?: boolean }[] = [
  { key: "Title", label: t("titlePage.fieldTitle") },
  { key: "Credit", label: t("titlePage.fieldCredit") },
  { key: "Author", label: t("titlePage.fieldAuthor") },
  { key: "Draft date", label: t("titlePage.fieldDraftDate") },
  { key: "Contact", label: t("titlePage.fieldContact"), multiline: true },
];

export function TitlePageEditor() {
  const isOpen = useApp((s) => s.titlePageOpen);
  const setOpen = useApp((s) => s.setTitlePageOpen);
  const titlePage = useApp((s) => s.titlePage);
  const setTitlePage = useApp((s) => s.setTitlePage);
  const [values, setValues] = useState<Record<string, string>>({});
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen, () => setOpen(false));

  useEffect(() => {
    if (isOpen) {
      const v: Record<string, string> = {};
      for (const [k, val] of titlePage) v[k] = val;
      setValues(v);
    }
  }, [isOpen, titlePage]);

  if (!isOpen) return null;

  const pickImage = async () => {
    const st = useApp.getState();
    if (!st.projectPath) return;
    const picked = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    if (typeof picked !== "string") return;
    try {
      const raw = await api.importNoteAsset(st.projectPath, picked);
      // The PDF embeds JPEG; convert other formats via canvas (offline).
      const jpeg = await convertAssetToJpeg(st.projectPath, raw);
      setValues((v) => ({ ...v, Image: jpeg }));
    } catch (e) {
      st.setStatus(String(e));
    }
  };

  const apply = () => {
    const tp: TitlePage = [];
    // Preserve field order, keep unknown existing keys at the end.
    for (const f of FIELDS) {
      const v = (values[f.key] ?? "").trim();
      if (v) tp.push([f.key, v]);
    }
    if ((values["Image"] ?? "").trim()) tp.push(["Image", values["Image"].trim()]);
    for (const [k, v] of titlePage) {
      if (!FIELDS.some((f) => f.key === k) && k !== "Image" && v.trim()) tp.push([k, v]);
    }
    setTitlePage(tp);
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div ref={trapRef} className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("titlePage.title")}>
        <h2 className="modal-title">{t("titlePage.title")}</h2>
        <div className="modal-field">
          <label className="field-label">{t("titlePage.image")}</label>
          <p className="panel-hint" style={{ padding: 0 }}>
            {t("titlePage.imageHint")}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-small" onClick={() => void pickImage()}>
              {t("titlePage.pickImage")}
            </button>
            {values["Image"] && (
              <>
                <span className="edgecode">{values["Image"]}</span>
                <button
                  className="btn btn-small btn-ghost"
                  onClick={() => setValues((v) => ({ ...v, Image: "" }))}
                >
                  {t("titlePage.removeImage")}
                </button>
              </>
            )}
          </div>
        </div>
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
            {t("titlePage.save")}
          </button>
          <button className="btn" onClick={() => setOpen(false)}>
            {t("titlePage.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
