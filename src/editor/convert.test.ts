// scriptToDoc / docToScript must be exact inverses for every document the
// app can hold. This is the TS half of the round-trip chain (the Rust half
// is fountain::parse/serialize, tested in the core crate).

import { describe, expect, it } from "vitest";
import { docToScript, scriptToDoc } from "./convert";
import type { Script, ScriptElement } from "../types";

function el(kind: ScriptElement["kind"], text: string, extra: Partial<ScriptElement> = {}): ScriptElement {
  return { kind, text, ...extra };
}

const fixtures: Record<string, Script> = {
  simple: {
    title_page: [["Title", "TEST"]],
    elements: [
      el("scene_heading", "INT. LAB - NIGHT"),
      el("action", "Sparks fly."),
      el("character", "MAYA"),
      el("dialogue", "It's alive."),
    ],
  },
  dualDialogue: {
    title_page: [],
    elements: [
      el("character", "MAYA", { dual: "left" }),
      el("dialogue", "Go left!", { dual: "left" }),
      el("character", "JONES", { dual: "right" }),
      el("parenthetical", "(shouting)", { dual: "right" }),
      el("dialogue", "Go right!", { dual: "right" }),
    ],
  },
  notes: {
    title_page: [],
    elements: [
      el("action", "Maya opens the door slowly.", {
        notes: [
          { offset: 0, category: "note", text: "opening image" },
          { offset: 15, category: "fix", text: "check continuity" },
          { offset: 27, category: "idea", text: "slam it instead?" },
        ],
      }),
      el("dialogue", "", { notes: [{ offset: 0, category: "note", text: "note in empty" }] }),
      el("action", "The end."),
    ],
  },
  revisionMarks: {
    title_page: [],
    elements: [
      el("scene_heading", "EXT. STREET - DAY", { revision: "rev-1" }),
      el("action", "Rain.", { revision: "rev-1" }),
      el("character", "MAYA", { revision: "rev-2" }),
      el("dialogue", "Still here.", { revision: "rev-2" }),
      el("transition", "CUT TO:", { revision: "rev-1" }),
      el("action", "Unmarked."),
    ],
  },
  sceneAttrs: {
    title_page: [
      ["Title", "ATTRS"],
      ["Author", "Jane"],
    ],
    elements: [
      el("scene_heading", "INT. LAB - NIGHT", {
        scene_number: "12A",
        synopsis: "Things go wrong.",
        color: "#4f7fae",
      }),
      el("action", "Line one.\nLine two.\nLine three."),
      el("shot", "CLOSE ON MAYA"),
    ],
  },
  pageBreaks: {
    title_page: [],
    elements: [
      el("action", "Before."),
      el("page_break", ""),
      el("action", "After."),
      el("page_break", ""),
      el("scene_heading", "INT. END - DAY"),
      el("action", "Done."),
    ],
  },
  omittedScenes: {
    title_page: [],
    elements: [
      el("scene_heading", "INT. ONE - DAY", { scene_number: "1" }),
      el("action", "Kept."),
      el("omitted", "", { scene_number: "2" }),
      el("scene_heading", "INT. THREE - DAY", { scene_number: "3" }),
      el("action", "Also kept."),
    ],
  },
  hardBreaksAndUnicode: {
    title_page: [],
    elements: [
      el("action", "Naïve café — “fancy quotes”…\nsecond line"),
      el("character", "MÜLLER (V.O.)"),
      el("dialogue", "Zürich.\n\nAfter a blank line."),
    ],
  },
};

describe("scriptToDoc / docToScript inverseness", () => {
  for (const [name, script] of Object.entries(fixtures)) {
    it(`round-trips: ${name}`, () => {
      const doc = scriptToDoc(script);
      const back = docToScript(doc, script.title_page);
      expect(back).toEqual(script);
    });
  }

  it("round-trips twice (stability)", () => {
    for (const script of Object.values(fixtures)) {
      const once = docToScript(scriptToDoc(script), script.title_page);
      const twice = docToScript(scriptToDoc(once), once.title_page);
      expect(twice).toEqual(once);
    }
  });

  it("drops only trailing empty action scratch blocks", () => {
    const script: Script = {
      title_page: [],
      elements: [el("action", "Content."), el("action", "")],
    };
    const back = docToScript(scriptToDoc(script), []);
    expect(back.elements).toEqual([el("action", "Content.")]);
  });

  it("empty script yields one empty action editing surface", () => {
    const doc = scriptToDoc({ title_page: [], elements: [] });
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.type.name).toBe("action");
    expect(docToScript(doc, []).elements).toEqual([]);
  });
});
