import { GITHUB_URL, LICENSE_URL, RELEASES_URL } from "@/lib/links";

export function Footer() {
  return (
    <footer className="footer">
      <p className="footer-fade">
        Fade out. <b>The End — of paying for screenwriting software.</b>
      </p>
      <div className="footer-inner">
        <span className="footer-meta">OpenScene · MIT License · No telemetry, ever</span>
        <div className="footer-links">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">
            Releases
          </a>
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">
            License
          </a>
        </div>
      </div>
    </footer>
  );
}
