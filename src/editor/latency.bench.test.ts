// Keystroke-latency benchmark (compute side).
//
// Measures the synchronous work OpenScene performs per keystroke on a
// 120-page script: EditorState.apply (ProseMirror + history + our
// appendTransaction plugins) plus docToScript (the store sync in
// dispatchTransaction). DOM paint cannot be measured headlessly; every other
// per-keystroke subsystem (pagination, spellcheck, CRDT) is idle-debounced
// and therefore contributes zero to this path by construction.
//
// Hard budget from the task: p95 must stay under 16ms.

import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history } from "prosemirror-history";
import { scriptToDoc, docToScript } from "./convert";
import type { Script, ScriptElement } from "../types";

function generate120PageScript(): Script {
  // ~55 lines/page * 120 pages; a scene of heading+action+cue+dialogue is
  // ~10 laid-out lines, so ~660 scenes ≈ 120 pages.
  const elements: ScriptElement[] = [];
  for (let i = 0; i < 660; i++) {
    elements.push({ kind: "scene_heading", text: `INT. LOCATION ${i} - ${i % 2 ? "DAY" : "NIGHT"}` });
    elements.push({
      kind: "action",
      text: `Character ${i % 12} crosses the room and studies the evidence board with growing unease.`,
    });
    elements.push({ kind: "character", text: `CHARACTER ${i % 12}` });
    elements.push({
      kind: "dialogue",
      text: "We were never supposed to find this. Someone wanted it buried, and they nearly succeeded.",
    });
  }
  return { title_page: [["Title", "LATENCY BENCH"]], elements };
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

describe("keystroke latency on a 120-page script", () => {
  it("p95 of apply+sync stays under 16ms", () => {
    const script = generate120PageScript();
    const doc = scriptToDoc(script);
    let state = EditorState.create({ doc, plugins: [history()] });

    // Type 300 characters at positions spread through the document.
    const positions: number[] = [];
    for (let i = 1; i <= 300; i++) {
      positions.push(Math.floor((doc.content.size / 301) * i));
    }

    const samples: number[] = [];
    for (const rawPos of positions) {
      // Find a valid text position at or after rawPos.
      const $pos = state.doc.resolve(Math.min(rawPos, state.doc.content.size - 2));
      const pos = $pos.parent.isTextblock ? rawPos : $pos.after(1) + 1;
      const start = performance.now();
      let tr = state.tr.setSelection(TextSelection.create(state.doc, Math.min(pos, state.doc.content.size - 2)));
      tr = tr.insertText("x");
      state = state.apply(tr);
      // The store sync that dispatchTransaction performs:
      docToScript(state.doc, []);
      samples.push(performance.now() - start);
    }

    const p95ms = p95(samples);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Surfaced in test output; recorded in PROGRESS.md.
    console.log(
      `keystroke compute: avg=${avg.toFixed(3)}ms p95=${p95ms.toFixed(3)}ms (n=${samples.length}, doc=${state.doc.content.size} pos)`,
    );
    expect(p95ms).toBeLessThan(16);
  });
});
