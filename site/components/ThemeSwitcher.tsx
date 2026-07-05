"use client";

import { useEffect, useState } from "react";
import { THEME_PREFS, applyThemePref, loadThemePref, type ThemePref } from "@/lib/theme";

const LABELS: Record<ThemePref, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
  midnight: "Mid",
};

export function ThemeSwitcher() {
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => {
    setPref(loadThemePref());
  }, []);

  const choose = (next: ThemePref) => {
    setPref(next);
    applyThemePref(next);
  };

  return (
    <div className="theme-seg" role="radiogroup" aria-label="Color theme">
      {THEME_PREFS.map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={pref === t}
          className={pref === t ? "active" : ""}
          onClick={() => choose(t)}
        >
          {LABELS[t]}
        </button>
      ))}
    </div>
  );
}
