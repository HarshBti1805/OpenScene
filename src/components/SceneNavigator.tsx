import { useRef, useState } from "react";
import { useApp, useScenes } from "../store";
import { jumpToElement, omitScene, replaceEditorScript, setSceneAttrs } from "../editor/editorRef";
import { captureFlip, playFlip } from "../ui/flip";
import { DocumentsSection } from "./DocumentsSection";
import { applySceneFilter, SceneFilterBar, useSceneDetails } from "./SceneFilter";
import type { Script } from "../types";
import { t } from "../i18n";

// Scene label palette (stored in the .fountain file as data, so these are
// fixed values, not theme tokens): warm production-report hues that read on
// all three Backlot themes.
const SCENE_COLORS = ["#c94f3d", "#d97e2c", "#c9a227", "#7fa650", "#4f7fae", "#9a6fb0", null];

/** Move the whole scene (heading..before next heading) safely by rebuilding
 *  the element array; the editor document is replaced in one undoable step. */
export function reorderScenes(script: Script, fromScene: number, toScene: number): Script {
  const bounds: [number, number][] = [];
  const els = script.elements;
  let start = -1;
  els.forEach((e, i) => {
    if (e.kind === "scene_heading") {
      if (start >= 0) bounds.push([start, i]);
      start = i;
    }
  });
  if (start >= 0) bounds.push([start, els.length]);
  if (fromScene < 0 || fromScene >= bounds.length || toScene < 0 || toScene >= bounds.length) return script;

  const prefix = els.slice(0, bounds[0]?.[0] ?? els.length);
  const sceneSlices = bounds.map(([s, e]) => els.slice(s, e));
  const [moved] = sceneSlices.splice(fromScene, 1);
  sceneSlices.splice(toScene, 0, moved);
  return { ...script, elements: [...prefix, ...sceneSlices.flat()] };
}

export function SceneNavigator() {
  const scenes = useScenes();
  const script = useApp((s) => s.script);
  const locked = useApp((s) => s.projectMeta?.locked ?? null);
  const sceneFilter = useApp((s) => s.sceneFilter);
  const details = useSceneDetails(script);
  const visibleScenes = applySceneFilter(scenes, details, sceneFilter);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const drop = (to: number) => {
    if (dragFrom === null || dragFrom === to) {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    // FLIP: capture positions, reorder, then glide items to their new slots.
    const snapshot = captureFlip(listRef.current);
    replaceEditorScript(reorderScenes(script, dragFrom, to));
    requestAnimationFrame(() => playFlip(listRef.current, snapshot));
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <div className="panel" role="navigation" aria-label={t("panel.scenes")}>
      <DocumentsSection />
      <div className="panel-header">
        {t("panel.scenes")} <span className="edgecode">{String(scenes.length).padStart(3, "0")}</span>
      </div>
      <PinnedRail />
      <SceneFilterBar total={scenes.length} shown={visibleScenes.length} />
      <div className="panel-body" ref={listRef}>
        {scenes.length === 0 && <div className="panel-empty">{t("panel.emptyScenes")}</div>}
        {visibleScenes.map((scene) => {
          const i = scenes.indexOf(scene);
          return (
          <div
            key={`${scene.elementIndex}-${i}`}
            data-flip-key={`${scene.number}-${scene.heading}`}
            className={`scene-item${dragOver === i ? " drag-over" : ""}`}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
            onDrop={() => drop(i)}
            onClick={() => jumpToElement(scene.elementIndex)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpToElement(scene.elementIndex);
              // Keyboard reorder: Alt+ArrowUp/Down moves the scene, with the
              // new position announced via the live status region.
              if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                e.preventDefault();
                const to = e.key === "ArrowUp" ? i - 1 : i + 1;
                if (to < 0 || to >= scenes.length) return;
                const snapshot = captureFlip(listRef.current);
                replaceEditorScript(reorderScenes(script, i, to));
                requestAnimationFrame(() => {
                  playFlip(listRef.current, snapshot);
                  const items = listRef.current?.querySelectorAll<HTMLElement>(".scene-item");
                  items?.[to]?.focus();
                });
                useApp
                  .getState()
                  .setStatus(t("scenes.moved", { number: scene.number, pos: to + 1, total: scenes.length }));
              }
            }}
            aria-label={t("scenes.sceneAria", { number: scene.number, heading: scene.heading, page: scene.pageLabel })}
          >
            <button
              className="scene-color-dot"
              style={{ background: scene.color ?? "transparent", borderColor: scene.color ?? "var(--border)" }}
              aria-label={t("scenes.setColor")}
              onClick={(e) => {
                e.stopPropagation();
                setColorPickerFor(colorPickerFor === i ? null : i);
              }}
            />
            <div className="scene-item-main">
              <div className={`scene-heading-text${scene.omitted ? " omitted" : ""}`}>
                <span className="scene-num">{scene.number}</span> {scene.heading || t("scenes.emptyHeading")}
              </div>
              {scene.synopsis && <div className="scene-synopsis">{scene.synopsis}</div>}
            </div>
            <button
              className="scene-pin"
              aria-label={t("pins.toggleScene", { number: scene.number })}
              aria-pressed={(useApp.getState().projectMeta?.pins ?? []).includes(`scene:${scene.number}`)}
              onClick={(e) => {
                e.stopPropagation();
                void useApp.getState().togglePin(`scene:${scene.number}`);
              }}
            >
              {(useApp.getState().projectMeta?.pins ?? []).includes(`scene:${scene.number}`) ? "★" : "☆"}
            </button>
            {locked && !scene.omitted && (
              <button
                className="scene-omit"
                aria-label={t("scenes.omitAria", { number: scene.number })}
                data-tip={t("scenes.omit")}
                onClick={(e) => {
                  e.stopPropagation();
                  omitScene(scene.elementIndex, scene.number);
                }}
              >
                ⊘
              </button>
            )}
            <span className={`scene-page${scene.pageLabel !== String(scene.page) ? " a-page" : ""}`}>
              p.{scene.pageLabel}
            </span>
            {colorPickerFor === i && (
              <div className="color-picker" onClick={(e) => e.stopPropagation()}>
                {SCENE_COLORS.map((c) => (
                  <button
                    key={String(c)}
                    className="color-swatch"
                    style={{ background: c ?? "transparent" }}
                    aria-label={c ? t("scenes.colorAria", { color: c }) : t("scenes.noColor")}
                    onClick={() => {
                      setSceneAttrs(scene.elementIndex, { color: c });
                      setColorPickerFor(null);
                    }}
                  >
                    {c === null && "×"}
                  </button>
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/** Quick-access rail of pinned scenes and notes. */
function PinnedRail() {
  const pins = useApp((s) => s.projectMeta?.pins ?? []);
  const scenes = useScenes();
  if (pins.length === 0) return null;
  return (
    <div className="pinned-rail" role="group" aria-label={t("pins.aria")}>
      {pins.map((pin) => {
        const [kind, ...rest] = pin.split(":");
        const ref = rest.join(":");
        const label = kind === "scene" ? t("pins.scene", { number: ref }) : ref;
        return (
          <button
            key={pin}
            className="pin-chip"
            aria-label={t("pins.jumpAria", { name: label })}
            onClick={() => {
              const st = useApp.getState();
              if (kind === "scene") {
                const target = scenes.find((sc) => sc.number === ref);
                if (target) {
                  st.setView("write");
                  requestAnimationFrame(() => jumpToElement(target.elementIndex));
                }
              } else if (kind === "note") {
                st.openNoteDoc(ref);
              }
            }}
          >
            ★ {label}
          </button>
        );
      })}
    </div>
  );
}
