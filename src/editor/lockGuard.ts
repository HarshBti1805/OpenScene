// Locked-script guard: while pagination is locked, deleting a whole locked
// scene inserts an OMITTED placeholder carrying its scene number, so locked
// numbering never silently disappears. Runs only when a lock is active;
// work is O(scenes) only on transactions that removed a heading.

import { Plugin, PluginKey } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "./schema";
import { useApp } from "../store";

export const lockGuardKey = new PluginKey("lockGuard");

function lockedSceneNumbers(): Set<string> {
  const locked = useApp.getState().projectMeta?.locked;
  return new Set(locked?.scenes ?? []);
}

function presentNumbers(doc: PMNode): Map<string, number> {
  const out = new Map<string, number>();
  doc.forEach((node, pos) => {
    if (
      (node.type.name === "scene_heading" || node.type.name === "omitted") &&
      node.attrs.scene_number
    ) {
      out.set(String(node.attrs.scene_number), pos);
    }
  });
  return out;
}

export function lockGuardPlugin(): Plugin {
  return new Plugin({
    key: lockGuardKey,
    appendTransaction(transactions, oldState, newState) {
      if (!useApp.getState().projectMeta?.locked) return null;
      if (!transactions.some((tr) => tr.docChanged && tr.getMeta("addToHistory") !== false)) {
        return null;
      }
      const locked = lockedSceneNumbers();
      if (locked.size === 0) return null;
      const before = presentNumbers(oldState.doc);
      const after = presentNumbers(newState.doc);
      let tr = newState.tr;
      let changed = false;
      for (const [num, oldPos] of before) {
        if (!locked.has(num) || after.has(num)) continue;
        // A locked scene vanished: re-materialize it as OMITTED at the
        // mapped position of its old heading.
        const mapped = transactions.reduce(
          (pos, t) => t.mapping.map(pos),
          Math.min(oldPos, oldState.doc.content.size),
        );
        const at = Math.min(mapped, tr.doc.content.size);
        tr = tr.insert(at, schema.nodes.omitted.create({ scene_number: num }));
        changed = true;
      }
      return changed ? tr : null;
    },
  });
}
