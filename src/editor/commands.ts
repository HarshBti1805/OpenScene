// Element cycling and screenplay-specific editing commands.
//
// Conventions implemented (Final Draft muscle memory):
//   Enter after Scene Heading  -> Action
//   Enter after Action         -> Action (empty action stays action)
//   Enter after Character      -> Dialogue
//   Enter after Parenthetical  -> Dialogue
//   Enter after Dialogue       -> Character (empty dialogue -> Action)
//   Enter after Transition     -> Scene Heading
//   Enter after Shot           -> Action
//   Tab on empty block cycles: action -> character -> parenthetical ->
//     dialogue -> transition -> scene_heading -> shot -> action
//   Tab on Character with text -> Parenthetical below (FD behavior-ish:
//     we simply switch the *next* element flow); implemented as: Tab in a
//     non-empty block converts it along the cycle map below.

import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { NodeType } from "prosemirror-model";
import { schema } from "./schema";
import type { ElementKind } from "../types";

export const ENTER_NEXT: Record<string, ElementKind> = {
  scene_heading: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "character",
  transition: "scene_heading",
  shot: "action",
  act_header: "scene_heading",
  lyrics: "lyrics",
};

export const TAB_CYCLE: Record<string, ElementKind> = {
  action: "character",
  character: "transition",
  transition: "scene_heading",
  scene_heading: "shot",
  shot: "action",
  dialogue: "parenthetical",
  parenthetical: "dialogue",
};

/** Shift-Tab cycles the other way. */
export const TAB_CYCLE_BACK: Record<string, ElementKind> = Object.fromEntries(
  Object.entries(TAB_CYCLE).map(([k, v]) => [v, k as ElementKind]),
) as Record<string, ElementKind>;

function currentBlock(state: EditorState) {
  const { $from } = state.selection;
  const node = $from.parent;
  const pos = $from.before($from.depth);
  return { node, pos, $from };
}

function attrsFor(type: NodeType, dual: string | null) {
  if (type === schema.nodes.scene_heading) {
    return { dual, scene_number: null, synopsis: null, color: null };
  }
  return { dual };
}

