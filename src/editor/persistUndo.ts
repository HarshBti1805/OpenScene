// Persisted undo: the session's undo stack survives relaunch.
//
// prosemirror-history's internal state isn't serializable, so we keep a
// parallel, bounded step log: { base document, [step, timestamp]... }.
// On save it's written to `.openscene-undo.json` (atomic, off the keystroke
// path — recording a step is one array push). On relaunch, if replaying the
// log over the base reproduces the document on disk exactly, we rebuild the
// undo stack by re-applying the steps as history transactions (grouped by
// the original typing pauses). If anything mismatches, the log is discarded:
// persisted undo is best-effort by design and must never corrupt state.

import { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { Step } from "prosemirror-transform";
import { closeHistory } from "prosemirror-history";
import type { EditorView } from "prosemirror-view";
import type { Transaction } from "prosemirror-state";
import { schema } from "./schema";

const MAX_STEPS = 400;
/** A pause longer than this starts a new undo group on replay. */
const GROUP_GAP_MS = 600;

interface LogEntry {
  s: unknown; // Step JSON
  t: number; // timestamp ms
}

interface UndoLog {
  base: unknown; // base document JSON
  steps: LogEntry[];
}

let log: UndoLog | null = null;

export function initUndoLog(doc: PMNode) {
  log = { base: doc.toJSON(), steps: [] };
}

export function clearUndoLog() {
  log = null;
}

/** Record a document-changing transaction. O(steps in tr) — trivial. */
export function recordTransaction(tr: Transaction) {
  if (!log || !tr.docChanged) return;
  const now = Date.now();
  for (const step of tr.steps) {
    log.steps.push({ s: step.toJSON(), t: now });
  }
  // Bound the log: fold the oldest steps into the base document.
  if (log.steps.length > MAX_STEPS) {
    try {
      let base = PMNode.fromJSON(schema, log.base);
      const overflow = log.steps.splice(0, log.steps.length - MAX_STEPS);
      for (const e of overflow) {
        const result = Step.fromJSON(schema, e.s).apply(base);
        if (!result.doc) throw new Error("fold failed");
        base = result.doc;
      }
      log.base = base.toJSON();
    } catch {
      // Folding failed: restart the log from the current state next record.
      log = null;
    }
  }
}

export function serializeUndoLog(): string | null {
  if (!log) return null;
  return JSON.stringify(log);
}

/**
 * Try to restore a persisted undo stack into a freshly created view whose
 * document is `currentDoc` (the file on disk). Returns true on success.
 */
export function restoreUndoLog(view: EditorView, saved: string): boolean {
  let parsed: UndoLog;
  try {
    parsed = JSON.parse(saved) as UndoLog;
  } catch {
    return false;
  }
  try {
    let doc = PMNode.fromJSON(schema, parsed.base);
    const steps: { step: Step; t: number }[] = [];
    for (const e of parsed.steps) {
      const step = Step.fromJSON(schema, e.s);
      const result = step.apply(doc);
      if (!result.doc) return false;
      doc = result.doc;
      steps.push({ step, t: e.t });
    }
    // The log must reproduce the on-disk document exactly.
    if (JSON.stringify(doc.toJSON()) !== JSON.stringify(view.state.doc.toJSON())) {
      return false;
    }
    // Rebuild: fresh state at the base, then replay with history grouping.
    let state = EditorState.create({
      doc: PMNode.fromJSON(schema, parsed.base),
      selection: undefined,
      plugins: view.state.plugins,
    });
    let lastT = 0;
    for (const { step, t } of steps) {
      let tr = state.tr.step(step);
      if (t - lastT > GROUP_GAP_MS) tr = closeHistory(tr);
      lastT = t;
      state = state.apply(tr);
    }
    // Preserve a sane selection at the end of the doc.
    const sel = TextSelection.atEnd(state.doc);
    state = state.apply(state.tr.setSelection(sel));
    view.updateState(state);
    log = parsed;
    return true;
  } catch {
    return false;
  }
}
