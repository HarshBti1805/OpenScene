import { Schema, type NodeSpec } from "prosemirror-model";
import type { ElementKind } from "../types";
import { t } from "../i18n";

/** Block kinds that hold editable text (everything except atoms). */
export const TEXT_KINDS: ElementKind[] = [
  "scene_heading",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "shot",
  "act_header",
  "lyrics",
];

const common = (kind: ElementKind): NodeSpec => ({
  content: "inline*",
  group: "block",
  attrs: {
    dual: { default: null },
    revision: { default: null },
  },
  parseDOM: [{ tag: `div[data-kind="${kind}"]` }],
  toDOM(node) {
    const cls = node.attrs.dual ? ` dual dual-${node.attrs.dual}` : "";
    const attrs: Record<string, string> = {
      "data-kind": kind,
      class: `el el-${kind}${cls}${node.attrs.revision ? " revised" : ""}`,
    };
    if (node.attrs.revision) attrs["data-rev"] = String(node.attrs.revision);
    return ["div", attrs, 0];
  },
});

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    scene_heading: {
      ...common("scene_heading"),
      attrs: {
        dual: { default: null },
        revision: { default: null },
        scene_number: { default: null },
        synopsis: { default: null },
        color: { default: null },
      },
      toDOM(node) {
        const attrs: Record<string, string> = {
          "data-kind": "scene_heading",
          class: `el el-scene_heading${node.attrs.revision ? " revised" : ""}`,
        };
        if (node.attrs.revision) attrs["data-rev"] = String(node.attrs.revision);
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
    act_header: common("act_header"),
    lyrics: common("lyrics"),
    page_break: {
      group: "block",
      atom: true,
      selectable: true,
      parseDOM: [{ tag: 'div[data-kind="page_break"]' }],
      toDOM() {
        return [
          "div",
          { "data-kind": "page_break", class: "el el-page_break", role: "separator", "aria-label": t("editor.pageBreakAria") },
          ["span", {}, t("editor.forcedPageBreak")],
        ];
      },
    },
    // Omitted locked scene: an atom placeholder that keeps its number.
    omitted: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: {
        scene_number: { default: null },
        revision: { default: null },
      },
      parseDOM: [
        {
          tag: 'div[data-kind="omitted"]',
          getAttrs(dom) {
            return { scene_number: (dom as HTMLElement).getAttribute("data-scene") };
          },
        },
      ],
      toDOM(node) {
        return [
          "div",
          {
            "data-kind": "omitted",
            "data-scene": node.attrs.scene_number ?? "",
            class: "el el-omitted",
            role: "note",
            "aria-label": t("editor.omittedAria", { n: String(node.attrs.scene_number ?? "") }),
          },
          ["span", {}, `${node.attrs.scene_number ?? ""}  OMITTED`],
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
            "aria-label": t("editor.noteAria", { text: String(node.attrs.text) }),
          },
          "\u25C6",
        ];
      },
    },
  },
});

export type KindName = ElementKind;
