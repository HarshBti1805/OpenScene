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
import type { LayoutOptions, PageMap } from "../types";

export const paginationKey = new PluginKey<PaginationState>("pagination");

interface PaginationState {
  decorations: DecorationSet;
  pageMap: PageMap | null;
}

function buildDecorations(doc: PMNode, pageMap: PageMap): DecorationSet {
  const decos: Decoration[] = [];
  let index = 0;
  let prevPage = 1;
  doc.forEach((_node, pos) => {
    const page = pageMap.element_pages[index] ?? prevPage;
    if (index > 0 && page > prevPage) {
      decos.push(
        Decoration.widget(
          pos,
          () => {
            const el = document.createElement("div");
            el.className = "page-break-rule";
            el.setAttribute("role", "separator");
            el.setAttribute("aria-label", `Page ${page}`);
            el.innerHTML = `<span class="page-break-label">PAGE ${page}</span>`;
            return el;
          },
          { side: -1, key: `pb-${index}-${page}` },
        ),
      );
    }
    prevPage = page;
    index++;
  });
  return DecorationSet.create(doc, decos);
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
