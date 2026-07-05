"use client";

import { useEffect, useState } from "react";
import { Reveal } from "./Reveal";
import { GITHUB_URL, RELEASES_URL } from "@/lib/links";
import { fetchLatestRelease, type LatestRelease, type Platform } from "@/lib/releases";

const PLATFORMS: {
  id: Platform;
  glyph: string;
  name: string;
  note: string;
}[] = [
  {
    id: "mac",
    glyph: "⌘",
    name: "macOS",
    note: "Unsigned build: on first launch, right-click the app and choose Open to pass Gatekeeper.",
  },
  {
    id: "windows",
    glyph: "❖",
    name: "Windows",
    note: "SmartScreen will warn on unsigned installers — choose More info, then Run anyway.",
  },
  {
    id: "linux",
    glyph: "▲",
    name: "Linux",
    note: "AppImage is portable — make it executable and run. A first-class target, not an afterthought.",
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
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setDetected(detectPlatform());
    fetchLatestRelease().then((r) => {
      setRelease(r);
      setLoading(false);
    });
  }, []);

  return (
    <section className="section" id="download">
      <Reveal>
        <p className="section-kicker">Roll Camera</p>
        <h2 className="section-title">Download. Write. That&apos;s the whole funnel.</h2>
        <p className="section-sub">
          Pick your installer — the download starts immediately. No email gate, no trial clock, no
          upsell waiting on page two.
          {release?.version && (
            <>
              {" "}
              <span className="edgecode">Latest: {release.version}</span>
            </>
          )}
        </p>
      </Reveal>
      <div className="dl-grid">
        {PLATFORMS.map((p, i) => {
          const assets = release?.assets[p.id] ?? [];
          return (
            <Reveal key={p.id} delay={i * 90}>
              <article className={`dl-card${detected === p.id ? " detected" : ""}`}>
                {detected === p.id && <span className="badge dl-detected-badge">Your system</span>}
                <span className="dl-os-glyph" aria-hidden="true">
                  {p.glyph}
                </span>
                <h3 className="dl-os-name">{p.name}</h3>
                <p className="dl-note">{p.note}</p>
                <div className="dl-assets">
                  {loading && <span className="dl-assets-loading">Fetching installers…</span>}
                  {!loading && assets.length === 0 && (
                    <a className="btn" href={RELEASES_URL} target="_blank" rel="noreferrer">
                      Browse releases
                    </a>
                  )}
                  {assets.map((a) => (
                    <a key={a.url} className="dl-asset" href={a.url} download>
                      <span className="dl-asset-ext">{a.detail}</span>
                      <span className="dl-asset-label">{a.label}</span>
                      <span className="dl-asset-size">{a.sizeMb}</span>
                      <span className="dl-asset-arrow" aria-hidden="true">
                        ↓
                      </span>
                    </a>
                  ))}
                </div>
              </article>
            </Reveal>
          );
        })}
      </div>
      <Reveal delay={120}>
        <p className="dl-under">
          All builds and checksums live on the{" "}
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">
            releases page
          </a>
          . Prefer to build it yourself? Clone the{" "}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            repository
          </a>{" "}
          and run <code>npm run tauri dev</code>.
        </p>
      </Reveal>
    </section>
  );
}
