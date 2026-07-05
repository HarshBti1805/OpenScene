// SmartType: context-aware autocomplete learned from the current script.
//
// - In a Character block: suggests known character names.
// - In a Scene Heading: suggests INT./EXT. prefixes at the start, known
//   locations after the prefix, and DAY/NIGHT/etc. after " - ".
// - In a Transition block: suggests standard transitions.
//
// Pure DOM plugin (no React) so it stays on the fast path; suggestions are
// recomputed from the document only when the popup opens.

import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { t } from "../i18n";

const KEY = new PluginKey("smarttype");

const SCENE_PREFIXES = ["INT. ", "EXT. ", "INT./EXT. ", "I/E. ", "EST. "];
const TIMES = ["DAY", "NIGHT", "CONTINUOUS", "LATER", "MORNING", "EVENING", "DUSK", "DAWN", "SAME"];
const TRANSITIONS = ["CUT TO:", "SMASH CUT TO:", "DISSOLVE TO:", "MATCH CUT TO:", "FADE OUT.", "FADE TO BLACK.", "TIME CUT TO:", "INTERCUT WITH:"];

function collectCharacters(view: EditorView): string[] {
  const names = new Set<string>();
  view.state.doc.forEach((node) => {
    if (node.type.name === "character") {
      const base = node.textContent.split("(")[0].trim();
      if (base) names.add(base);
    }
  });
  return [...names].sort();
}

function collectLocations(view: EditorView): string[] {
  const locs = new Set<string>();
  view.state.doc.forEach((node) => {
    if (node.type.name === "scene_heading") {
      let t = node.textContent.toUpperCase();
      for (const p of ["INT./EXT.", "INT/EXT.", "I/E.", "INT.", "EXT.", "EST."]) {
        if (t.startsWith(p)) {
          t = t.slice(p.length);
          break;
        }
      }
      const dash = t.lastIndexOf(" - ");
      const loc = (dash >= 0 ? t.slice(0, dash) : t).trim();
      if (loc) locs.add(loc);
    }
  });
  return [...locs].sort();
}

interface Suggestion {
  label: string;
  /** replace the last `replace` chars before cursor with `label` */
  replace: number;
}

function suggestionsFor(view: EditorView): Suggestion[] {
  const { $from, empty } = view.state.selection;
  if (!empty) return [];
  const block = $from.parent;
  const textBefore = block.textBetween(0, $from.parentOffset, "\n");
  const kind = block.type.name;

  const complete = (candidates: string[], typed: string): Suggestion[] => {
    const t = typed.toUpperCase();
    if (!t) return candidates.map((c) => ({ label: c, replace: 0 }));
    return candidates
      .filter((c) => c.toUpperCase().startsWith(t) && c.toUpperCase() !== t)
      .map((c) => ({ label: c, replace: typed.length }));
  };

  if (kind === "character") {
    if (textBefore.includes("(")) return [];
    return complete(collectCharacters(view), textBefore.trim()).slice(0, 8);
  }
  if (kind === "transition") {
    return complete(TRANSITIONS, textBefore).slice(0, 8);
  }
  if (kind === "scene_heading") {
    const upper = textBefore.toUpperCase();
    // Time of day after " - "
    const dash = upper.lastIndexOf(" - ");
    if (dash >= 0) {
      const typed = upper.slice(dash + 3);
      return complete(TIMES, typed).slice(0, 8);
    }
    // Prefix at start
    const prefix = SCENE_PREFIXES.find((p) => upper.startsWith(p.trimEnd()) && upper.length >= p.trimEnd().length);
    if (!prefix) {
      return complete(SCENE_PREFIXES, upper).slice(0, 6);
    }
    // Location portion
    const afterPrefix = textBefore.slice(prefix.trimEnd().length).replace(/^ +/, "");
    return complete(collectLocations(view), afterPrefix).slice(0, 8);
  }
  return [];
}

let popupSeq = 0;

class SmartTypeView {
  view: EditorView;
  dom: HTMLDivElement;
  items: Suggestion[] = [];
  selected = 0;
  visible = false;
  popupId: string;

