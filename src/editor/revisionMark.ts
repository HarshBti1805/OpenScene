// Revision marking: while a revision set is active, edited blocks get that
// set's mark (a node attr, serialized as [[rev: id]] in Fountain and
// RevisionID in FDX).
//
// Cost profile: only runs when revision mode is ON (an opt-in production
// workflow); work is O(blocks touched by the transaction), typically one.

import { Plugin, PluginKey } from "prosemirror-state";
import { useApp } from "../store";

export const revisionMarkKey = new PluginKey("revisionMark");

export function revisionMarkPlugin(): Plugin {
  return new Plugin({
    key: revisionMarkKey,
    appendTransaction(transactions, _oldState, newState) {
      const active = useApp.getState().projectMeta?.active_revision ?? null;
      if (!active) return null;
      if (!transactions.some((tr) => tr.docChanged && tr.getMeta("addToHistory") !== false)) {
        return null;
      }
      // Collect the block positions touched by the change set.
      const touched = new Set<number>();
      for (const tr of transactions) {
        if (!tr.docChanged) continue;
        for (const map of tr.mapping.maps) {
          map.forEach((_fromA, _toA, fromB, toB) => {
            let pos = fromB;
            while (pos <= Math.min(toB, newState.doc.content.size)) {
              const $pos = newState.doc.resolve(Math.min(pos, newState.doc.content.size));
              if ($pos.depth >= 1) touched.add($pos.before(1));
              const block = $pos.depth >= 1 ? $pos.node(1) : null;
              pos = block ? $pos.before(1) + block.nodeSize : pos + 1;
            }
          });
        }
      }
      if (touched.size === 0) return null;
      let tr = newState.tr;
      let changed = false;
      for (const pos of touched) {
        const node = newState.doc.nodeAt(pos);
        if (!node || !node.type.isTextblock) continue;
        if (node.attrs.revision === active) continue;
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, revision: active });
        changed = true;
      }
      if (!changed) return null;
      // The mark itself shouldn't create separate undo entries.
      tr.setMeta("addToHistory", false);
      return tr;
    },
  });
}
