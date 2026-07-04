// Lossless conversion between the Script JSON model (shared with Rust)
// and the ProseMirror document. One script element = one block node; hard
// newlines inside an element are `hard_break` inline nodes; inline notes are
// atom nodes whose offsets are derived from the surrounding text.

import { Node as PMNode } from "prosemirror-model";
import { schema } from "./schema";
import type { ElementKind, Note, Script, ScriptElement, TitlePage } from "../types";

/** Build inline content: text + hard breaks, with note atoms at char offsets. */
function inlineContent(text: string, notes: Note[]): PMNode[] {
  const out: PMNode[] = [];
  const chars = Array.from(text);
  const sorted = [...notes].sort((a, b) => a.offset - b.offset);
  let noteIdx = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push(schema.text(buf));
      buf = "";
    }
  };
  for (let i = 0; i <= chars.length; i++) {
    while (noteIdx < sorted.length && sorted[noteIdx].offset === i) {
      flush();
      out.push(
        schema.nodes.note.create({
          category: sorted[noteIdx].category,
          text: sorted[noteIdx].text,
        }),
      );
      noteIdx++;
    }
    if (i === chars.length) break;
    if (chars[i] === "\n") {
      flush();
      out.push(schema.nodes.hard_break.create());
    } else {
      buf += chars[i];
    }
  }
  flush();
  return out;
}

function elementToNode(e: ScriptElement): PMNode {
  if (e.kind === "page_break") return schema.nodes.page_break.create();
  const attrs: Record<string, unknown> = { dual: e.dual ?? null };
  if (e.kind === "scene_heading") {
    attrs.scene_number = e.scene_number ?? null;
    attrs.synopsis = e.synopsis ?? null;
    attrs.color = e.color ?? null;
  }
  return schema.nodes[e.kind].create(attrs, inlineContent(e.text, e.notes ?? []));
}

export function scriptToDoc(script: Script): PMNode {
  const blocks = script.elements.map(elementToNode);
  if (blocks.length === 0) {
    blocks.push(schema.nodes.action.create({ dual: null }));
  }
  return schema.nodes.doc.create({}, blocks);
}

export function nodeToElement(node: PMNode): ScriptElement {
  if (node.type.name === "page_break") return { kind: "page_break", text: "" };
  let text = "";
  const notes: Note[] = [];
  node.forEach((child) => {
    if (child.type.name === "note") {
      notes.push({
        offset: Array.from(text).length,
        category: child.attrs.category as string,
        text: child.attrs.text as string,
      });
    } else if (child.type.name === "hard_break") {
      text += "\n";
    } else {
      text += child.text ?? "";
    }
  });
  const el: ScriptElement = { kind: node.type.name as ElementKind, text };
  if (node.attrs.dual) el.dual = node.attrs.dual;
  if (notes.length) el.notes = notes;
  if (node.type.name === "scene_heading") {
    if (node.attrs.scene_number) el.scene_number = node.attrs.scene_number;
    if (node.attrs.synopsis) el.synopsis = node.attrs.synopsis;
    if (node.attrs.color) el.color = node.attrs.color;
  }
  return el;
}

export function docToScript(doc: PMNode, titlePage: TitlePage): Script {
  const elements: ScriptElement[] = [];
  doc.forEach((node) => {
    elements.push(nodeToElement(node));
  });
  // Drop trailing empty action blocks (editor scratch space).
  while (elements.length > 0) {
    const last = elements[elements.length - 1];
    if (last.kind === "action" && last.text === "" && !last.notes?.length) {
      elements.pop();
    } else break;
  }
  return { title_page: titlePage, elements };
}