  constructor(view: EditorView) {
    this.view = view;
    this.popupId = `smarttype-${++popupSeq}`;
    this.dom = document.createElement("div");
    this.dom.className = "smarttype-popup";
    this.dom.id = this.popupId;
    this.dom.setAttribute("role", "listbox");
    this.dom.setAttribute("aria-label", t("editor.smartTypeAria"));
    this.dom.style.display = "none";
    document.body.appendChild(this.dom);
    // Combobox semantics on the editable surface itself.
    view.dom.setAttribute("aria-autocomplete", "list");
    view.dom.setAttribute("aria-expanded", "false");
  }

  /** Reflect open/selection state onto the editor element for AT users. */
  private syncAria() {
    const editor = this.view.dom;
    if (this.visible) {
      editor.setAttribute("aria-expanded", "true");
      editor.setAttribute("aria-controls", this.popupId);
      editor.setAttribute("aria-activedescendant", `${this.popupId}-opt-${this.selected}`);
    } else {
      editor.setAttribute("aria-expanded", "false");
      editor.removeAttribute("aria-controls");
      editor.removeAttribute("aria-activedescendant");
    }
  }

  update(view: EditorView) {
    this.view = view;
    if (!view.hasFocus()) {
      this.hide();
      return;
    }
    this.items = suggestionsFor(view);
    if (this.items.length === 0) {
      this.hide();
      return;
    }
    this.selected = Math.min(this.selected, this.items.length - 1);
    this.render();
    const coords = view.coordsAtPos(view.state.selection.from);
    this.dom.style.display = "block";
    this.dom.style.left = `${coords.left}px`;
    this.dom.style.top = `${coords.bottom + 4}px`;
    this.visible = true;
    this.syncAria();
  }

  render() {
    this.dom.innerHTML = "";
    this.items.forEach((item, i) => {
      const el = document.createElement("div");
      el.className = `smarttype-item${i === this.selected ? " selected" : ""}`;
      el.id = `${this.popupId}-opt-${i}`;
      el.setAttribute("role", "option");
      el.setAttribute("aria-selected", String(i === this.selected));
      el.textContent = item.label;
      el.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.accept(i);
      });
      this.dom.appendChild(el);
    });
    this.syncAria();
  }

  accept(i: number) {
    const item = this.items[i];
    if (!item) return;
    const { from } = this.view.state.selection;
    const tr = this.view.state.tr.insertText(item.label, from - item.replace, from);
    this.view.dispatch(tr);
    this.hide();
    this.view.focus();
  }

  hide() {
    if (this.visible) {
      this.dom.style.display = "none";
      this.visible = false;
      this.selected = 0;
      this.syncAria();
    }
  }

  destroy() {
    this.dom.remove();
    const editor = this.view.dom;
    editor.removeAttribute("aria-autocomplete");
    editor.removeAttribute("aria-expanded");
    editor.removeAttribute("aria-controls");
    editor.removeAttribute("aria-activedescendant");
  }

  handleKey(event: KeyboardEvent): boolean {
    if (!this.visible) return false;
    switch (event.key) {
      case "ArrowDown":
        this.selected = (this.selected + 1) % this.items.length;
        this.render();
        return true;
      case "ArrowUp":
        this.selected = (this.selected - 1 + this.items.length) % this.items.length;
        this.render();
        return true;
      case "Enter":
      case "Tab":
        // Only swallow the key when the user has actively highlighted an item
        // or there is a strict completion in progress.
        if (this.items[this.selected] && this.items[this.selected].replace > 0) {
          this.accept(this.selected);
          return true;
        }
        this.hide();
        return false;
      case "Escape":
        this.hide();
        return true;
      default:
        return false;
    }
  }
}

export function smartTypePlugin(): Plugin {
  let pluginView: SmartTypeView | null = null;
  return new Plugin({
    key: KEY,
    view(editorView) {
      pluginView = new SmartTypeView(editorView);
      return {
        update: (v) => pluginView?.update(v),
        destroy: () => {
          pluginView?.destroy();
          pluginView = null;
        },
      };
    },
    props: {
      handleKeyDown(_view, event) {
        return pluginView ? pluginView.handleKey(event) : false;
      },
      handleDOMEvents: {
        blur() {
          pluginView?.hide();
          return false;
        },
      },
    },
  });
}
