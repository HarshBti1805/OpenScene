import { useState } from "react";
import { PAGE_FONTS, useApp, type CursorStyle, type ThemePref } from "../store";
import { forceRepaginate } from "../editor/editorRef";
import { saveUserTemplate } from "../templates";
import type { SceneNumbering } from "../types";

/**
 * Format & Appearance.
 *
 * Two strictly separated concepts:
 *  1. Editing appearance — never affects output (page font, zoom, focus,
 *     cursor, theme, typewriter).
 *  2. Script format — affects pagination/output. The Rust engine enforces the
 *     US feature-film standard; its measurements are not parameterized, so
 *     they are surfaced READ-ONLY below. Scene numbering is the engine's one
 *     live format input and is fully editable.
 */

// Mirrors the constants in crates/openscene-core/src/paginate.rs (10 cpi).
const FORMAT_MEASUREMENTS: { element: string; indent: string; width: string; casing: string }[] = [
  { element: "Scene heading", indent: '1.5"', width: '6.0"', casing: "UPPERCASE" },
  { element: "Action", indent: '1.5"', width: '6.0"', casing: "Mixed" },
  { element: "Character cue", indent: '3.7"', width: "—", casing: "UPPERCASE" },
  { element: "Parenthetical", indent: '3.0"', width: '2.5"', casing: "(mixed)" },
  { element: "Dialogue", indent: '2.5"', width: '3.5"', casing: "Mixed" },
  { element: "Transition", indent: 'right-aligned to 7.5"', width: "—", casing: "UPPERCASE" },
  { element: "Page body", indent: '1.0" top/bottom', width: "54 lines", casing: "Courier 12pt" },
];

const THEME_OPTIONS: { id: ThemePref; label: string; page: string; bg: string }[] = [
  { id: "system", label: "System", page: "linear-gradient(105deg, #fdfbf3 50%, #201d16 50%)", bg: "linear-gradient(105deg, #ece5d4 50%, #16130e 50%)" },
  { id: "light", label: "Light", page: "#fdfbf3", bg: "#ece5d4" },
  { id: "dark", label: "Dark", page: "#201d16", bg: "#16130e" },
  { id: "midnight", label: "Midnight", page: "#0e0d0a", bg: "#0a0907" },
];

