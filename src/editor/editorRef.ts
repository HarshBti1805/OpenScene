// Singleton handle to the live ProseMirror view so panels, the command
// palette, and keyboard shortcuts can drive the editor without prop drilling.

import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Script } from "../types";
import { scriptToDoc } from "./convert";
import type { PaginationHandle } from "./pagination";

let view: EditorView | null = null;
let pagination: PaginationHandle | null = null;

export function setEditorView(v: EditorView | null, p: PaginationHandle | null) {
  view = v;
  pagination = p;
}

export function getEditorView(): EditorView | null {
  return view;
}

export function forceRepaginate() {
  pagination?.force();
}

/** Replace the whole document (reorder, restore, import). Undoable. */
export function replaceEditorScript(script: Script) {
  if (!view) return;
  const doc = scriptToDoc(script);
  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
  view.dispatch(tr);
}

/** Move the cursor into the block with the given element index and scroll. */
export function jumpToElement(index: number) {
  if (!view) return;
  let i = 0;
  let target: number | null = null;
  view.state.doc.forEach((node, pos) => {
    if (i === index && target === null) {
      target = node.type.isTextblock ? pos + 1 : pos;
    }
    i++;
  });
  if (target === null) return;
  const tr = view.state.tr.setSelection(
    TextSelection.create(view.state.doc, Math.min(target, view.state.doc.content.size)),
  );
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Update scene-heading attrs (synopsis, color, number) for element index. */
export function setSceneAttrs(
  index: number,
  attrs: Partial<{ synopsis: string | null; color: string | null; scene_number: string | null }>,
) {
  if (!view) return;
  let i = 0;
  let found: { pos: number; attrs: Record<string, unknown> } | null = null;
  view.state.doc.forEach((node, pos) => {
    if (i === index && node.type.name === "scene_heading" && !found) {
      found = { pos, attrs: node.attrs };
    }
    i++;
  });
  if (!found) return;
  const f = found as { pos: number; attrs: Record<string, unknown> };
  view.dispatch(view.state.tr.setNodeMarkup(f.pos, undefined, { ...f.attrs, ...attrs }));
}