/** Convert the current block to `kind`, preserving text. */
export function setElementKind(kind: ElementKind): Command {
  return (state, dispatch) => {
    if (kind === "page_break") return insertPageBreak(state, dispatch);
    const { node, pos } = currentBlock(state);
    if (!node.type.isTextblock) return false;
    if (node.type.name === kind) return true;
    const type = schema.nodes[kind];
    if (dispatch) {
      let tr = state.tr.setNodeMarkup(pos, type, attrsFor(type, node.attrs.dual ?? null));
      tr = autoFormatBlock(tr, pos, kind);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Uppercase transforms for kinds that are conventionally uppercase. */
function autoFormatBlock(tr: Transaction, pos: number, kind: ElementKind): Transaction {
  if (
    kind !== "scene_heading" &&
    kind !== "character" &&
    kind !== "transition" &&
    kind !== "shot" &&
    kind !== "act_header"
  ) {
    return tr;
  }
  const node = tr.doc.nodeAt(pos);
  if (!node) return tr;
  let innerPos = pos + 1;
  node.forEach((child, offset) => {
    if (child.isText && child.text) {
      const upper = child.text.toUpperCase();
      if (upper !== child.text) {
        tr = tr.insertText(upper, innerPos + offset, innerPos + offset + child.text.length);
      }
    }
  });
  return tr;
}

/** Enter: split and give the new block the conventional next kind. */
export const smartEnter: Command = (state, dispatch) => {
  const { node, pos, $from } = currentBlock(state);
  if (!node.type.isTextblock) return false;
  const kind = node.type.name as ElementKind;

  // Empty dialogue/character/parenthetical: convert in place to Action
  // (the "I changed my mind" path).
  if (
    node.content.size === 0 &&
    (kind === "character" || kind === "dialogue" || kind === "parenthetical" || kind === "transition" || kind === "shot")
  ) {
    return setElementKind("action")(state, dispatch);
  }

  const nextKind = ENTER_NEXT[kind] ?? "action";
  const nextType = schema.nodes[nextKind];
  if (dispatch) {
    let tr = state.tr.deleteSelection();
    const splitPos = tr.selection.from;
    tr = tr.split(splitPos, 1, [{ type: nextType, attrs: attrsFor(nextType, null) }]);
    // If we split in the middle of a block, the tail keeps its old type only
    // when splitting mid-text of the same kind; for screenplay flow the tail
    // becomes the next kind too, which `split` already did.
    dispatch(tr.scrollIntoView());
  }
  void pos;
  void $from;
  return true;
};

/** Tab: cycle element type (empty or not). */
export function smartTab(back: boolean): Command {
  return (state, dispatch) => {
    const { node } = currentBlock(state);
    if (!node.type.isTextblock) return false;
    const map = back ? TAB_CYCLE_BACK : TAB_CYCLE;
    const kind = node.type.name as ElementKind;
    // Non-empty character: Tab means "add parenthetical" (FD habit).
    if (!back && kind === "character" && node.content.size > 0) {
      return insertBlockAfter("parenthetical", "()")(state, dispatch);
    }
    const next = map[kind] ?? "action";
    return setElementKind(next)(state, dispatch);
  };
}

/** Insert a new block of `kind` after the current one and put cursor in it. */
export function insertBlockAfter(kind: ElementKind, text = ""): Command {
  return (state, dispatch) => {
    const { node, pos } = currentBlock(state);
    const type = schema.nodes[kind];
    const after = pos + node.nodeSize;
    if (dispatch) {
      const content = text ? schema.text(text) : null;
      let tr = state.tr.insert(after, type.create(attrsFor(type, null), content));
      // Place cursor inside parens for "()" or at end otherwise.
      const target = text === "()" ? after + 2 : after + 1 + text.length;
      tr = tr.setSelection(TextSelection.create(tr.doc, target));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export const insertPageBreak: Command = (state, dispatch) => {
  const { node, pos } = currentBlock(state);
  const after = node.type.isTextblock ? pos + node.nodeSize : state.selection.from;
  if (dispatch) {
    let tr = state.tr.insert(after, schema.nodes.page_break.create());
    const action = schema.nodes.action.create({ dual: null });
    tr = tr.insert(after + 1, action);
    tr = tr.setSelection(TextSelection.create(tr.doc, after + 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Insert an inline note atom at the cursor. */
export function insertNote(category: string, text: string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.type.isTextblock) return false;
    if (dispatch) {
      const note = schema.nodes.note.create({ category, text });
      dispatch(state.tr.replaceSelectionWith(note, false).scrollIntoView());
    }
    return true;
  };
}

/** Toggle dual dialogue on the speech containing the cursor. */
export const toggleDualDialogue: Command = (state, dispatch) => {
  const { node, pos } = currentBlock(state);
  const kind = node.type.name;
  if (kind !== "character" && kind !== "dialogue" && kind !== "parenthetical") return false;

  // Find the speech boundaries: walk block indices in the doc.
  const doc = state.doc;
  const blocks: { node: typeof node; pos: number }[] = [];
  doc.forEach((n, p) => blocks.push({ node: n, pos: p }));
  const idx = blocks.findIndex((b) => b.pos === pos);
  if (idx < 0) return false;

  const isSpeechPart = (name: string) => name === "dialogue" || name === "parenthetical";
  // Start of this speech: the character cue above (or this block).
  let start = idx;
  while (start > 0 && isSpeechPart(blocks[start].node.type.name)) start--;
  if (blocks[start].node.type.name !== "character") return false;
  let end = start + 1;
  while (end < blocks.length && isSpeechPart(blocks[end].node.type.name)) end++;

  const currentlyDual = blocks[start].node.attrs.dual != null;
  if (dispatch) {
    let tr = state.tr;
    if (currentlyDual) {
      // Clear dual on this speech and its partner.
      for (const b of blocks) {
        if (b.node.attrs.dual != null) {
          tr = tr.setNodeMarkup(b.pos, undefined, { ...b.node.attrs, dual: null });
        }
      }
    } else {
      // This speech becomes RIGHT; the previous speech becomes LEFT.
      for (let i = start; i < end; i++) {
        tr = tr.setNodeMarkup(blocks[i].pos, undefined, { ...blocks[i].node.attrs, dual: "right" });
      }
      let pend = start - 1;
      while (pend >= 0 && blocks[pend].node.type.name !== "character" && isSpeechPart(blocks[pend].node.type.name)) pend--;
      // pend should now be a character or not; find previous speech start.
      let pstart = pend;
      while (pstart > 0 && isSpeechPart(blocks[pstart].node.type.name)) pstart--;
      if (pstart >= 0 && blocks[pstart].node.type.name === "character") {
        let pe = pstart + 1;
        tr = tr.setNodeMarkup(blocks[pstart].pos, undefined, { ...blocks[pstart].node.attrs, dual: "left" });
        while (pe < blocks.length && isSpeechPart(blocks[pe].node.type.name)) {
          tr = tr.setNodeMarkup(blocks[pe].pos, undefined, { ...blocks[pe].node.attrs, dual: "left" });
          pe++;
        }
      }
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Backspace at the start of an empty block removes it (joining upward). */
export const backspaceEmptyBlock: Command = (state, dispatch) => {
  const { node, pos, $from } = currentBlock(state);
  if (!node.type.isTextblock) return false;
  if (node.content.size > 0 || $from.parentOffset > 0) return false;
  if (pos === 0) return false;
  const before = state.doc.resolve(pos).nodeBefore;
  if (!before) return false;
  if (dispatch) {
    if (before.type.name === "page_break") {
      dispatch(state.tr.delete(pos - before.nodeSize, pos).scrollIntoView());
    } else {
      // Delete the empty block and put the cursor at the end of the previous.
      let tr = state.tr.delete(pos, pos + node.nodeSize);
      tr = tr.setSelection(TextSelection.create(tr.doc, pos - 1));
      dispatch(tr.scrollIntoView());
    }
  }
  return true;
};

/** Select the whole block containing a given element index (for navigation). */
export function selectionForBlockIndex(state: EditorState, index: number): TextSelection | null {
  let result: TextSelection | null = null;
  let i = 0;
  state.doc.forEach((node, pos) => {
    if (i === index && result === null) {
      const inside = node.type.isTextblock ? pos + 1 : pos;
      result = TextSelection.create(state.doc, Math.min(inside, state.doc.content.size));
    }
    i++;
  });
  return result;
}

export { NodeSelection };
