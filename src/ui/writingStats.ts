// Daily writing tally + streaks, stored locally (no telemetry, ever).

const KEY = "openscene.writingHistory";

type History = Record<string, number>; // "YYYY-MM-DD" -> words added

function load(): History {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as History;
  } catch {
    return {};
  }
}

function save(h: History) {
  try {
    // Keep a year of history.
    const entries = Object.entries(h).sort().slice(-366);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // best-effort
  }
}

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Record `n` new words written (positive deltas only). */
export function addWords(n: number) {
  if (n <= 0) return;
  const h = load();
  const k = todayKey();
  h[k] = (h[k] ?? 0) + n;
  save(h);
}

export function todayWords(): number {
  return load()[todayKey()] ?? 0;
}

/** Consecutive days (ending today or yesterday) with words written. */
export function streak(): number {
  const h = load();
  let count = 0;
  const day = new Date();
  // A streak survives until the end of today.
  if (!h[todayKey(day)]) day.setDate(day.getDate() - 1);
  while (h[todayKey(day)] && h[todayKey(day)] > 0) {
    count++;
    day.setDate(day.getDate() - 1);
  }
  return count;
}

/** Last `n` days, oldest first: [date, words]. */
export function recentDays(n: number): [string, number][] {
  const h = load();
  const out: [string, number][] = [];
  const day = new Date();
  day.setDate(day.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const k = todayKey(day);
    out.push([k, h[k] ?? 0]);
    day.setDate(day.getDate() + 1);
  }
  return out;
}
