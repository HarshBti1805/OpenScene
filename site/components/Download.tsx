"use client";

import { useEffect, useState } from "react";
import { Reveal } from "./Reveal";
import { GITHUB_URL, RELEASES_URL } from "@/lib/links";

type Platform = "mac" | "windows" | "linux";

const PLATFORMS: {
  id: Platform;
  glyph: string;
  name: string;
  formats: string;
  note: string;
}[] = [
  {
    id: "mac",
    glyph: "⌘",
    name: "macOS",
    formats: ".dmg · universal",
    note: "Unsigned build: on first launch, right-click the app and choose Open to pass Gatekeeper.",
  },
  {
    id: "windows",
    glyph: "❖",
    name: "Windows",
    formats: ".msi · .exe",
    note: "SmartScreen will warn on unsigned installers — choose More info, then Run anyway.",
  },
  {
    id: "linux",
    glyph: "▲",
    name: "Linux",
    formats: ".AppImage · .deb · .rpm",
    note: "AppImage is portable; .deb for Debian/Ubuntu, .rpm for Fedora. A first-class target, not an afterthought.",
  },
];

function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux|X11/.test(ua) && !/Android/.test(ua)) return "linux";
  return null;
}

export function Download() {
  const [detected, setDetected] = useState<Platform | null>(null);

  useEffect(() => {
    setDetected(detectPlatform());
  }, []);

  return (
    <section className="section" id="download">
      <Reveal>
        <p className="section-kicker">Roll Camera</p>
        <h2 className="section-title">Download. Write. That&apos;s the whole funnel.</h2>
        <p className="section-sub">
          Prebuilt installers for every desktop platform, published on GitHub Releases. No email
          gate, no trial clock, no upsell waiting on page two.
        </p>
      </Reveal>
      <div className="dl-grid">
        {PLATFORMS.map((p, i) => (
          <Reveal key={p.id} delay={i * 90}>
            <article className={`dl-card${detected === p.id ? " detected" : ""}`}>
              {detected === p.id && <span className="badge dl-detected-badge">Your system</span>}
              <span className="dl-os-glyph" aria-hidden="true">
                {p.glyph}
              </span>
              <h3 className="dl-os-name">{p.name}</h3>
              <p className="dl-formats">{p.formats}</p>
              <p className="dl-note">{p.note}</p>
              <a
                className={`btn${detected === p.id ? " btn-primary" : ""}`}
                href={RELEASES_URL}
                target="_blank"
                rel="noreferrer"
              >
                Get for {p.name}
              </a>
            </article>
          </Reveal>
        ))}
      </div>
      <Reveal delay={120}>
        <p className="dl-under">
          Prefer to build it yourself? Clone the{" "}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            repository
          </a>{" "}
          and run <code>npm run tauri dev</code> — the README covers all three platforms.
        </p>
      </Reveal>
    </section>
  );
}
