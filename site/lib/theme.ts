export type ThemePref = "system" | "light" | "dark" | "midnight";
export type ResolvedTheme = "light" | "dark" | "midnight";

export const THEME_PREFS: ThemePref[] = ["system", "light", "dark", "midnight"];

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref !== "system") return pref;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function loadThemePref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem("os-theme");
  return THEME_PREFS.includes(stored as ThemePref) ? (stored as ThemePref) : "system";
}

/** Applies the theme with the app's soft 150ms color-only crossfade. */
export function applyThemePref(pref: ThemePref) {
  window.localStorage.setItem("os-theme", pref);
  const root = document.documentElement;
  const resolved = resolveTheme(pref);
  if (root.getAttribute("data-theme") === resolved) return;
  root.classList.add("theme-switching");
  root.setAttribute("data-theme", resolved);
  window.setTimeout(() => root.classList.remove("theme-switching"), 220);
}
