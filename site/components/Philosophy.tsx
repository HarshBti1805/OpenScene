import { Reveal } from "./Reveal";

const PILLARS = [
  {
    code: "01",
    title: "Free forever, structurally",
    desc: "MIT licensed with no paid tiers, watermarks, trials, accounts, or license keys. There are no servers to pay for, so \u201cfree\u201d is architecture, not a pricing decision that can be reversed.",
  },
  {
    code: "02",
    title: "No AI. Ever, by design.",
    desc: "No generative AI features, and no scope reserved for them. Nothing in the tool touches your words. For writers with authorship concerns, that's a guarantee — not a settings toggle.",
  },
  {
    code: "03",
    title: "Local-first, always",
    desc: "Every feature works with zero network access. No sign-in, no license check, no telemetry. Your script opens on a plane, in a cabin, in 2040.",
  },
  {
    code: "04",
    title: "Readable forever",
    desc: "The native format is plain-text Fountain in a plain folder. Any text editor can open your script today, and any text editor still will decades from now.",
  },
];

export function Philosophy() {
  return (
    <section className="section" id="philosophy">
      <Reveal>
        <p className="section-kicker">The Contract</p>
        <h2 className="section-title">Four promises, kept by construction.</h2>
      </Reveal>
      <div className="pillars">
        <div className="pillar-list">
          {PILLARS.map((p, i) => (
            <Reveal key={p.code} delay={i * 80}>
              <div className="pillar">
                <div className="pillar-head">
                  <span className="edgecode">{p.code}</span>
                  <h3 className="pillar-title">{p.title}</h3>
                </div>
                <p className="pillar-desc">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={140}>
          <div>
            <p className="fountain-filename">
              ~/screenplays/late-shift/<b>script.fountain</b> — plain text, any editor, forever
            </p>
            <pre className="fountain-block">
              {`Title: LATE SHIFT
Author: You. Only you.

`}
              <span className="hl">INT. DINER - NIGHT</span>
              {`

Rain on the window. A waitress
refills a cup nobody asked for.

`}
              <span className="hl">{`                    COLE`}</span>
              {`          You ever notice nothing
          good is open this late?

`}
              <span className="cm">{`[[note: except this app — it
  never closes and never charges]]`}</span>
            </pre>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
