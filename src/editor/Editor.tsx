import { useEffect, useRef } from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { scriptToDoc, docToScript } from "./convert";
import {
  backspaceEmptyBlock,
  insertPageBreak,
  setElementKind,
  smartEnter,
  smartTab,
  toggleDualDialogue,
} from "./commands";
import { smartTypePlugin } from "./smarttype";
import { paginationPlugin } from "./pagination";
import { lineFocusPlugin } from "./lineFocus";
import { spellPlugin } from "./spellcheck";
import { revisionMarkPlugin } from "./revisionMark";
import { lockGuardPlugin } from "./lockGuard";
import { setEditorView } from "./editorRef";
import { initUndoLog, recordTransaction, restoreUndoLog } from "./persistUndo";
import { api } from "../api";
import { useApp } from "../store";
import type { ElementKind } from "../types";
import { t } from "../i18n";

const KIND_SHORTCUTS: [string, ElementKind][] = [
  ["Mod-1", "scene_heading"],
  ["Mod-2", "action"],
  ["Mod-3", "character"],
  ["Mod-4", "parenthetical"],
  ["Mod-5", "dialogue"],
  ["Mod-6", "transition"],
  ["Mod-7", "shot"],
  ["Mod-8", "act_header"],
  ["Mod-9", "lyrics"],
];

export function Editor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const projectPath = useApp((s) => s.projectPath);
  const docKey = useApp((s) => s.docKey());
  const lineFocus = useApp((s) => s.lineFocus);
  const readOnly = useApp((s) => s.readOnly);

  // Reflect read-only mode without recreating the editor.
  useEffect(() => {
    viewRef.current?.setProps({ editable: () => !readOnly });
  }, [readOnly]);

  // Re-evaluate the line-focus decoration when the toggle flips.
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch(view.state.tr.setMeta("line-focus-toggle", true));
  }, [lineFocus]);

  useEffect(() => {
    if (!hostRef.current || !projectPath) return;
    const app = useApp.getState();

    const kindKeys: Record<string, ReturnType<typeof setElementKind>> = {};
    for (const [key, kind] of KIND_SHORTCUTS) kindKeys[key] = setElementKind(kind);

    const pagination = paginationPlugin(
      () => useApp.getState().layoutOptions(),
      (pm) => useApp.getState().setPageMap(pm),
    );

    const state = EditorState.create({
      doc: scriptToDoc(app.script),
      plugins: [
        history(),
        keymap({
          Enter: smartEnter,
          Tab: smartTab(false),
          "Shift-Tab": smartTab(true),
          Backspace: backspaceEmptyBlock,
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-Shift-z": redo,
          "Mod-Alt-d": toggleDualDialogue,
          "Mod-Enter": insertPageBreak,
          ...kindKeys,
        }),
        keymap(baseKeymap),
        smartTypePlugin(),
        pagination.plugin,
        lineFocusPlugin(() => useApp.getState().lineFocus),
        spellPlugin(),
        revisionMarkPlugin(),
        lockGuardPlugin(),
      ],
    });

    let userEdited = false;
    const view = new EditorView(hostRef.current, {
      state,
      editable: () => !useApp.getState().readOnly,
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": t("editor.aria"),
        class: "script-page",
        spellcheck: "false",
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
        if (tr.docChanged) {
          userEdited = true;
          recordTransaction(tr);
          const st = useApp.getState();
          st.setScript(docToScript(newState.doc, st.titlePage));
          st.markDirty();
          if (st.typewriter) {
            requestAnimationFrame(() => centerSelection(view));
          }
        }
      },
    });

    viewRef.current = view;
    setEditorView(view, pagination);
    view.focus();

    // Persisted undo: restore the previous session's undo stack if the log
    // still reproduces the document on disk and the user hasn't typed yet.
    // Per-document: drafts persist their own stacks.
    initUndoLog(view.state.doc);
    api
      .loadUndoState(projectPath, useApp.getState().snapshotStem())
      .then((saved) => {
        if (saved && !userEdited && viewRef.current === view) {
          restoreUndoLog(view, saved);
        }
      })
      .catch(() => {});

    return () => {
      setEditorView(null, null);
      view.destroy();
      viewRef.current = null;
    };
    // Recreate the editor when a different document (script/draft) opens,
    // so undo history never crosses document boundaries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  const showRevMarks = useApp((s) => s.showRevisionMarks);
  return (
    <div
      className={`editor-scroll${lineFocus ? " line-focus" : ""}${showRevMarks ? " show-rev-marks" : ""}`}
      id="editor-scroll"
    >
      <div ref={hostRef} className="editor-host" />
    </div>
  );
}

function centerSelection(view: EditorView) {
  try {
    const coords = view.coordsAtPos(view.state.selection.from);
    const scroller = document.getElementById("editor-scroll");
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const offset = coords.top - rect.top - rect.height / 2;
    scroller.scrollBy({ top: offset, behavior: "auto" });
  } catch {
    // coordsAtPos can throw during layout; typewriter centering is best-effort.
  }
}
