import { Reveal } from "./Reveal";

type Feature = {
  title: string;
  desc: string;
  tag: string;
  hero?: boolean;
};

const FEATURES: Feature[] = [
  {
    title: "A page is a page",
    desc: "Live WYSIWYG pagination computed by the same Rust engine that renders the PDF. Courier 12, US Letter, industry margins — what you see is what a production office prints.",
    tag: "Rust pagination engine",
    hero: true,
  },
  {
    title: "Muscle-memory editing",
    desc: "Enter and Tab cycle elements exactly the way every screenwriter expects. Character → Dialogue, Tab through types, Cmd/Ctrl+1–7 for direct element switching.",
    tag: "Element cycling",
  },
  {
    title: "SmartType",
    desc: "Autocompletes character names, INT./EXT., known locations, times of day, and transitions — learned from your script as you write it.",
    tag: "Autocomplete",
  },
  {
    title: "(MORE) and (CONT'D)",
    desc: "Automatic across page breaks and consecutive speeches. Scene headings never orphan; dialogue breaks only at sentence boundaries.",
    tag: "Smart page breaks",
  },
  {
    title: "Your files, forever",
    desc: "A project is a plain folder: script.fountain readable in any text editor, project.json, snapshots. No hidden library, no proprietary blob, git-diffable.",
    tag: "Plain-text Fountain",
  },
  {
    title: "Never lose a word",
    desc: "Autosave every 2 seconds with atomic writes, automatic snapshots, named versions with one-click restore, and rolling zipped backups to a second folder.",
    tag: "Safety net",
  },
  {
    title: "Speaks the industry",
    desc: "Fountain and FDX (Final Draft XML) import/export with round-trip fidelity. Send an FDX, receive one back — no one has to know you didn't pay $250.",
    tag: "FDX interchange",
  },
  {
    title: "Structure in view",
    desc: "Scene navigator with drag reorder, index cards with editable synopses, scene colors, global character rename with preview, statistics panel.",
    tag: "Navigator & cards",
  },
  {
    title: "Calm by default",
    desc: "Distraction-free mode, typewriter scrolling, line focus, a command palette on Cmd/Ctrl+K. The default view is a page and a cursor. Everything else gets out of the way.",
    tag: "Focus tools",
  },
];

export function Features() {
  return (
    <section className="section" id="features">
      <Reveal>
        <p className="section-kicker">The Toolkit</p>
        <h2 className="section-title">
          Everything the incumbents charge for.
          <br />
          Nothing they hold back.
        </h2>
        <p className="section-sub">
          Built to match Final Draft and Fade In where it counts — formatting, pagination, and
          interchange — and to beat them on speed, ownership, and price. Which is zero.
        </p>
      </Reveal>
      <div className="feat-grid">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 70}>
            <article className={`feat-card${f.hero ? " feat-hero-card" : ""}`}>
              <span className="feat-num">SC. {String(i + 1).padStart(2, "0")}</span>
              <h3 className="feat-title">{f.title}</h3>
              <p className="feat-desc">{f.desc}</p>
              <span className="feat-tag">{f.tag}</span>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
