import { ThemeSwitcher } from "./ThemeSwitcher";
import { GITHUB_URL, RELEASES_URL } from "@/lib/links";

export function Nav() {
  return (
    <nav className="nav">
      <a className="nav-brand" href="#top">
        <span className="brand-mark">◆</span> OpenScene
      </a>
      <div className="nav-links">
        <a className="nav-link" href="#features">
          Features
        </a>
        <a className="nav-link" href="#themes">
          Themes
        </a>
        <a className="nav-link" href="#philosophy">
          Philosophy
        </a>
        <a className="nav-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <ThemeSwitcher />
        <a className="btn btn-primary nav-cta" href={RELEASES_URL} target="_blank" rel="noreferrer">
          Download
        </a>
      </div>
    </nav>
  );
}