export function FormatPanel() {
  const isOpen = useApp((s) => s.formatOpen);
  const setOpen = useApp((s) => s.setFormatOpen);
  const [tab, setTab] = useState<"appearance" | "format">("appearance");

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div
        className="modal"
        style={{ width: 640 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Format and appearance settings"
      >
        <h2 className="modal-title">Format &amp; Appearance</h2>
        <div className="format-tabs" role="tablist" aria-label="Settings sections">
          <button
            role="tab"
            aria-selected={tab === "appearance"}
            className={tab === "appearance" ? "active" : ""}
            onClick={() => setTab("appearance")}
          >
            Editing appearance
          </button>
          <button
            role="tab"
            aria-selected={tab === "format"}
            className={tab === "format" ? "active" : ""}
            onClick={() => setTab("format")}
          >
            Script format
          </button>
        </div>
        {tab === "appearance" ? <AppearanceTab /> : <FormatTab />}
        <div className="modal-actions">
          <button className="btn" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="track" aria-hidden="true">
        <span className="thumb" />
      </span>
    </span>
  );
}

function AppearanceTab() {
  const s = useApp();
  const currentFont = PAGE_FONTS.find((f) => f.id === s.pageFont) ?? PAGE_FONTS[0];

  return (
    <div role="tabpanel" aria-label="Editing appearance">
      <p className="panel-hint" style={{ padding: 0, marginTop: 0 }}>
        These settings change how the script looks while you write. Output (PDF, print, FDX) always
        uses industry-standard Courier.
      </p>

      <label className="field-label">Theme</label>
      <div className="theme-swatches" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map((t) => (
          <button
            key={t.id}
            className={`theme-swatch${s.themePref === t.id ? " selected" : ""}`}
            role="radio"
            aria-checked={s.themePref === t.id}
            onClick={() => s.setThemePref(t.id)}
          >
            <span className="swatch-page" style={{ background: t.bg }} aria-hidden="true">
              <span style={{ position: "absolute", inset: 4, borderRadius: 2, background: t.page }} />
            </span>
            <span className="swatch-label">{t.label}</span>
          </button>
        ))}
      </div>

      <label className="field-label">Editor page font</label>
      {!currentFont.standard && (
        <div style={{ marginBottom: 8 }}>
          <span className="badge">Editing view only — output stays Courier</span>
        </div>
      )}
      <div role="radiogroup" aria-label="Editor page font">
        {PAGE_FONTS.map((f) => (
          <button
            key={f.id}
            className={`font-option${s.pageFont === f.id ? " selected" : ""}`}
            role="radio"
            aria-checked={s.pageFont === f.id}
            onClick={() => s.setPageFont(f.id)}
          >
            <span className="font-preview" style={{ fontFamily: f.stack }}>
              INT. WAREHOUSE - NIGHT
            </span>
            <span className="font-name">{f.label}</span>
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="page-zoom">
        Page zoom
      </label>
      <div className="slider-row">
        <input
          id="page-zoom"
          type="range"
          min={0.7}
          max={1.6}
          step={0.05}
          value={s.pageZoom}
          onChange={(e) => s.setPageZoom(Number(e.target.value))}
        />
        <span className="slider-value">{Math.round(s.pageZoom * 100)}%</span>
      </div>

      <div className="setting-row">
        <span>
          Line focus
          <span className="setting-hint">Dim everything except the element you're writing</span>
        </span>
        <Switch checked={s.lineFocus} onChange={s.setLineFocus} label="Line focus dimming" />
      </div>
      <div className="setting-row">
        <span>
          Typewriter scrolling
          <span className="setting-hint">Keep the active line vertically centered</span>
        </span>
        <Switch checked={s.typewriter} onChange={s.setTypewriter} label="Typewriter scrolling" />
      </div>
      <div className="setting-row">
        <span>
          Cursor
          <span className="setting-hint">Caret color on the page</span>
        </span>
        <select
          className="input"
          style={{ width: 130 }}
          value={s.cursorStyle}
          aria-label="Cursor style"
          onChange={(e) => s.setCursorStyle(e.target.value as CursorStyle)}
        >
          <option value="accent">Signal amber</option>
          <option value="ink">Page ink</option>
        </select>
      </div>
    </div>
  );
}

function FormatTab() {
  const s = useApp();
  const [saved, setSaved] = useState(false);
  const numbering = s.sceneNumbering;
  const nonstandard = numbering !== "none";

  const saveTemplate = () => {
    const name = s.projectMeta?.name ?? "My template";
    saveUserTemplate({
      name: `${name} format`,
      description: "Saved format, title page and boilerplate",
      sceneNumbering: s.sceneNumbering,
      titlePage: s.titlePage,
      elements: s.script.elements,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div role="tabpanel" aria-label="Script format">
      <div className="setting-row" style={{ borderBottom: "none", paddingTop: 0 }}>
        <span>
          Format preset
          <span className="setting-hint">Defines measurements, casing and page rules</span>
        </span>
        <span className="badge">US Feature — Standard</span>
      </div>

      <div className="setting-row">
        <span>
          Scene numbering
          <span className="setting-hint">Printed in the page margins (production drafts)</span>
        </span>
        <select
          className="input"
          style={{ width: 130 }}
          value={numbering}
          aria-label="Scene numbering"
          onChange={(e) => {
            s.setSceneNumbering(e.target.value as SceneNumbering);
            forceRepaginate();
          }}
        >
          <option value="none">Off</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="both">Both</option>
        </select>
      </div>

      {nonstandard && (
        <div style={{ margin: "10px 0" }}>
          <span className="badge">Production numbering on — standard for shooting drafts</span>
        </div>
      )}

      <label className="field-label">Element measurements</label>
      <table className="format-table" aria-label="Format measurements (read-only)">
        <thead>
          <tr>
            <th>Element</th>
            <th>Indent</th>
            <th>Width</th>
            <th>Casing</th>
          </tr>
        </thead>
        <tbody>
          {FORMAT_MEASUREMENTS.map((m) => (
            <tr key={m.element}>
              <td>{m.element}</td>
              <td>{m.indent}</td>
              <td>{m.width}</td>
              <td>{m.casing}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="panel-hint" style={{ padding: "8px 0 0" }}>
        Measurements are enforced by the pagination engine and shown read-only: the engine does not
        expose per-element parameterization, which guarantees every OpenScene document paginates
        exactly like Final Draft's US standard. Editable format controls will appear here if the
        engine gains them.
      </p>

      <label className="field-label">Save as template</label>
      <p className="panel-hint" style={{ padding: 0 }}>
        Saves this project's format, title page and current content as a template in the New
        Project gallery.
      </p>
      <button className="btn btn-primary btn-small" onClick={saveTemplate} style={{ marginTop: 8 }}>
        {saved ? "Saved ✓" : "Save current project as template"}
      </button>
    </div>
  );
}
