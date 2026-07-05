import { useState } from "react";
import { api } from "../api";
import {
  ACCENTS,
  PAGE_FONTS,
  THEMES,
  useApp,
  type CursorStyle,
  type MotionPref,
  type ThemePref,
  type UiDensity,
} from "../store";
import { forceRepaginate } from "../editor/editorRef";
import { saveUserTemplate } from "../templates";
import { defaultFormatSpec, type ElementFormat, type FormatSpec, type SceneNumbering } from "../types";
import { t } from "../i18n";
import { useFocusTrap } from "../ui/useFocusTrap";

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

/** Element rows of the format editor (keys into FormatSpec). */
const FORMAT_ELEMENTS: { key: keyof Pick<FormatSpec, "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition" | "shot" | "act_header" | "lyrics">; labelKey: string }[] = [
  { key: "scene_heading", labelKey: "format.elScene" },
  { key: "action", labelKey: "format.elAction" },
  { key: "character", labelKey: "format.elCharacter" },
  { key: "parenthetical", labelKey: "format.elParen" },
  { key: "dialogue", labelKey: "format.elDialogue" },
  { key: "transition", labelKey: "format.elTransition" },
  { key: "shot", labelKey: "format.elShot" },
  { key: "act_header", labelKey: "format.elAct" },
  { key: "lyrics", labelKey: "format.elLyrics" },
];

const THEME_OPTIONS: { id: ThemePref; label: string; page: string; bg: string }[] = [
  {
    id: "system",
    label: t("format.themeSystem"),
    page: "linear-gradient(105deg, #fdfbf3 50%, #201d16 50%)",
    bg: "linear-gradient(105deg, #ece5d4 50%, #16130e 50%)",
  },
  ...THEMES.map((th) => ({ id: th.id as ThemePref, label: t(th.labelKey), page: th.page, bg: th.bg })),
];

