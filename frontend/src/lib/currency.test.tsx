import { describe, it, expect } from "vitest";
import { displayMoney, multiply } from "./currency";
describe("currency display from immutable originals", () => {
  it("formats USD, INR, locales, negatives, zero, null and JPY", () => {
    expect(displayMoney(1250000, { currency: "USD" })).toBe("$1,250,000.00");
    expect(displayMoney(1250000, { currency: "INR" })).toBe("₹12,50,000.00");
    expect(
      displayMoney(
        1250000,
        { currency: "INR" },
        { quotes: {}, locale: "en-US" },
      ),
    ).toBe("₹1,250,000.00");
    expect(displayMoney(-1.2, { currency: "USD" })).toBe("-$1.20");
    expect(displayMoney(0, { currency: "USD" })).toBe("$0.00");
    expect(displayMoney(null, { currency: "USD" })).toBe("NULL");
    expect(displayMoney(15.8, { currency: "JPY" })).toBe("¥16");
  });
  it("retains nonmonetary and unknown units", () => {
    expect(displayMoney(1250000)).toBe("1,250,000");
    expect(displayMoney(12, { currency: null })).toBe("12");
    expect(displayMoney(12, { currency: "USD", mixed: true })).toBe("12");
  });
  it("multiplies exact decimal originals across target switches", () => {
    expect(multiply("0.1", "0.2")).toBe("0.02");
    expect(multiply("1250000", "0.0125")).toBe("15625.0000");
    expect(multiply("1250000", "0.01")).toBe("12500.00");
    expect(multiply("-1e-3", "2e2")).toBe("-0.2");
    expect(displayMoney("9007199254740993.25", { currency: "USD" })).toBe(
      "$9,007,199,254,740,993.25",
    );
  });
});

it("formats the audited full-precision INR and USD amount without changing it", () => {
  const original = "8379680.760000008";
  expect(displayMoney(original, { currency: "INR" })).toBe("₹83,79,680.76");
  expect(displayMoney(original, { currency: "USD" })).toBe("$8,379,680.76");
  expect(original).toBe("8379680.760000008");
});
