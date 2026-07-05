// Live pagination decorations, kept OFF the typing path.
//
// On every doc change we debounce (250ms idle) and ask the Rust engine for a
// PageMap (element index -> page). The result arrives asynchronously and is
// applied through a metadata-only transaction, so keystrokes never wait for
// pagination. Decorations draw a page-break rule before each element that
// starts a new page.

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { api } from "../api";
import { docToScript } from "./convert";
import { t } from "../i18n";
import type { LayoutOptions, PageMap } from "../types";

export const paginationKey = new PluginKey<PaginationState>("pagination");

interface PaginationState {
  decorations: DecorationSet;
  pageMap: PageMap | null;
}

/** Map a non-whitespace char count into a doc position inside a block. */
function posAtNonWs(block: PMNode, blockPos: number, nonws: number): number | null {
  let count = 0;
  let result: number | null = null;
  block.forEach((child, offset) => {
    if (result !== null || !child.isText || !child.text) return;
    const base = blockPos + 1 + offset;
    for (let i = 0; i < child.text.length; i++) {
      if (!/\s/.test(child.text[i])) {
        count++;
        if (count === nonws) {
          result = base + i + 1;
          return;
        }
      }
    }
  });
  return result;
}

function buildDecorations(doc: PMNode, pageMap: PageMap): DecorationSet {
  const decos: Decoration[] = [];
  let index = 0;
  let prevPage = 1;
  const splitsByElement = new Map<number, PageMap["dialogue_splits"]>();
  for (const s of pageMap.dialogue_splits ?? []) {
    const list = splitsByElement.get(s.element) ?? [];
    list.push(s);
    splitsByElement.set(s.element, list);
  }
  const labelOf = (ordinal: number) =>
    pageMap.page_labels?.[ordinal - 1] ?? String(ordinal);
  doc.forEach((node, pos) => {
    const page = pageMap.element_pages[index] ?? prevPage;
    if (index > 0 && page > prevPage) {
      decos.push(
        Decoration.widget(
          pos,
          () => {
            const el = document.createElement("div");
            el.className = "page-break-rule";
            el.setAttribute("role", "separator");
            el.setAttribute("aria-label", t("editor.pageLabel", { n: labelOf(page) }));
            el.innerHTML = `<span class="page-break-label">${t("editor.pageLabel", { n: labelOf(page) })}</span>`;
            return el;
          },
          { side: -1, key: `pb-${index}-${page}` },
        ),
      );
    }
    // Mid-dialogue MORE/CONT'D split points (engine-exact, decoration only).
    const splits = splitsByElement.get(index);
    if (splits && node.type.name === "dialogue") {
      for (const split of splits) {
        const at = posAtNonWs(node, pos, split.nonws_chars);
        if (at === null) continue;
        decos.push(
          Decoration.widget(
            at,
            () => {
              const el = document.createElement("span");
              el.className = "dialogue-split";
              el.setAttribute("role", "separator");
              const splitLabel = split.next_label || String(split.next_page);
              el.setAttribute("aria-label", t("editor.pageLabel", { n: splitLabel }));
              el.innerHTML =
                `<span class="dialogue-split-more">${t("editor.more")}</span>` +
                `<span class="dialogue-split-rule"><span class="page-break-label">${t("editor.pageLabel", { n: splitLabel })}</span></span>` +
                `<span class="dialogue-split-cue">${escapeHtml(split.cont_cue)}</span>`;
              return el;
            },
            { side: -1, key: `ds-${index}-${split.nonws_chars}-${split.next_page}` },
          ),
        );
      }
    }
    prevPage = page;
    index++;
  });
  return DecorationSet.create(doc, decos);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface PaginationHandle {
  plugin: Plugin;
  /** Force an immediate repagination (e.g. after scene numbering changes). */
  force: () => void;
}

export function paginationPlugin(getOpts: () => LayoutOptions, onPageMap: (pm: PageMap) => void): PaginationHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let viewRef: EditorView | null = null;

  const schedule = (view: EditorView) => {
    if (timer) clearTimeout(timer);
    const gen = ++generation;
    timer = setTimeout(async () => {
      const script = docToScript(view.state.doc, []);
      try {
        const pm = await api.computePageMap(script, getOpts());
        if (gen !== generation || !viewRef) return;
        onPageMap(pm);
        const tr = viewRef.state.tr.setMeta(paginationKey, pm);
        viewRef.dispatch(tr);
      } catch {
        // Engine unavailable (e.g. dev without backend): skip silently.
      }
    }, 250);
  };

  const plugin = new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, pageMap: null }),
      apply(tr, value, _old, newState) {
        const pm = tr.getMeta(paginationKey) as PageMap | undefined;
        if (pm) {
          return { decorations: buildDecorations(newState.doc, pm), pageMap: pm };
        }
        if (tr.docChanged) {
          return { decorations: value.decorations.map(tr.mapping, tr.doc), pageMap: value.pageMap };
        }
        return value;
      },
    },
    view(view) {
      viewRef = view;
      schedule(view);
      return {
        update(v, prev) {
          viewRef = v;
          if (!v.state.doc.eq(prev.doc)) schedule(v);
        },
        destroy() {
          viewRef = null;
          if (timer) clearTimeout(timer);
          generation++;
        },
      };
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });

  return {
    plugin,
    force: () => {
      if (viewRef) schedule(viewRef);
    },
  };
}