export function FormatPanel() {
  const isOpen = useApp((s) => s.formatOpen);
  const setOpen = useApp((s) => s.setFormatOpen);
  const [tab, setTab] = useState<"appearance" | "format">("appearance");
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen, () => setOpen(false));

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)} role="presentation">
      <div
        ref={trapRef}
        className="modal"
        style={{ width: 640 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("format.title")}
      >
        <h2 className="modal-title">{t("format.title")}</h2>
        <div className="format-tabs" role="tablist" aria-label={t("format.tabs")}>
          <button
            role="tab"
            aria-selected={tab === "appearance"}
            className={tab === "appearance" ? "active" : ""}
            onClick={() => setTab("appearance")}
          >
            {t("format.tabAppearance")}
          </button>
          <button
            role="tab"
            aria-selected={tab === "format"}
            className={tab === "format" ? "active" : ""}
            onClick={() => setTab("format")}
          >
            {t("format.tabFormat")}
          </button>
        </div>
        {tab === "appearance" ? <AppearanceTab /> : <FormatTab />}
        <div className="modal-actions">
          <button className="btn" onClick={() => setOpen(false)}>
            {t("format.done")}
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
    <div role="tabpanel" aria-label={t("format.tabAppearance")}>
      <p className="panel-hint" style={{ padding: 0, marginTop: 0 }}>
        {t("format.appearanceHint")}
      </p>

      <label className="field-label">{t("format.theme")}</label>
      <div className="theme-swatches" role="radiogroup" aria-label={t("format.theme")}>
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

      <label className="field-label">{t("format.accent")}</label>
      <div className="accent-swatches" role="radiogroup" aria-label={t("format.accent")}>
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            className={`accent-swatch${s.accent === a.id ? " selected" : ""}`}
            role="radio"
            aria-checked={s.accent === a.id}
            aria-label={t(a.labelKey)}
            title={t(a.labelKey)}
            onClick={() => s.setAccent(a.id)}
          >
            {a.id === "signal" ? (
              <span className="accent-dot accent-dot-signal" aria-hidden="true" />
            ) : (
              <span className="accent-dot" style={{ background: a.swatch }} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      <p className="panel-hint" style={{ padding: 0, marginTop: 4 }}>
        {t("format.accentHint")}
      </p>

      <label className="field-label">{t("format.pageFont")}</label>
      {!currentFont.standard && (
        <div style={{ marginBottom: 8 }}>
          <span className="badge">{t("format.editingOnlyBadge")}</span>
        </div>
      )}
      <div role="radiogroup" aria-label={t("format.pageFont")}>
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
        {t("format.pageZoom")}
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
          {t("format.lineFocus")}
          <span className="setting-hint">{t("format.lineFocusHint")}</span>
        </span>
        <Switch checked={s.lineFocus} onChange={s.setLineFocus} label={t("format.lineFocus")} />
      </div>
      <div className="setting-row">
        <span>
          {t("format.typewriter")}
          <span className="setting-hint">{t("format.typewriterHint")}</span>
        </span>
        <Switch checked={s.typewriter} onChange={s.setTypewriter} label={t("format.typewriter")} />
      </div>
      <div className="setting-row">
        <span>
          {t("format.cursor")}
          <span className="setting-hint">{t("format.cursorHint")}</span>
        </span>
        <select
          className="input"
          style={{ width: 130 }}
          value={s.cursorStyle}
          aria-label={t("format.cursor")}
          onChange={(e) => s.setCursorStyle(e.target.value as CursorStyle)}
        >
          <option value="accent">{t("format.cursorAmber")}</option>
          <option value="ink">{t("format.cursorInk")}</option>
        </select>
      </div>
      <div className="setting-row">
        <span>
          {t("format.density")}
          <span className="setting-hint">{t("format.densityHint")}</span>
        </span>
        <select
          className="input"
          style={{ width: 130 }}
          value={s.uiDensity}
          aria-label={t("format.density")}
          onChange={(e) => s.setUiDensity(e.target.value as UiDensity)}
        >
          <option value="comfortable">{t("format.densityComfortable")}</option>
          <option value="compact">{t("format.densityCompact")}</option>
        </select>
      </div>
      <div className="setting-row">
        <span>
          {t("format.motion")}
          <span className="setting-hint">{t("format.motionHint")}</span>
        </span>
        <Switch
          checked={s.motionPref === "reduced"}
          onChange={(b) => s.setMotionPref(b ? ("reduced" as MotionPref) : "full")}
          label={t("format.motion")}
        />
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
      description: t("format.userTemplateDesc"),
      sceneNumbering: s.sceneNumbering,
      titlePage: s.titlePage,
      elements: s.script.elements,
      format: s.projectMeta?.format ?? null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div role="tabpanel" aria-label={t("format.tabFormat")}>
      <div className="setting-row" style={{ borderBottom: "none", paddingTop: 0 }}>
        <span>
          {t("format.preset")}
          <span className="setting-hint">{t("format.presetHint")}</span>
        </span>
        <span className="badge">
          {s.projectMeta?.format ? t("format.presetCustom") : t("format.presetBadge")}
        </span>
      </div>

      <div className="setting-row">
        <span>
          {t("format.numbering")}
          <span className="setting-hint">{t("format.numberingHint")}</span>
        </span>
        <select
          className="input"
          style={{ width: 130 }}
          value={numbering}
          aria-label={t("format.numbering")}
          onChange={(e) => {
            // Format change is a milestone: back up, then apply.
            void useApp.getState().milestoneBackup("format change");
            s.setSceneNumbering(e.target.value as SceneNumbering);
            forceRepaginate();
          }}
        >
          <option value="none">{t("format.numberingOff")}</option>
          <option value="left">{t("format.numberingLeft")}</option>
          <option value="right">{t("format.numberingRight")}</option>
          <option value="both">{t("format.numberingBoth")}</option>
        </select>
      </div>

      {nonstandard && (
        <div style={{ margin: "10px 0" }}>
          <span className="badge">{t("format.numberingBadge")}</span>
        </div>
      )}

      <FormatEditor />

      <label className="field-label">{t("format.saveTemplate")}</label>
      <p className="panel-hint" style={{ padding: 0 }}>
        {t("format.saveTemplateHint")}
      </p>
      <button className="btn btn-primary btn-small" onClick={saveTemplate} style={{ marginTop: 8 }}>
        {saved ? t("format.savedTemplate") : t("format.saveTemplateBtn")}
      </button>
    </div>
  );
}

/** Editable format editor: the engine is fully parameterized, so every
 *  measurement edits live with a repaginate; a Non-standard badge shows
 *  whenever the format differs from the US Feature default. */
function FormatEditor() {
  const projectPath = useApp((s) => s.projectPath);
  const projectMeta = useApp((s) => s.projectMeta);
  const format = projectMeta?.format ?? null;
  const effective: FormatSpec = format ?? defaultFormatSpec();
  const isStandard = format === null || JSON.stringify(format) === JSON.stringify(defaultFormatSpec());

  const apply = async (next: FormatSpec | null) => {
    if (!projectPath || !projectMeta) return;
    const meta = { ...projectMeta, format: next };
    useApp.setState({ projectMeta: meta });
    await api.saveProjectMeta(projectPath, meta).catch(() => {});
    forceRepaginate();
  };

  const edit = (patch: (f: FormatSpec) => void) => {
    const next: FormatSpec = JSON.parse(JSON.stringify(effective));
    patch(next);
    void apply(next);
  };

  const setEl = (key: (typeof FORMAT_ELEMENTS)[number]["key"], field: keyof ElementFormat, value: number | boolean | string) => {
    edit((f) => {
      (f[key] as ElementFormat)[field] = value as never;
    });
  };

  return (
    <div>
      <div className="setting-row" style={{ borderBottom: "none" }}>
        <span>
          {t("format.measurements")}
          <span className="setting-hint">{t("format.editableHint")}</span>
        </span>
        {isStandard ? (
          <span className="badge">{t("format.standardBadge")}</span>
        ) : (
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="badge warn">{t("format.nonStandardBadge")}</span>
            <button className="btn btn-small" onClick={() => void apply(null)}>
              {t("format.reset")}
            </button>
          </span>
        )}
      </div>
      <table className="format-table" aria-label={t("format.measurementsAria")}>
        <thead>
          <tr>
            <th>{t("format.colElement")}</th>
            <th>{t("format.colIndent")}</th>
            <th>{t("format.colWidth")}</th>
            <th>{t("format.colCasing")}</th>
            <th>{t("format.colAlign")}</th>
            <th>{t("format.colSpacing")}</th>
          </tr>
        </thead>
        <tbody>
          {FORMAT_ELEMENTS.map((row) => {
            const ef = effective[row.key];
            return (
              <tr key={row.key}>
                <td>{t(row.labelKey)}</td>
                <td>
                  <input
                    type="number"
                    className="input fmt-num"
                    min={0}
                    max={80}
                    value={ef.indent_cols}
                    aria-label={`${t(row.labelKey)} ${t("format.colIndent")}`}
                    onChange={(e) => setEl(row.key, "indent_cols", Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="input fmt-num"
                    min={5}
                    max={85}
                    value={ef.width_cols}
                    aria-label={`${t(row.labelKey)} ${t("format.colWidth")}`}
                    onChange={(e) => setEl(row.key, "width_cols", Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={ef.uppercase}
                    aria-label={`${t(row.labelKey)} ${t("format.colCasing")}`}
                    onChange={(e) => setEl(row.key, "uppercase", e.target.checked)}
                  />
                </td>
                <td>
                  <select
                    className="input fmt-align"
                    value={ef.align}
                    aria-label={`${t(row.labelKey)} ${t("format.colAlign")}`}
                    onChange={(e) => setEl(row.key, "align", e.target.value)}
                  >
                    <option value="left">L</option>
                    <option value="center">C</option>
                    <option value="right">R</option>
                  </select>
                </td>
                <td>
                  {row.key === "dialogue" ? (
                    <select
                      className="input fmt-align"
                      value={ef.line_spacing}
                      aria-label={t("format.dialogueSpacing")}
                      onChange={(e) => setEl(row.key, "line_spacing", Number(e.target.value))}
                    >
                      <option value={1}>1×</option>
                      <option value={2}>2×</option>
                    </select>
                  ) : (
                    <input
                      type="number"
                      className="input fmt-num"
                      min={0}
                      max={5}
                      value={ef.space_before}
                      aria-label={`${t(row.labelKey)} ${t("format.colSpacing")}`}
                      onChange={(e) => setEl(row.key, "space_before", Number(e.target.value))}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="setting-row">
        <span>{t("format.scenePerPage")}</span>
        <Switch
          checked={effective.scene_per_page}
          onChange={(b) => edit((f) => void (f.scene_per_page = b))}
          label={t("format.scenePerPage")}
        />
      </div>
      <div className="setting-row">
        <span>{t("format.letteredScenes")}</span>
        <Switch
          checked={effective.lettered_scenes}
          onChange={(b) => edit((f) => void (f.lettered_scenes = b))}
          label={t("format.letteredScenes")}
        />
      </div>
      <div className="setting-row">
        <span>
          {t("format.minutesPerPage")}
          <span className="setting-hint">{t("format.minutesPerPageHint")}</span>
        </span>
        <input
          type="number"
          className="input fmt-num"
          step={0.25}
          min={0.25}
          max={3}
          value={effective.minutes_per_page}
          aria-label={t("format.minutesPerPage")}
          onChange={(e) => edit((f) => void (f.minutes_per_page = Number(e.target.value)))}
        />
      </div>
    </div>
  );
}
