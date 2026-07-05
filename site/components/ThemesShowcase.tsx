"use client";

import { useEffect, useState } from "react";
import { Reveal } from "./Reveal";
import { applyThemePref, loadThemePref, resolveTheme, type ResolvedTheme } from "@/lib/theme";

/* Exact palettes from the app (DESIGN.md). Fixed showcase data — these render
   each theme's miniature regardless of the active site theme. */
const THEMES: {
  id: ResolvedTheme;
  name: string;
  tag: string;
  desc: string;
  bg: string;
  surface: string;
  raised: string;
  ink: string;
  muted: string;
  accent: string;
  line: string;
  page: string;
  pageInk: string;
}[] = [
  {
    id: "light",
    name: "Light",
    tag: "The production office",
    desc: "Warm paper tones for daylight drafts and printed-page thinking.",
    bg: "#ece5d4",
    surface: "#f3eee0",
    raised: "#faf6ea",
    ink: "#26200f",
    muted: "#7a7057",
    accent: "#9c5300",
    line: "#d8cfb6",
    page: "#fdfbf3",
    pageInk: "#211c11",
  },
  {
    id: "dark",
    name: "Dark",
    tag: "The grading suite",
    desc: "Warm charcoal and signal amber. The default, tuned for long sessions.",
    bg: "#16130e",
    surface: "#1d1a14",
    raised: "#262219",
    ink: "#e9e3d3",
    muted: "#9b937f",
    accent: "#f2a33c",
    line: "#363023",
    page: "#201d16",
    pageInk: "#e6e0d0",
  },
  {
    id: "midnight",
    name: "Midnight",
    tag: "The projection booth",
    desc: "Ultra-dark for 2 AM pages. The lamp is off; the cursor is on.",
    bg: "#0a0907",
    surface: "#100e0b",
    raised: "#17140f",
    ink: "#bfb8a6",
    muted: "#6e675a",
    accent: "#d99427",
    line: "#211d15",
    page: "#0e0d0a",
    pageInk: "#c9c3b1",
  },
];

function MiniApp({ t }: { t: (typeof THEMES)[number] }) {
  const panelLines = [0.9, 0.55, 0.75, 0.4, 0.65];
  const pageLines: { w: string; ml?: string; accent?: boolean }[] = [
    { w: "62%" },
    { w: "88%" },
    { w: "40%", ml: "34%", accent: true },
    { w: "52%", ml: "22%" },
    { w: "60%", ml: "22%" },
    { w: "84%" },
  ];
  return (
    <div className="theme-card-screen" style={{ background: t.bg }}>
      <div className="tc-titlebar" style={{ background: t.bg, borderBottom: `1px solid ${t.line}` }}>
        <span className="tc-dot" style={{ background: t.accent }} />
        <span className="tc-dot" style={{ background: t.line }} />
        <span className="tc-dot" style={{ background: t.line }} />
      </div>
      <div className="tc-body">
        <div className="tc-panel" style={{ background: t.surface, borderRight: `1px solid ${t.line}` }}>
          {panelLines.map((w, i) => (
            <span
              key={i}
              className="tc-panel-line"
              style={{ background: i === 0 ? t.accent : t.muted, width: `${w * 100}%` }}
            />
          ))}
        </div>
        <div className="tc-editor">
          <div className="tc-page" style={{ background: t.page, boxShadow: `0 2px 10px rgba(0,0,0,0.25)` }}>
            {pageLines.map((l, i) => (
              <span
                key={i}
                className="tc-page-line"
                style={{
                  background: l.accent ? t.accent : t.pageInk,
                  width: l.w,
                  marginLeft: l.ml ?? 0,
                  opacity: l.accent ? 0.9 : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemesShowcase() {
  const [active, setActive] = useState<ResolvedTheme | null>(null);

  useEffect(() => {
    setActive(resolveTheme(loadThemePref()));
  }, []);

  const choose = (id: ResolvedTheme) => {
    setActive(id);
    applyThemePref(id);
  };

  return (
    <section className="section" id="themes">
      <Reveal>
        <p className="section-kicker">Three Rooms, One Desk</p>
        <h2 className="section-title">Every theme, tuned by hand.</h2>
        <p className="section-sub">
          None is an inversion of another. Each room — the production office, the grading suite,
          the projection booth — gets its own inks, its own paper, its own amber. Try them on this
          page right now.
        </p>
      </Reveal>
      <div className="themes-grid">
        {THEMES.map((t, i) => (
          <Reveal key={t.id} delay={i * 90}>
            <button
              className={`theme-card${active === t.id ? " active" : ""}`}
              onClick={() => choose(t.id)}
              aria-pressed={active === t.id}
              aria-label={`Preview the ${t.name} theme`}
            >
              <MiniApp t={t} />
              <div className="theme-card-meta">
                <span className="theme-card-name">{t.name}</span>
                <span className="theme-card-tag">{t.tag}</span>
              </div>
              <p className="theme-card-desc">{t.desc}</p>
            </button>
          </Reveal>
        ))}
      </div>
      <p className="themes-hint">
        <span className="edgecode">▮</span> click a card — the whole site changes with it. The app
        also follows your OS automatically.
      </p>
    </section>
  );
}
