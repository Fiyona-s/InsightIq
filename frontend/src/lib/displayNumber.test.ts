import { describe, expect, it } from "vitest";
import { displayAmount, displayExact, formatDisplayNumber } from "./displayNumber";
import { displayMoney } from "./currency";
import { answerSentence, findings } from "./analystPresentation";
import { estimatedCost } from "./runPresentation";
import { mlValue } from "../components/AutoMLResults";
import type { AnalystResults } from "../api";

// Approved fix 3b: display-only rounding. Values below are the exact ones seen in the Stage 0 audit.
describe("display-only rounding of non-currency numbers", () => {
  it("rounds the audit examples for reading", () => {
    expect(formatDisplayNumber(8379680.760000008)).toBe("8,379,680.76");      // answer sentence / KPI
    expect(formatDisplayNumber(2224787.6999999997)).toBe("2,224,787.7");      // "West is highest at …"
    expect(formatDisplayNumber(0.7103658536585366)).toBe("0.7104");           // AutoML Macro F1
    expect(formatDisplayNumber(0.9582463465553236)).toBe("0.9582");           // AutoML accuracy card
    expect(formatDisplayNumber(0.0013200000000000002)).toBe("0.00132");       // Run Analytics cost
  });

  it("keeps whole numbers and big integers exact, and handles edge values", () => {
    expect(formatDisplayNumber(2400)).toBe("2,400");
    expect(formatDisplayNumber("2400")).toBe("2,400");
    expect(formatDisplayNumber("12345678901234567890")).toBe("12,345,678,901,234,567,890");
    expect(formatDisplayNumber(-1234.5678)).toBe("-1,234.57");
    expect(formatDisplayNumber(0)).toBe("0");
    expect(formatDisplayNumber(null)).toBe("—");
    expect(formatDisplayNumber(Number.NaN)).toBe("—");
  });

  it("never changes how confirmed-currency amounts are shown (currency path untouched)", () => {
    const money = { currency: "INR", mixed: false } as Parameters<typeof displayMoney>[1];
    for (const v of [8379680.760000008, "8379680.760000008", 1299, 0.5])
      expect(displayAmount(v, money, undefined, "DOUBLE")).toBe(displayMoney(v, money, undefined, "DOUBLE"));
  });

  it("does not change the underlying value", () => {
    const value = 8379680.760000008;
    formatDisplayNumber(value);
    expect(value).toBe(8379680.760000008);
  });
});

describe("audit surfaces use the display rounding", () => {
  const scalar = (v: unknown): AnalystResults => ({ columns: [{ name: "total_revenue", type: "DOUBLE" }], rows: [[v as number]], row_count: 1, offset: 0, expires_in_seconds: 600 });
  it("answer sentence", () => {
    expect(answerSentence(scalar(8379680.760000008))).toBe("Your total revenue is 8,379,680.76.");
  });
  it("highest-value finding", () => {
    const result: AnalystResults = { columns: [{ name: "region", type: "VARCHAR" }, { name: "total_revenue", type: "DOUBLE" }], rows: [["West", 2224787.6999999997], ["East", 2079849.2299999984]], row_count: 2, offset: 0, expires_in_seconds: 600 };
    const chart = { points: [{ row: 0, label: "West", value: 2224787.6999999997 }, { row: 1, label: "East", value: 2079849.2299999984 }] } as unknown as Parameters<typeof findings>[1];
    const facts = [{ id: "f6", method: "top_n", source: { rows: [0], columns: [1] } }] as unknown as Parameters<typeof findings>[2];
    expect(findings(result, chart, facts)[0].text).toBe("West is highest at 2,224,787.7.");
  });
  it("estimated cost and AutoML metric values", () => {
    expect(estimatedCost(0.0013200000000000002)).toBe("$0.00132");
    expect(mlValue(0.7103658536585366)).toBe("0.7104");
  });
});

describe("calculation details show exact values", () => {
  it("does not round non-currency numbers (the audit values stay exact)", () => {
    expect(displayExact(8379680.760000008)).toBe("8,379,680.760000008");
    expect(displayExact(2224787.6999999997)).toBe("2,224,787.6999999997");
    expect(displayExact("8379680.760000008", undefined, undefined, "DOUBLE")).toBe("8,379,680.760000008");
    expect(displayExact(0.7103658536585366)).toBe("0.7103658536585366");
    expect(displayExact(2400)).toBe("2,400");
  });
  it("headline rounding and exact detail are different on purpose", () => {
    expect(displayAmount(8379680.760000008)).toBe("8,379,680.76");
    expect(displayExact(8379680.760000008)).not.toBe(displayAmount(8379680.760000008));
  });
  it("leaves confirmed-currency values on the unchanged currency path", () => {
    const money = { currency: "INR", mixed: false } as Parameters<typeof displayMoney>[1];
    for (const v of [8379680.760000008, "8379680.760000008", 1299]) expect(displayExact(v, money, undefined, "DOUBLE")).toBe(displayMoney(v, money, undefined, "DOUBLE"));
  });
});
