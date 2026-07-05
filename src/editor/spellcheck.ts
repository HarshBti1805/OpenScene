// In-app spell check plugin.
//
// Off the keystroke path by construction: doc changes only bump a version
// counter; 700ms after the last change, all block texts are sent to the Rust
// checker (Hunspell en_US + the project dictionary + auto-learned character
// and location names) and squiggle decorations are applied via a metadata
// transaction. Right-click on a squiggle opens a suggestion popup with
// replace and add-to-dictionary actions.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { api } from "../api";
import { useApp } from "../store";
import { t } from "../i18n";

export const spellKey = new PluginKey<SpellState>("spellcheck");

interface SpellState {
  decorations: DecorationSet;
}

interface BlockText {
  /** Doc position of the block's content start (pos + 1). */
  base: number;
  text: string;
  /** Char offset -> doc position (accounts for inline note atoms/breaks). */
  charPos: number[];
}

/** Collect plain text + char->pos maps for every text block. */
function collectBlocks(doc: PMNode): BlockText[] {
  const blocks: BlockText[] = [];
  doc.forEach((node, pos) => {
    if (!node.type.isTextblock) return;
    let text = "";
    const charPos: number[] = [];
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          text += child.text[i];
          charPos.push(at + i);
        }
      } else if (child.type.name === "hard_break") {
        text += "\n";
        charPos.push(at);
      }
      // note atoms contribute no checkable text
    });
    blocks.push({ base: pos + 1, text, charPos });
  });
  return blocks;
}

/** Learned words: character cue bases and slugline locations. */
function learnedWords(doc: PMNode): string[] {
  const words = new Set<string>();
  doc.forEach((node) => {
    const name = node.type.name;
    if (name === "character" || name === "scene_heading") {
      for (const w of node.textContent.split(/[^\p{L}']+/u)) {
        if (w.length > 1) words.add(w.toLowerCase());
      }
    }
  });
  return [...words];
}

export function spellPlugin(): Plugin {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let viewRef: EditorView | null = null;

  const schedule = (view: EditorView) => {
    if (timer) clearTimeout(timer);
    const gen = ++generation;
    timer = setTimeout(async () => {
      const doc = view.state.doc;
      const blocks = collectBlocks(doc);
      const custom = [
        ...(useApp.getState().projectMeta?.dictionary ?? []),
        ...learnedWords(doc),
      ];
      try {
        const misses = await api.spellCheck(
          blocks.map((b) => b.text),
          custom,
        );
        if (gen !== generation || !viewRef || !viewRef.state.doc.eq(doc)) return;
        const decos: Decoration[] = [];
        misses.forEach((blockMisses, bi) => {
          const block = blocks[bi];
          for (const m of blockMisses) {
            const from = block.charPos[m.start];
            const last = block.charPos[m.end - 1];
            if (from === undefined || last === undefined) continue;
            decos.push(
              Decoration.inline(from, last + 1, {
                class: "spell-miss",
                "data-word": m.word,
              }),
            );
          }
        });
        const tr = viewRef.state.tr.setMeta(spellKey, DecorationSet.create(viewRef.state.doc, decos));
        viewRef.dispatch(tr);
      } catch {
        // Checker unavailable: no squiggles, never an error surface.
      }
    }, 700);
  };

  return new Plugin<SpellState>({
    key: spellKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty }),
      apply(tr, value) {
        const next = tr.getMeta(spellKey) as DecorationSet | undefined;
        if (next) return { decorations: next };
        if (tr.docChanged) {
          return { decorations: value.decorations.map(tr.mapping, tr.doc) };
        }
        return value;
      },
    },
    view(view) {
      viewRef = view;
      pendingRecheck = schedule;
      schedule(view);
      return {
        update(v, prev) {
          viewRef = v;
          if (!v.state.doc.eq(prev.doc)) schedule(v);
        },
        destroy() {
          viewRef = null;
          pendingRecheck = null;
          if (timer) clearTimeout(timer);
          generation++;
          hidePopup();
        },
      };
    },
    props: {
      decorations(state) {
        return spellKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
      handleDOMEvents: {
        contextmenu(view, event) {
          const target = event.target as HTMLElement;
          const miss = target.closest?.(".spell-miss") as HTMLElement | null;
          if (!miss) {
            hidePopup();
            return false;
          }
          event.preventDefault();
          void showPopup(view, miss, event.clientX, event.clientY);
          return true;
        },
        mousedown() {
          hidePopup();
          return false;
        },
      },
    },
  });
}

// The active plugin instance's scheduler (recheck after dictionary changes).
let pendingRecheck: ((view: EditorView) => void) | null = null;

// ---------------------------------------------------------------------------
// Suggestion popup (plain DOM, follows the SmartType pattern)
// ---------------------------------------------------------------------------

let popup: HTMLDivElement | null = null;

function hidePopup() {
  popup?.remove();
  popup = null;
}

async function showPopup(view: EditorView, missEl: HTMLElement, x: number, y: number) {
  hidePopup();
  const word = missEl.getAttribute("data-word") ?? missEl.textContent ?? "";
  if (!word) return;
  let suggestions: string[] = [];
  try {
    suggestions = await api.spellSuggest(word);
  } catch {
    suggestions = [];
  }

  popup = document.createElement("div");
  popup.className = "spell-popup";
  popup.setAttribute("role", "menu");
  popup.setAttribute("aria-label", t("spell.suggestionsFor", { word }));

  const addItem = (label: string, cls: string, onPick: () => void) => {
    const item = document.createElement("button");
    item.className = `spell-popup-item ${cls}`;
    item.setAttribute("role", "menuitem");
    item.textContent = label;
    item.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onPick();
      hidePopup();
    });
    popup!.appendChild(item);
  };

  const range = findMissRange(view, missEl);
  for (const s of suggestions) {
    addItem(s, "suggestion", () => {
      if (range) {
        view.dispatch(view.state.tr.insertText(s, range.from, range.to));
        view.focus();
      }
    });
  }
  if (suggestions.length === 0) {
    const none = document.createElement("div");
    none.className = "spell-popup-empty";
    none.textContent = t("spell.noSuggestions");
    popup.appendChild(none);
  }
  addItem(t("spell.addToDictionary", { word }), "add-word", () => {
    void addToDictionary(word, view);
  });

  document.body.appendChild(popup);
  const rect = popup.getBoundingClientRect();
  popup.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  popup.style.top = `${Math.min(y + 4, window.innerHeight - rect.height - 8)}px`;
}

function findMissRange(view: EditorView, el: HTMLElement): { from: number; to: number } | null {
  try {
    const from = view.posAtDOM(el, 0);
    const text = el.textContent ?? "";
    return { from, to: from + text.length };
  } catch {
    return null;
  }
}

async function addToDictionary(word: string, view: EditorView) {
  const s = useApp.getState();
  if (!s.projectPath || !s.projectMeta) return;
  const lower = word.toLowerCase();
  if (s.projectMeta.dictionary?.includes(lower)) return;
  const meta = {
    ...s.projectMeta,
    dictionary: [...(s.projectMeta.dictionary ?? []), lower].sort(),
  };
  useApp.setState({ projectMeta: meta });
  await api.saveProjectMeta(s.projectPath, meta).catch(() => {});
  s.setStatus(t("spell.addedToDictionary", { word }));
  // Clear squiggles immediately, then run a fresh check with the new word.
  view.dispatch(view.state.tr.setMeta(spellKey, DecorationSet.empty));
  pendingRecheck?.(view);
}
