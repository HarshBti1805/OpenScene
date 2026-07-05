import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { getEditorView, jumpToElement } from "../editor/editorRef";
import { t } from "../i18n";

// Table read via the webview's speechSynthesis: system voices, fully offline.
// Per-character voices persist in project.json (meta.voices).

interface Cue {
  elementIndex: number;
  speaker: string | null; // null = narrator (action/headings)
  text: string;
}

function cueBase(text: string): string {
  const i = text.indexOf("(");
  return (i >= 0 ? text.slice(0, i) : text).trim().toUpperCase();
}

export function TableReadBar() {
  const isOpen = useApp((s) => s.tableReadOpen);
  const setOpen = useApp((s) => s.setTableReadOpen);
  const script = useApp((s) => s.script);
  const projectPath = useApp((s) => s.projectPath);
  const projectMeta = useApp((s) => s.projectMeta);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [playing, setPlaying] = useState(false);
  const [readActions, setReadActions] = useState(true);
  const [assignFor, setAssignFor] = useState<string>("");
  const queueRef = useRef<Cue[]>([]);
  const indexRef = useRef(0);

  // System voices load asynchronously in most webviews.
  useEffect(() => {
    if (!isOpen) return;
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, [isOpen]);

  const characters = useMemo(() => {
    const set = new Set<string>();
    for (const e of script.elements) {
      if (e.kind === "character") {
        const b = cueBase(e.text);
        if (b) set.add(b);
      }
    }
    return [...set].sort();
  }, [script]);

  const buildQueue = useCallback(
    (fromElement: number): Cue[] => {
      const out: Cue[] = [];
      let speaker: string | null = null;
      script.elements.forEach((e, i) => {
        if (i < fromElement) {
          if (e.kind === "character") speaker = cueBase(e.text);
          if (e.kind === "scene_heading" || e.kind === "transition") speaker = null;
          return;
        }
        switch (e.kind) {
          case "character":
            speaker = cueBase(e.text);
            break;
          case "dialogue":
          case "lyrics":
            if (e.text.trim()) out.push({ elementIndex: i, speaker, text: e.text });
            break;
          case "scene_heading":
          case "transition":
            speaker = null;
            if (readActions && e.text.trim()) out.push({ elementIndex: i, speaker: null, text: e.text });
            break;
          case "action":
          case "shot":
            if (readActions && e.text.trim()) out.push({ elementIndex: i, speaker: null, text: e.text });
            break;
          default:
            break;
        }
      });
      return out;
    },
    [script, readActions],
  );

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  const speakNext = useCallback(() => {
    const queue = queueRef.current;
    const idx = indexRef.current;
    if (idx >= queue.length) {
      setPlaying(false);
      return;
    }
    const cue = queue[idx];
    jumpToElement(cue.elementIndex);
    const utter = new SpeechSynthesisUtterance(cue.text);
    const assigned = cue.speaker ? projectMeta?.voices?.[cue.speaker] : projectMeta?.voices?.["(narrator)"];
    if (assigned) {
      const v = voices.find((x) => x.voiceURI === assigned);
      if (v) utter.voice = v;
    }
    utter.rate = 1.0;
    utter.onend = () => {
      indexRef.current += 1;
      speakNext();
    };
    utter.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(utter);
  }, [projectMeta, voices]);

  const play = (from: "top" | "cursor" | "scene") => {
    stop();
    let start = 0;
    if (from !== "top") {
      const view = getEditorView();
      if (view) {
        const $from = view.state.selection.$from;
        let blockIdx = 0;
        let found = 0;
        view.state.doc.forEach((_node, pos) => {
          if (pos <= $from.pos - 1) found = blockIdx;
          blockIdx++;
        });
        start = found;
        if (from === "scene") {
          while (start > 0 && script.elements[start]?.kind !== "scene_heading") start--;
        }
      }
    }
    queueRef.current = buildQueue(start);
    indexRef.current = 0;
    if (queueRef.current.length === 0) return;
    setPlaying(true);
    speakNext();
  };

  const assignVoice = async (character: string, voiceURI: string) => {
    if (!projectPath || !projectMeta) return;
    const nextVoices = { ...(projectMeta.voices ?? {}) };
    if (voiceURI) nextVoices[character] = voiceURI;
    else delete nextVoices[character];
    const meta = { ...projectMeta, voices: nextVoices };
    useApp.setState({ projectMeta: meta });
    await api.saveProjectMeta(projectPath, meta).catch(() => {});
  };

  if (!isOpen) return null;

  return (
    <div className="tableread-bar" role="region" aria-label={t("read.aria")}>
      <span className="tableread-title">{t("read.title")}</span>
      <button className="btn btn-small" onClick={() => play("top")} disabled={playing}>
        {t("read.fromTop")}
      </button>
      <button className="btn btn-small" onClick={() => play("scene")} disabled={playing}>
        {t("read.fromScene")}
      </button>
      <button className="btn btn-small" onClick={() => play("cursor")} disabled={playing}>
        {t("read.fromCursor")}
      </button>
      <button className="btn btn-small" onClick={stop} disabled={!playing}>
        {t("read.stop")}
      </button>
      <label className="find-toggle">
        <input type="checkbox" checked={readActions} onChange={(e) => setReadActions(e.target.checked)} />
        {t("read.includeAction")}
      </label>
      <div className="toolbar-spacer" />
      <select
        className="input"
        style={{ width: 140 }}
        value={assignFor}
        aria-label={t("read.assignCharacter")}
        onChange={(e) => setAssignFor(e.target.value)}
      >
        <option value="">{t("read.assignCharacter")}</option>
        <option value="(narrator)">{t("read.narrator")}</option>
        {characters.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {assignFor && (
        <select
          className="input"
          style={{ width: 180 }}
          value={projectMeta?.voices?.[assignFor] ?? ""}
          aria-label={t("read.assignVoice", { name: assignFor })}
          onChange={(e) => void assignVoice(assignFor, e.target.value)}
        >
          <option value="">{t("read.systemDefault")}</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}
            </option>
          ))}
        </select>
      )}
      <button className="btn btn-small" onClick={() => { stop(); setOpen(false); }} aria-label={t("read.close")}>
        ×
      </button>
    </div>
  );
}
