import { ScriptDemo } from "./ScriptDemo";
import { GITHUB_URL, RELEASES_URL } from "@/lib/links";

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-grid" />
      <div className="hero-inner">
        <div>
          <p className="hero-kicker">Free · Open Source · Offline-First</p>
          <h1 className="hero-title">
            <span className="line">Write the</span>
            <span className="line">movie.</span>
            <span className="line">Own the file.</span>
          </h1>
          <p className="hero-sub">
            OpenScene is a professional screenwriting app for macOS, Windows, and Linux.
            Industry-perfect pagination, Fountain files you can read forever, and{" "}
            <strong>no accounts, no telemetry, no AI, no paid anything</strong>.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary" href={RELEASES_URL} target="_blank" rel="noreferrer">
              Download for free
            </a>
            <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
              View the source
            </a>
          </div>
          <p className="hero-fineprint">MIT licensed · No sign-up · Works with zero network</p>
        </div>
        <ScriptDemo />
      </div>
    </header>
  );
}
