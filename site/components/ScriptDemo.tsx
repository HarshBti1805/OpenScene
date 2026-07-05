"use client";

import { useEffect, useRef, useState } from "react";

type El = { cls: string; text: string };

/* A short scene that "writes itself" on the hero page. */
const SCRIPT: El[] = [
  { cls: "demo-scene", text: "INT. WRITER'S ROOM - NIGHT" },
  {
    cls: "demo-action",
    text: "A desk lamp. A cold coffee. MAYA (30s) stares at a blinking cursor like it owes her money.",
  },
  { cls: "demo-character", text: "MAYA" },
  { cls: "demo-paren", text: "(quietly)" },
  { cls: "demo-dialogue", text: "Page one. That's all it takes." },
  {
    cls: "demo-action",
    text: "She starts to type. The page fills. No sign-in. No spinner. Just words.",
  },
  { cls: "demo-transition", text: "CUT TO:" },
];

const TYPE_MS = 34;
const ELEMENT_PAUSE_MS = 420;
const LOOP_PAUSE_MS = 6000;

export function ScriptDemo() {
  const [progress, setProgress] = useState({ el: 0, ch: 0 });
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) {
      setProgress({ el: SCRIPT.length - 1, ch: SCRIPT[SCRIPT.length - 1].text.length });
      return;
    }
    let timer: number;
    const tick = () => {
      setProgress((p) => {
        const current = SCRIPT[p.el];
        if (p.ch < current.text.length) {
          timer = window.setTimeout(tick, TYPE_MS);
          return { el: p.el, ch: p.ch + 1 };
        }
        if (p.el < SCRIPT.length - 1) {
          timer = window.setTimeout(tick, ELEMENT_PAUSE_MS);
          return { el: p.el + 1, ch: 0 };
        }
        timer = window.setTimeout(tick, LOOP_PAUSE_MS);
        return { el: 0, ch: 0 };
      });
    };
    timer = window.setTimeout(tick, 900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="demo-page-wrap" aria-hidden="true">
      <div className="demo-page">
        <span className="demo-page-corner">1.</span>
        {SCRIPT.map((el, i) => {
          if (i > progress.el) return <p key={i} className={`demo-el ${el.cls}`} />;
          const done = i < progress.el;
          const text = done ? el.text : el.text.slice(0, progress.ch);
          const showCaret = i === progress.el;
          return (
            <p key={i} className={`demo-el ${el.cls}`}>
              {text}
              {showCaret && <span className="demo-caret" />}
            </p>
          );
        })}
        <div className="demo-pagebreak">
          <span>PAGE 1 / 1</span>
        </div>
      </div>
    </div>
  );
}
