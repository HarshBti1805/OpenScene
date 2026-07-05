import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../store";
import { t } from "../i18n";

const IS_MAC = navigator.userAgent.includes("Mac");

/**
 * Custom titlebar, seamless with the Backlot chrome.
 * - macOS: native traffic lights overlay (titleBarStyle: Overlay); we only
 *   pad for them and provide the drag region.
 * - Windows/Linux: decorations off; we render min/max/close ourselves.
 */
export function Titlebar() {
  const meta = useApp((s) => s.projectMeta);
  const dirty = useApp((s) => s.dirty);
  const view = useApp((s) => s.view);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (IS_MAC) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized).catch(() => {});
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((fn) => (unlisten = fn))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const win = () => getCurrentWindow();

  return (
    <header className={`titlebar${IS_MAC ? " mac" : ""}`} data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region aria-hidden="true">
        <span className="brand-mark">◨</span> {t("app.name")}
      </div>
      {view !== "start" && meta && (
        <div className="titlebar-doc" data-tauri-drag-region>
          <span aria-hidden="true">/</span>
          <span className="doc-name">{meta.name}</span>
        </div>
      )}
      <div className="titlebar-spacer" data-tauri-drag-region />
      <span className={`titlebar-dirty${dirty ? " on" : ""}`} aria-hidden="true" />
      {!IS_MAC && (
        <div className="winctl">
          <button aria-label={t("titlebar.minimize")} onClick={() => void win().minimize()}>
            ─
          </button>
          <button
            aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
            onClick={() => void win().toggleMaximize()}
          >
            {maximized ? "❐" : "□"}
          </button>
          <button className="close" aria-label={t("titlebar.close")} onClick={() => void win().close()}>
            ✕
          </button>
        </div>
      )}
    </header>
  );
}
