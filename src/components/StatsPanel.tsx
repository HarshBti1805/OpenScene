import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useApp } from "../store";
import { addWords, recentDays, streak, todayWords } from "../ui/writingStats";
import type { ScriptStats } from "../types";
import { t } from "../i18n";

export function StatsPanel() {
  const script = useApp((s) => s.script);
  const titlePage = useApp((s) => s.titlePage);
  const projectPath = useApp((s) => s.projectPath);
  const layoutOptions = useApp((s) => s.layoutOptions);
  const [stats, setStats] = useState<ScriptStats | null>(null);
  const lastWordsRef = useRef<number | null>(null);

  // Reset the words baseline when a different project/document opens.
  useEffect(() => {
    lastWordsRef.current = null;
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .computeStats({ ...script, title_page: titlePage }, layoutOptions())
        .then((st) => {
          if (cancelled) return;
          setStats(st);
          // Daily writing tally: positive word deltas only.
          const total = st.dialogue_words + st.action_words;
          if (lastWordsRef.current !== null) {
            addWords(total - lastWordsRef.current);
          }
          lastWordsRef.current = total;
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [script, titlePage, layoutOptions]);

  if (!stats) {
    return (
      <div className="panel" role="complementary" aria-label={t("panel.stats")}>
        <div className="panel-header">{t("panel.stats")}</div>
        <div className="panel-empty">{t("panel.computing")}</div>
      </div>
    );
  }

  const ratio = (a: number, b: number) => {
    const total = a + b;
    return total === 0 ? "–" : `${Math.round((a / total) * 100)}% / ${Math.round((b / total) * 100)}%`;
  };

  return (
    <div className="panel" role="complementary" aria-label={t("panel.stats")}>
      <div className="panel-header">{t("panel.stats")}</div>
      <div className="panel-body stats-body">
        <div className="stat-row">
          <span>{t("stats.pages")}</span>
          <strong>{stats.page_count}</strong>
        </div>
        <div className="stat-row">
          <span>{t("stats.scenes")}</span>
          <strong>{stats.scene_count}</strong>
        </div>
        <div className="stat-row">
          <span>{t("stats.runtime")}</span>
          <strong>{t("stats.minutes", { n: Math.round(stats.estimated_minutes ?? stats.page_count) })}</strong>
        </div>
        <div className="stat-row">
          <span>{t("stats.intExt")}</span>
          <strong>
            {stats.int_count} / {stats.ext_count} ({ratio(stats.int_count, stats.ext_count)})
          </strong>
        </div>
        <div className="stat-row">
          <span>{t("stats.dayNight")}</span>
          <strong>
            {stats.day_count} / {stats.night_count} ({ratio(stats.day_count, stats.night_count)})
          </strong>
        </div>
        <div className="stat-row">
          <span>{t("stats.dialogueWords")}</span>
          <strong>{stats.dialogue_words}</strong>
        </div>
        <div className="stat-row">
          <span>{t("stats.actionWords")}</span>
          <strong>{stats.action_words}</strong>
        </div>

        <h3 className="stats-subhead">{t("stats.characters")}</h3>
        {stats.characters.map((c) => (
          <div className="stat-row" key={c.name}>
            <span>{c.name}</span>
            <strong>
              {t("stats.charLine", { words: c.words, speeches: c.speeches, scenes: c.scenes })}
            </strong>
          </div>
        ))}
        {stats.characters.length === 0 && <div className="panel-empty">{t("panel.emptyCharacters")}</div>}

        <h3 className="stats-subhead">{t("stats.locations")}</h3>
        {stats.locations.map((l) => (
          <div className="stat-row" key={l}>
            <span>{l}</span>
          </div>
        ))}
        {stats.locations.length === 0 && <div className="panel-empty">{t("panel.emptyLocations")}</div>}

        <SprintSection stats={stats} />
        <GenderSection stats={stats} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Writing sprints, session goals, daily streaks (all local)
// ---------------------------------------------------------------------------

function SprintSection({ stats }: { stats: ScriptStats }) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(25);
  const [target, setTarget] = useState(250);
  const [baseline, setBaseline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const setStatus = useApp((s) => s.setStatus);

  const total = stats.dialogue_words + stats.action_words;
  const running = endsAt !== null && now < endsAt;
  const written = Math.max(0, total - baseline);

  useEffect(() => {
    if (endsAt === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [endsAt]);

  useEffect(() => {
    if (endsAt !== null && now >= endsAt) {
      setEndsAt(null);
      setStatus(t("sprint.done", { words: written, target }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, endsAt]);

  const remaining = running ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <>
      <h3 className="stats-subhead">{t("sprint.title")}</h3>
      {running ? (
        <>
          <div className="sprint-clock" aria-live="off">
            {mm}:{ss}
          </div>
          <div className="stat-row">
            <span>{t("sprint.progress")}</span>
            <strong>
              {written} / {target}
            </strong>
          </div>
          <button className="btn btn-small" onClick={() => setEndsAt(null)}>
            {t("sprint.stop")}
          </button>
        </>
      ) : (
        <div className="sprint-setup">
          <label className="find-toggle">
            {t("sprint.minutes")}
            <input
              type="number"
              className="input fmt-num"
              min={5}
              max={90}
              value={minutes}
              aria-label={t("sprint.minutes")}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
          <label className="find-toggle">
            {t("sprint.target")}
            <input
              type="number"
              className="input fmt-num"
              min={0}
              step={50}
              value={target}
              aria-label={t("sprint.target")}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </label>
          <button
            className="btn btn-small btn-primary"
            onClick={() => {
              setBaseline(total);
              setEndsAt(Date.now() + minutes * 60000);
              setNow(Date.now());
            }}
          >
            {t("sprint.start")}
          </button>
        </div>
      )}
      <div className="stat-row">
        <span>{t("sprint.today")}</span>
        <strong>{todayWords()}w</strong>
      </div>
      <div className="stat-row">
        <span>{t("sprint.streak")}</span>
        <strong>{t("sprint.days", { n: streak() })}</strong>
      </div>
      <div className="streak-bars" aria-label={t("sprint.history")}>
        {recentDays(14).map(([date, words]) => (
          <span
            key={date}
            className={`streak-bar${words > 0 ? " lit" : ""}`}
            style={{ height: `${Math.min(24, 4 + Math.sqrt(words))}px` }}
            title={`${date}: ${words}w`}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Gender / inclusivity analysis (optional metadata, fully local)
// ---------------------------------------------------------------------------

const GENDERS = ["", "woman", "man", "nonbinary", "other"] as const;

function GenderSection({ stats }: { stats: ScriptStats }) {
  const projectPath = useApp((s) => s.projectPath);
  const projectMeta = useApp((s) => s.projectMeta);
  const setStatus = useApp((s) => s.setStatus);
  const genders = projectMeta?.genders ?? {};

  const setGender = async (name: string, gender: string) => {
    if (!projectPath || !projectMeta) return;
    const next = { ...genders };
    if (gender) next[name] = gender;
    else delete next[name];
    const meta = { ...projectMeta, genders: next };
    useApp.setState({ projectMeta: meta });
    await api.saveProjectMeta(projectPath, meta).catch(() => {});
  };

  // Aggregate by gender.
  const agg = new Map<string, { words: number; speeches: number; scenes: number; n: number }>();
  for (const c of stats.characters) {
    const g = genders[c.name] || "unspecified";
    const row = agg.get(g) ?? { words: 0, speeches: 0, scenes: 0, n: 0 };
    row.words += c.words;
    row.speeches += c.speeches;
    row.scenes += c.scenes;
    row.n += 1;
    agg.set(g, row);
  }
  const totalWords = stats.dialogue_words || 1;

  const exportCsv = async () => {
    const file = await save({
      defaultPath: "gender-analysis.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!file) return;
    const lines = ["gender,characters,dialogue_words,share,speeches,scene_presences"];
    for (const [g, row] of agg) {
      lines.push(
        `${g},${row.n},${row.words},${((row.words / totalWords) * 100).toFixed(1)}%,${row.speeches},${row.scenes}`,
      );
    }
    lines.push("");
    lines.push("character,gender,dialogue_words,speeches,scenes");
    for (const c of stats.characters) {
      lines.push(`${c.name},${genders[c.name] ?? ""},${c.words},${c.speeches},${c.scenes}`);
    }
    await api.exportTextFile(file, lines.join("\n")).catch((e) => setStatus(String(e)));
    setStatus(t("gender.exported"));
  };

  if (stats.characters.length === 0) return null;

  return (
    <>
      <h3 className="stats-subhead">{t("gender.title")}</h3>
      <p className="panel-hint" style={{ padding: "0 0 6px" }}>
        {t("gender.hint")}
      </p>
      {[...agg.entries()].map(([g, row]) => (
        <div className="stat-row" key={g}>
          <span>{t(`gender.${g}` as never) === `gender.${g}` ? g : t(`gender.${g}` as never)}</span>
          <strong>
            {((row.words / totalWords) * 100).toFixed(0)}% · {row.words}w · {row.n}
          </strong>
        </div>
      ))}
      {stats.characters.map((c) => (
        <div className="stat-row" key={c.name}>
          <span>{c.name}</span>
          <select
            className="input fmt-align"
            style={{ width: 110 }}
            value={genders[c.name] ?? ""}
            aria-label={t("gender.assignAria", { name: c.name })}
            onChange={(e) => void setGender(c.name, e.target.value)}
          >
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g === "" ? t("gender.unspecified") : t(`gender.${g}` as never)}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button className="btn btn-small" onClick={exportCsv} style={{ marginTop: 8 }}>
        {t("gender.export")}
      </button>
    </>
  );
}
