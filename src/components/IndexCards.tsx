import { useRef, useState } from "react";
import { useApp, useScenes } from "../store";
import { jumpToElement, replaceEditorScript, setSceneAttrs } from "../editor/editorRef";
import { captureFlip, playFlip } from "../ui/flip";
import { reorderScenes } from "./SceneNavigator";

export function IndexCards() {
  const scenes = useScenes();
  const script = useApp((s) => s.script);
  const setView = useApp((s) => s.setView);
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
    <div className="cards-view view-enter" role="main" aria-label="Index cards">
      <div className="cards-grid" ref={gridRef}>
        {scenes.length === 0 && <div className="panel-empty">No scenes yet.</div>}
        {scenes.map((scene, i) => (
          <div
            key={`${scene.elementIndex}-${i}`}
            data-flip-key={`${scene.number}-${scene.heading}`}
            className={`index-card${dragOver === i ? " drag-over" : ""}`}
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
                onClick={() => {
                  setView("write");
                  // Jump after the editor view mounts.
                  requestAnimationFrame(() => jumpToElement(scene.elementIndex));
                }}
                aria-label={`Go to scene ${scene.number} in script`}
              >
                →
              </button>
            </div>
            <div className="card-heading">{scene.heading || "(empty heading)"}</div>
            <textarea
              className="card-synopsis"
              value={scene.synopsis}
              placeholder="Synopsis…"
              aria-label={`Synopsis for scene ${scene.number}`}
              onChange={(e) => setSceneAttrs(scene.elementIndex, { synopsis: e.target.value || null })}
            />
            <div className="card-footer">p.{scene.page}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
