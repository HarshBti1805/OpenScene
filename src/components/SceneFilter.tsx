import { useMemo } from "react";
import { useApp, useScenes } from "../store";
import type { SceneInfo, Script } from "../types";
import { t } from "../i18n";

export interface SceneFilterState {
  character: string;
  location: string;
  intExt: "" | "int" | "ext";
  dayNight: "" | "day" | "night";
  color: string;
}

export const EMPTY_FILTER: SceneFilterState = {
  character: "",
  location: "",
  intExt: "",
  dayNight: "",
  color: "",
};

export function filterActive(f: SceneFilterState): boolean {
  return Boolean(f.character || f.location || f.intExt || f.dayNight || f.color);
}

function cueBase(text: string): string {
  const i = text.indexOf("(");
  return (i >= 0 ? text.slice(0, i) : text).trim().toUpperCase();
}

function locationOf(heading: string): string {
  let u = heading.trim().toUpperCase();
  for (const p of ["INT./EXT.", "INT/EXT.", "I/E.", "INT.", "EXT.", "EST."]) {
    if (u.startsWith(p)) {
      u = u.slice(p.length);
      break;
    }
  }
  const dash = u.lastIndexOf(" - ");
  return (dash >= 0 ? u.slice(0, dash) : u).trim();
}

interface SceneDetails {
  characters: Set<string>;
  location: string;
  isInt: boolean;
  isExt: boolean;
  isDay: boolean;
  isNight: boolean;
}

/** Per-scene facts for filtering: characters present, location, INT/EXT, D/N. */
export function useSceneDetails(script: Script): Map<number, SceneDetails> {
  return useMemo(() => {
    const map = new Map<number, SceneDetails>();
    let cur: SceneDetails | null = null;
    script.elements.forEach((e, i) => {
      if (e.kind === "scene_heading" || e.kind === "omitted") {
        const u = e.text.toUpperCase();
        cur = {
          characters: new Set(),
          location: e.kind === "omitted" ? "" : locationOf(e.text),
          isInt: u.startsWith("INT") || u.startsWith("I/E"),
          isExt: u.startsWith("EXT") || u.startsWith("INT./EXT") || u.startsWith("I/E"),
          isDay: u.includes("DAY"),
          isNight: u.includes("NIGHT"),
        };
        map.set(i, cur);
      } else if (cur && e.kind === "character") {
        const base = cueBase(e.text);
        if (base) cur.characters.add(base);
      }
    });
    return map;
  }, [script]);
}

export function applySceneFilter(
  scenes: SceneInfo[],
  details: Map<number, SceneDetails>,
  f: SceneFilterState,
): SceneInfo[] {
  if (!filterActive(f)) return scenes;
  return scenes.filter((sc) => {
    const d = details.get(sc.elementIndex);
    if (!d) return false;
    if (f.character && !d.characters.has(f.character)) return false;
    if (f.location && d.location !== f.location) return false;
    if (f.intExt === "int" && !d.isInt) return false;
    if (f.intExt === "ext" && !d.isExt) return false;
    if (f.dayNight === "day" && !d.isDay) return false;
    if (f.dayNight === "night" && !d.isNight) return false;
    if (f.color && sc.color !== f.color) return false;
    return true;
  });
}

/** The filter chip bar shared by the navigator and index cards. */
export function SceneFilterBar({ total, shown }: { total: number; shown: number }) {
  const filter = useApp((s) => s.sceneFilter);
  const setFilter = useApp((s) => s.setSceneFilter);
  const script = useApp((s) => s.script);
  const scenes = useScenes();

  const characters = useMemo(
    () =>
      Array.from(
        new Set(
          script.elements
            .filter((e) => e.kind === "character")
            .map((e) => cueBase(e.text))
            .filter(Boolean),
        ),
      ).sort(),
    [script],
  );
  const locations = useMemo(
    () =>
      Array.from(
        new Set(
          script.elements
            .filter((e) => e.kind === "scene_heading")
            .map((e) => locationOf(e.text))
            .filter(Boolean),
        ),
      ).sort(),
    [script],
  );
  const colors = useMemo(
    () => Array.from(new Set(scenes.map((s) => s.color).filter((c): c is string => Boolean(c)))),
    [scenes],
  );

  const active = filterActive(filter);
  const set = (patch: Partial<SceneFilterState>) => setFilter({ ...filter, ...patch });

  return (
    <div className="filter-bar" role="group" aria-label={t("filter.aria")}>
      <select
        className="input filter-select"
        value={filter.character}
        aria-label={t("filter.character")}
        onChange={(e) => set({ character: e.target.value })}
      >
        <option value="">{t("filter.anyCharacter")}</option>
        {characters.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        className="input filter-select"
        value={filter.location}
        aria-label={t("filter.location")}
        onChange={(e) => set({ location: e.target.value })}
      >
        <option value="">{t("filter.anyLocation")}</option>
        {locations.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <div className="filter-chip-row">
        {(
          [
            ["intExt", "int", t("filter.int")],
            ["intExt", "ext", t("filter.ext")],
            ["dayNight", "day", t("filter.day")],
            ["dayNight", "night", t("filter.night")],
          ] as const
        ).map(([key, val, label]) => {
          const on = filter[key] === val;
          return (
            <button
              key={`${key}-${val}`}
              className={`scope-chip${on ? " active" : ""}`}
              aria-pressed={on}
              onClick={() => set({ [key]: on ? "" : val } as Partial<SceneFilterState>)}
            >
              {label}
            </button>
          );
        })}
        {colors.map((c) => (
          <button
            key={c}
            className={`filter-color${filter.color === c ? " active" : ""}`}
            style={{ background: c }}
            aria-pressed={filter.color === c}
            aria-label={t("filter.colorAria", { color: c })}
            onClick={() => set({ color: filter.color === c ? "" : c })}
          />
        ))}
      </div>
      {active && (
        <div className="filter-status" aria-live="polite">
          <span className="edgecode">{t("filter.showing", { shown, total })}</span>
          <button className="btn btn-small btn-ghost" onClick={() => setFilter(EMPTY_FILTER)}>
            {t("filter.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
