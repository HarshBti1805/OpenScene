// Singleton handle to the live ProseMirror view so panels, the command
// palette, and keyboard shortcuts can drive the editor without prop drilling.

import { TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
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

/** Replace a scene (heading through the element before the next heading)
 *  with an OMITTED placeholder that keeps its locked number. */
export function omitScene(index: number, sceneNumber: string) {
  if (!view) return;
  const blocks: { pos: number; end: number; name: string }[] = [];
  view.state.doc.forEach((node, pos) => {
    blocks.push({ pos, end: pos + node.nodeSize, name: node.type.name });
  });
  if (index < 0 || index >= blocks.length) return;
  const start = blocks[index].pos;
  let end = view.state.doc.content.size;
  for (let bi = index + 1; bi < blocks.length; bi++) {
    if (blocks[bi].name === "scene_heading" || blocks[bi].name === "omitted") {
      end = blocks[bi].pos;
      break;
    }
  }
  const omitted = view.state.schema.nodes.omitted.create({ scene_number: sceneNumber });
  view.dispatch(view.state.tr.replaceWith(start, end, omitted).scrollIntoView());
}

/** Attach an image note (category "img") to a scene heading. */
export function setSceneImage(index: number, assetName: string | null) {
  if (!view) return;
  let i = 0;
  let target: { pos: number; node: PMNode } | null = null;
  view.state.doc.forEach((node, pos) => {
    if (i === index && node.type.name === "scene_heading" && !target) {
      target = { pos, node };
    }
    i++;
  });
  if (!target) return;
  const { pos, node } = target as { pos: number; node: PMNode };
  let tr = view.state.tr;
  // Remove any existing img note.
  const removals: [number, number][] = [];
  node.forEach((child, offset) => {
    if (child.type.name === "note" && child.attrs.category === "img") {
      removals.push([pos + 1 + offset, pos + 1 + offset + child.nodeSize]);
    }
  });
  for (const [from, to] of removals.reverse()) {
    tr = tr.delete(from, to);
  }
  if (assetName) {
    const end = tr.mapping.map(pos + node.nodeSize - 1);
    tr = tr.insert(end, view.state.schema.nodes.note.create({ category: "img", text: assetName }));
  }
  view.dispatch(tr);
}

/** Cycle a dialogue block's text with its [[alt: …]] alternates. */
export function cycleAlternate(): boolean {
  if (!view) return false;
  const { $from } = view.state.selection;
  if ($from.depth < 1) return false;
  const node = $from.node(1);
  const pos = $from.before(1);
  if (node.type.name !== "dialogue" && node.type.name !== "lyrics") return false;
  // First alt note in the block.
  let alt: { offset: number; node: PMNode } | null = null;
  let text = "";
  node.forEach((child, offset) => {
    if (child.type.name === "note" && child.attrs.category === "alt" && !alt) {
      alt = { offset, node: child };
    } else if (child.isText) {
      text += child.text ?? "";
    }
  });
  if (!alt) return false;
  const a = alt as { offset: number; node: PMNode };
  // Swap: block text <-> alt text; the old text becomes the (last) alt so
  // repeated cycling rotates through all takes.
  const altText = String(a.node.attrs.text);
  const nodes: PMNode[] = [];
  if (altText) nodes.push(view.state.schema.text(altText));
  node.forEach((child) => {
    if (child.type.name === "note") {
      if (child === a.node) return; // consumed
      nodes.push(child);
    }
  });
  nodes.push(view.state.schema.nodes.note.create({ category: "alt", text }));
  const tr = view.state.tr.replaceWith(pos + 1, pos + node.nodeSize - 1, nodes);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Store the current dialogue text as a new alternate take (keeps text). */
export function addAlternate(): boolean {
  if (!view) return false;
  const { $from } = view.state.selection;
  if ($from.depth < 1) return false;
  const node = $from.node(1);
  const pos = $from.before(1);
  if (node.type.name !== "dialogue" && node.type.name !== "lyrics") return false;
  let text = "";
  node.forEach((child) => {
    if (child.isText) text += child.text ?? "";
  });
  if (!text.trim()) return false;
  const note = view.state.schema.nodes.note.create({ category: "alt", text });
  view.dispatch(view.state.tr.insert(pos + node.nodeSize - 1, note).scrollIntoView());
  return true;
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
