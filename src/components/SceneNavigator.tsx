import { useState } from "react";
import { useApp, useScenes } from "../store";
import { jumpToElement, replaceEditorScript, setSceneAttrs } from "../editor/editorRef";
import type { Script } from "../types";

const SCENE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", null];

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
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);

  const drop = (to: number) => {
    if (dragFrom === null || dragFrom === to) {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    replaceEditorScript(reorderScenes(script, dragFrom, to));
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <div className="panel" role="navigation" aria-label="Scene navigator">
      <div className="panel-header">Scenes</div>
      <div className="panel-body">
        {scenes.length === 0 && <div className="panel-empty">No scenes yet. Type INT. or EXT. to start one.</div>}
        {scenes.map((scene, i) => (
          <div
            key={`${scene.elementIndex}-${i}`}
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
            onKeyDown={(e) => e.key === "Enter" && jumpToElement(scene.elementIndex)}
            aria-label={`Scene ${scene.number}: ${scene.heading}, page ${scene.page}`}
          >
            <button
              className="scene-color-dot"
              style={{ background: scene.color ?? "transparent", borderColor: scene.color ?? "var(--border)" }}
              aria-label="Set scene color"
              onClick={(e) => {
                e.stopPropagation();
                setColorPickerFor(colorPickerFor === i ? null : i);
              }}
            />
            <div className="scene-item-main">
              <div className="scene-heading-text">
                <span className="scene-num">{scene.number}</span> {scene.heading || "(empty heading)"}
              </div>
              {scene.synopsis && <div className="scene-synopsis">{scene.synopsis}</div>}
            </div>
            <span className="scene-page">p.{scene.page}</span>
            {colorPickerFor === i && (
              <div className="color-picker" onClick={(e) => e.stopPropagation()}>
                {SCENE_COLORS.map((c) => (
                  <button
                    key={String(c)}
                    className="color-swatch"
                    style={{ background: c ?? "transparent" }}
                    aria-label={c ? `Color ${c}` : "No color"}
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
        ))}
      </div>
    </div>
  );
}
