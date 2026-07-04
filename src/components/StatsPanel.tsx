import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import type { ScriptStats } from "../types";

export function StatsPanel() {
  const script = useApp((s) => s.script);
  const titlePage = useApp((s) => s.titlePage);
  const layoutOptions = useApp((s) => s.layoutOptions);
  const [stats, setStats] = useState<ScriptStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .computeStats({ ...script, title_page: titlePage }, layoutOptions())
        .then((st) => !cancelled && setStats(st))
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [script, titlePage, layoutOptions]);

  if (!stats) {
    return (
      <div className="panel" role="complementary" aria-label="Statistics">
        <div className="panel-header">Statistics</div>
        <div className="panel-empty">Computing…</div>
      </div>
    );
  }

  const ratio = (a: number, b: number) => {
    const total = a + b;
    return total === 0 ? "–" : `${Math.round((a / total) * 100)}% / ${Math.round((b / total) * 100)}%`;
  };

  return (
    <div className="panel" role="complementary" aria-label="Statistics">
      <div className="panel-header">Statistics</div>
      <div className="panel-body stats-body">
        <div className="stat-row">
          <span>Pages</span>
          <strong>{stats.page_count}</strong>
        </div>
        <div className="stat-row">
          <span>Scenes</span>
          <strong>{stats.scene_count}</strong>
        </div>
        <div className="stat-row">
          <span>INT / EXT</span>
          <strong>
            {stats.int_count} / {stats.ext_count} ({ratio(stats.int_count, stats.ext_count)})
          </strong>
        </div>
        <div className="stat-row">
          <span>DAY / NIGHT</span>
          <strong>
            {stats.day_count} / {stats.night_count} ({ratio(stats.day_count, stats.night_count)})
          </strong>
        </div>
        <div className="stat-row">
          <span>Dialogue words</span>
          <strong>{stats.dialogue_words}</strong>
        </div>
        <div className="stat-row">
          <span>Action words</span>
          <strong>{stats.action_words}</strong>
        </div>

        <h3 className="stats-subhead">Characters</h3>
        {stats.characters.map((c) => (
          <div className="stat-row" key={c.name}>
            <span>{c.name}</span>
            <strong>
              {c.words}w · {c.speeches} speeches · {c.scenes} scenes
            </strong>
          </div>
        ))}
        {stats.characters.length === 0 && <div className="panel-empty">No characters yet.</div>}

        <h3 className="stats-subhead">Locations</h3>
        {stats.locations.map((l) => (
          <div className="stat-row" key={l}>
            <span>{l}</span>
          </div>
        ))}
        {stats.locations.length === 0 && <div className="panel-empty">No locations yet.</div>}
      </div>
    </div>
  );
}
