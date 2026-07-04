// Line-focus dimming: marks the block containing the caret with
// `focus-active` so CSS can dim the rest (opacity only, compositor-friendly).
//
// Latency guard: the decoration set is rebuilt ONLY when the caret moves to a
// different block (or the feature toggles), never on keystrokes within the
// same block. When the feature is off the plugin stores an empty set and does
// no per-transaction work beyond one integer comparison.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export const lineFocusKey = new PluginKey<LineFocusState>("lineFocus");

interface LineFocusState {
  enabled: boolean;
  /** Doc position of the active block (its `before` position), or -1. */
  blockPos: number;
  decorations: DecorationSet;
}

function activeBlockPos(selDepthFrom: { depth: number; before: (d: number) => number }): number {
  try {
    return selDepthFrom.depth >= 1 ? selDepthFrom.before(1) : -1;
  } catch {
    return -1;
  }
}

export function lineFocusPlugin(isEnabled: () => boolean): Plugin {
  return new Plugin<LineFocusState>({
    key: lineFocusKey,
    state: {
      init: () => ({ enabled: isEnabled(), blockPos: -1, decorations: DecorationSet.empty }),
      apply(tr, value, _old, newState) {
        const enabled = isEnabled();
        const pos = enabled ? activeBlockPos(newState.selection.$from) : -1;
        // Fast path: nothing changed that affects the decoration.
        if (enabled === value.enabled && pos === value.blockPos && !tr.docChanged) {
          return value;
        }
        if (!enabled) {
          return { enabled, blockPos: -1, decorations: DecorationSet.empty };
        }
        if (pos < 0) {
          return { enabled, blockPos: -1, decorations: DecorationSet.empty };
        }
        // Rebuild: a single node decoration, O(1) work (opt-in feature only).
        const node = newState.doc.nodeAt(pos);
        if (!node) return { enabled, blockPos: -1, decorations: DecorationSet.empty };
        const deco = Decoration.node(pos, pos + node.nodeSize, { class: "focus-active" });
        return {
          enabled,
          blockPos: pos,
          decorations: DecorationSet.create(newState.doc, [deco]),
        };
      },
    },
    props: {
      decorations(state) {
        return lineFocusKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}
