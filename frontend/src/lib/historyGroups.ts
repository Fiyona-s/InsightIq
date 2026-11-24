import type { AnalystRun } from "../api";

export type HistoryRow = { run: AnalystRun; count: number; ids: string[] };
export type HistoryGroup = { label: "Today" | "Yesterday" | "Earlier"; rows: HistoryRow[] };

const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * Display grouping of the saved question history (nothing is changed or stored).
 * Newest first. Identical questions on the same dataset show once, "asked 2x"; the newest one opens.
 */
export function groupHistory(runs: AnalystRun[], now: Date = new Date()): HistoryGroup[] {
  const today = dayStart(now), yesterday = today - 86_400_000;
  const sorted = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const groups: HistoryGroup[] = [];
  const seen = new Map<string, HistoryRow>();
  for (const run of sorted) {
    const when = dayStart(new Date(run.created_at));
    const label: HistoryGroup["label"] = when >= today ? "Today" : when >= yesterday ? "Yesterday" : "Earlier";
    const key = run.dataset_id + "|" + run.question.trim().replace(/\s+/g, " ").toLowerCase();
    const found = seen.get(key);
    if (found) { found.count += 1; found.ids.push(run.id); continue; }
    const row: HistoryRow = { run, count: 1, ids: [run.id] };
    seen.set(key, row);
    let group = groups.find((g) => g.label === label);
    if (!group) { group = { label, rows: [] }; groups.push(group); }
    group.rows.push(row);
  }
  return groups;
}
