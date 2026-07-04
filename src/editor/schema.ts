import { Schema, type NodeSpec } from "prosemirror-model";
import type { ElementKind } from "../types";

/** Block kinds that hold editable text (everything except page_break). */
export const TEXT_KINDS: ElementKind[] = [
  "scene_heading",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "shot",
];

const common = (kind: ElementKind): NodeSpec => ({
  content: "inline*",
  group: "block",
  attrs: {
    dual: { default: null },
  },
  parseDOM: [{ tag: `div[data-kind="${kind}"]` }],
  toDOM(node) {
    const cls = node.attrs.dual ? ` dual dual-${node.attrs.dual}` : "";
    return ["div", { "data-kind": kind, class: `el el-${kind}${cls}` }, 0];
  },
});

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    scene_heading: {
      ...common("scene_heading"),
      attrs: {
        dual: { default: null },
        scene_number: { default: null },
        synopsis: { default: null },
        color: { default: null },
      },
      toDOM(node) {
        const attrs: Record<string, string> = {
          "data-kind": "scene_heading",
          class: "el el-scene_heading",
        };
        if (node.attrs.color) {
          attrs.style = `box-shadow: inset 4px 0 0 ${node.attrs.color}`;
        }
        return ["div", attrs, 0];
      },
    },
    action: common("action"),
    character: common("character"),
    parenthetical: common("parenthetical"),
    dialogue: common("dialogue"),
    transition: common("transition"),
    shot: common("shot"),
    page_break: {
      group: "block",
      atom: true,
      selectable: true,
      parseDOM: [{ tag: 'div[data-kind="page_break"]' }],
      toDOM() {
        return [
          "div",
          { "data-kind": "page_break", class: "el el-page_break", role: "separator", "aria-label": "Forced page break" },
          ["span", {}, "FORCED PAGE BREAK"],
        ];
      },
    },
    text: { group: "inline" },
    // Hard line break inside an element (Fountain multi-line action/dialogue).
    hard_break: {
      group: "inline",
      inline: true,
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM() {
        return ["br"];
      },
    },
    // Inline anchored script note. Atom: contributes no text content, so
    // Fountain/FDX offsets are derived from surrounding text automatically.
    note: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,
      attrs: {
        category: { default: "note" },
        text: { default: "" },
      },
      parseDOM: [
        {
          tag: "span[data-note]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return {
              category: el.getAttribute("data-category") ?? "note",
              text: el.getAttribute("data-note") ?? "",
            };
          },
        },
      ],
      toDOM(node) {
        return [
          "span",
          {
            "data-note": node.attrs.text,
            "data-category": node.attrs.category,
            class: `inline-note note-${node.attrs.category}`,
            title: `${node.attrs.category}: ${node.attrs.text}`,
            role: "note",
            "aria-label": `Script note: ${node.attrs.text}`,
          },
          "\u25C6",
        ];
      },
    },
  },
});

export type KindName = ElementKind;
