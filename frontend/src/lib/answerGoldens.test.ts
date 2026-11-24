import { describe, expect, it } from "vitest";
import { answerSentence, findings, leadSentence } from "./analystPresentation";
import type { AnalystResults } from "../api";

/** PRODUCT-POLISH P2: golden answers. Controlled fixtures only; each expected sentence is exactly what an owner reads first. */
const res = (columns: AnalystResults["columns"], rows: AnalystResults["rows"]): AnalystResults => ({ columns, rows, row_count: rows.length, offset: 0, expires_in_seconds: 0 });
const col = (name: string, type: string, extra: object = {}) => ({ name, type, ...extra }) as AnalystResults["columns"][number];
const chart = (label: string, value: number) => ({ spec: { kind: "bar" as const, x: 0, y: 1, title: "t", null_policy: "omit_with_count" as const, zero_baseline: true as const }, points: [{ row: 0, label, value, y: value }], note: "", omitted_rows: 0 });
const top = (id = "f1") => [{ id, method: "top_n", value: "1", statement: "technical prose is never shown", source: { columns: [1, 0], rows: [0], result_digest: "d", formula: "rank", scope: "returned" } }];

describe("golden answers", () => {
  it("one number: a plain sentence with thousands separators and no unit unless confirmed", () => {
    expect(answerSentence(res([col("total_revenue", "DOUBLE")], [[1250000.5]]))).toBe("Your total revenue is 1,250,000.5.");
    expect(answerSentence(res([col("order_count", "BIGINT")], [[12345]]))).toBe("Your order count is 12,345.");
  });
  it("a confirmed percentage and confirmed money get their unit, nothing else does", () => {
    expect(answerSentence(res([col("discount_pct", "DOUBLE", { percent: true })], [[12.5]]))).toContain("12.5%");
    expect(answerSentence(res([col("revenue", "DOUBLE")], [[10]]))).not.toMatch(/[$₹€£%]/);
  });
  it("a grouped result leads with one sentence naming the top group, built from the source-linked finding", () => {
    const r = res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], [["West", 2100], ["North", 1950], ["East", 900], ["South", 320]]);
    const notes = findings(r, chart("West", 2100), top());
    expect(leadSentence(answerSentence(r), notes)).toBe("Total revenue by region: West is highest at 2,100.");
  });
  it("without a source-linked finding the sentence is the plain row summary, and says nothing more", () => {
    const r = res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], [["West", 2100], ["East", 900]]);
    expect(leadSentence(answerSentence(r), [])).toBe("Total revenue by region: 2 rows.");
  });
  it("no rows is one plain sentence", () => {
    expect(answerSentence(res([col("region", "VARCHAR")], []))).toBe("No rows matched this question.");
  });
  it("a table with no measure says how many rows and which columns, in plain words", () => {
    expect(answerSentence(res([col("order_id", "VARCHAR"), col("region", "VARCHAR")], [["1", "North"], ["2", "South"]]))).toBe("2 rows with order id, region.");
  });
  it("large counts use separators in the row summary", () => {
    const rows = Array.from({ length: 12345 }, (_, i) => [String(i), i]);
    expect(answerSentence({ ...res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], []), rows: rows as never, row_count: 12345 })).toBe("Total revenue by region: 12,345 rows.");
  });
  it("jargon never reaches the lead sentence", () => {
    const text = answerSentence(res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], [["West", 1]]));
    expect(text).not.toMatch(/SQL|NULL|VARCHAR|DOUBLE|aggregate|query/i);
  });
  it("a tie for the top value is said so, never picked silently", () => {
    const two = res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], [["North", 2100], ["West", 2100], ["East", 900]]);
    expect(leadSentence(answerSentence(two), findings(two, chart("North", 2100), top()), two)).toBe("Total revenue by region: North and West are tied for highest at 2,100.");
    const three = res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], [["North", 5], ["West", 5], ["East", 5], ["South", 1]]);
    expect(leadSentence(answerSentence(three), [], three)).toBe("Total revenue by region: North, West and East are tied for highest at 5.");
  });
  it("every group equal is said as 'all are', including all zero", () => {
    const zeros = res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], [["North", 0], ["West", 0]]);
    expect(leadSentence(answerSentence(zeros), findings(zeros, chart("North", 0), top()), zeros)).toBe("Total revenue by region: all 2 are 0.");
  });
  it("zero values: a zero top among smaller negatives is still reported honestly", () => {
    const r = res([col("region", "VARCHAR"), col("profit", "DOUBLE")], [["North", 0], ["West", -40], ["East", -5]]);
    expect(leadSentence(answerSentence(r), [{ text: "North is highest at 0." }], r)).toBe("Profit by region: North is highest at 0.");
  });
  it("negative values keep their minus sign and the top is the largest", () => {
    const r = res([col("region", "VARCHAR"), col("profit", "DOUBLE")], [["North", -10], ["West", -40], ["East", -10]]);
    expect(leadSentence(answerSentence(r), [], r)).toBe("Profit by region: North and East are tied for highest at -10.");
    expect(answerSentence(res([col("profit", "DOUBLE")], [[-1250.5]]))).toBe("Your profit is -1,250.5.");
  });
  it("a single-row result names the row and says nothing about why", () => {
    expect(answerSentence(res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], [["East", 109219.5]]))).toBe("East — total revenue: 109,219.5");
    expect(answerSentence(res([col("total_revenue", "DOUBLE")], [[0]]))).toBe("Your total revenue is 0.");
  });
  it("a partly loaded table never claims a tie", () => {
    const partial = { ...res([col("region", "VARCHAR"), col("total_revenue", "DOUBLE")], [["North", 5], ["West", 5]]), row_count: 40 };
    expect(leadSentence(answerSentence(partial), [], partial)).toBe("Total revenue by region: 40 rows.");
  });
});
