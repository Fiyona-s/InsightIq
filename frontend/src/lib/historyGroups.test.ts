import { describe, expect, it } from "vitest";
import type { AnalystRun } from "../api";
import { groupHistory } from "./historyGroups";

const run = (id: string, question: string, created_at: string, dataset_id = "d1") => ({ id, question, created_at, dataset_id, status: "succeeded" }) as AnalystRun;
const now = new Date(2026, 10, 22, 15, 0, 0);

describe("groupHistory (display grouping only)", () => {
  it("splits Today / Yesterday / Earlier, newest first", () => {
    const groups = groupHistory([
      run("a", "Old", new Date(2026, 10, 1, 9).toISOString()),
      run("b", "Today 1", new Date(2026, 10, 22, 9).toISOString()),
      run("c", "Yesterday 1", new Date(2026, 10, 21, 23).toISOString()),
    ], now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Earlier"]);
    expect(groups[0].rows[0].run.id).toBe("b");
  });
  it("shows identical questions on one dataset once, counted, and opens the newest", () => {
    const [today] = groupHistory([
      run("1", "Total  revenue?", new Date(2026, 10, 22, 8).toISOString()),
      run("2", "total revenue?", new Date(2026, 10, 22, 10).toISOString()),
      run("3", "total revenue?", new Date(2026, 10, 22, 11).toISOString(), "d2"),
    ], now);
    expect(today.rows).toHaveLength(2);
    const grouped = today.rows.find((r) => r.count === 2)!;
    expect(grouped.run.id).toBe("2");
    expect(grouped.ids.sort()).toEqual(["1", "2"]);
  });
  it("returns no groups for an empty history and does not change its input", () => {
    expect(groupHistory([], now)).toEqual([]);
    const input = [run("a", "Q", new Date(2026, 10, 22, 9).toISOString())];
    const copy = structuredClone(input);
    groupHistory(input, now);
    expect(input).toEqual(copy);
  });
});
