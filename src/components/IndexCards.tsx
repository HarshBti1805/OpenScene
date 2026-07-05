import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useAsset } from "../ui/useAsset";
import { setSceneImage } from "../editor/editorRef";
import { useApp, useScenes } from "../store";
import { jumpToElement, replaceEditorScript, setSceneAttrs } from "../editor/editorRef";
import { captureFlip, playFlip } from "../ui/flip";
import { reorderScenes } from "./SceneNavigator";
import { applySceneFilter, SceneFilterBar, useSceneDetails } from "./SceneFilter";
import { t } from "../i18n";

export function IndexCards() {
  const scenes = useScenes();
  const script = useApp((s) => s.script);
  const setView = useApp((s) => s.setView);
  const sceneFilter = useApp((s) => s.sceneFilter);
  const details = useSceneDetails(script);
  const visibleScenes = applySceneFilter(scenes, details, sceneFilter);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const drop = (to: number) => {
    if (dragFrom !== null && dragFrom !== to) {
      const snapshot = captureFlip(gridRef.current);
      replaceEditorScript(reorderScenes(script, dragFrom, to));
      requestAnimationFrame(() => playFlip(gridRef.current, snapshot));
    }
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <div className="cards-view view-enter" role="main" aria-label={t("cards.aria")}>
      <div style={{ maxWidth: 720, margin: "0 auto 16px" }}>
        <SceneFilterBar total={scenes.length} shown={visibleScenes.length} />
      </div>
      <div className="cards-grid" ref={gridRef}>
        {scenes.length === 0 && <div className="panel-empty">{t("cards.empty")}</div>}
        {visibleScenes.map((scene) => {
          const i = scenes.indexOf(scene);
          return (
          <div
            key={`${scene.elementIndex}-${i}`}
            data-flip-key={`${scene.number}-${scene.heading}`}
            className={`index-card${dragOver === i ? " drag-over" : ""}`}
            tabIndex={0}
            role="group"
            aria-label={t("cards.cardAria", { number: scene.number, heading: scene.heading })}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                const to = e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : i + 1;
                if (to < 0 || to >= scenes.length) return;
                const snapshot = captureFlip(gridRef.current);
                replaceEditorScript(reorderScenes(script, i, to));
                requestAnimationFrame(() => {
                  playFlip(gridRef.current, snapshot);
                  const items = gridRef.current?.querySelectorAll<HTMLElement>(".index-card");
                  items?.[to]?.focus();
                });
                useApp
                  .getState()
                  .setStatus(t("scenes.moved", { number: scene.number, pos: to + 1, total: scenes.length }));
              }
            }}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
            onDrop={() => drop(i)}
            style={scene.color ? { borderTopColor: scene.color, borderTopWidth: 4 } : undefined}
          >
            <div className="card-header">
              <span className="scene-num">{scene.number}</span>
              <button
                className="card-jump"
                style={{ marginLeft: "auto" }}
                aria-label={t("cards.imageAria", { number: scene.number })}
                data-tip={t("cards.image")}
                onClick={async (e) => {
                  e.stopPropagation();
                  const st = useApp.getState();
                  if (!st.projectPath) return;
                  const picked = await open({
                    multiple: false,
                    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
                  });
                  if (typeof picked !== "string") return;
                  try {
                    const name = await api.importNoteAsset(st.projectPath, picked);
                    setSceneImage(scene.elementIndex, name);
                  } catch (err) {
                    st.setStatus(String(err));
                  }
                }}
              >
                🖼
              </button>
              <button
                className="card-jump"
                onClick={() => {
                  setView("write");
                  // Jump after the editor view mounts.
                  requestAnimationFrame(() => jumpToElement(scene.elementIndex));
                }}
                aria-label={t("cards.goToAria", { number: scene.number })}
              >
                →
              </button>
            </div>
            <div className="card-heading">{scene.heading || t("scenes.emptyHeading")}</div>
            <CardImage elementIndex={scene.elementIndex} />
            <textarea
              className="card-synopsis"
              value={scene.synopsis}
              placeholder={t("cards.synopsisPlaceholder")}
              aria-label={t("cards.synopsisAria", { number: scene.number })}
              onChange={(e) => setSceneAttrs(scene.elementIndex, { synopsis: e.target.value || null })}
            />
            <div className="card-footer">p.{scene.pageLabel}</div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

/** Beat-card image attachment (note category "img" on the heading). */
function CardImage({ elementIndex }: { elementIndex: number }) {
  const projectPath = useApp((s) => s.projectPath);
  const script = useApp((s) => s.script);
  const el = script.elements[elementIndex];
  const name = el?.notes?.find((n) => n.category === "img")?.text ?? null;
  const src = useAsset(projectPath, name);
  if (!src) return null;
  return (
    <div className="card-image-wrap">
      <img src={src} alt="" className="card-image" />
      <button
        className="card-image-remove"
        aria-label={t("cards.removeImage")}
        onClick={(e) => {
          e.stopPropagation();
          setSceneImage(elementIndex, null);
        }}
      >
        ×
      </button>
    </div>
  );
}
