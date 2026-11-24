import { describe, expect, it } from "vitest";
import { tileTitle } from "./tileTitle";

const w = (o: Record<string, unknown>) => ({ title: "", display_title: null, custom_title: null, ...o }) as never;
describe("tile titles", () => {
  it("shows the owner's saved text exactly as written", () => {
    expect(tileTitle(w({ title: "Total revenue", display_title: "Total Revenue" }))).toBe("Total revenue");
    expect(tileTitle(w({ title: "Sales by region (North)", display_title: "Sales By Region (North)" }))).toBe("Sales by region (North)");
  });
  it("uses the readable form only for a system-generated name made from a column", () => {
    expect(tileTitle(w({ title: "total_recognized_revenue_inr by category", display_title: "Total Recognized Revenue by Category" }))).toBe("Total Recognized Revenue by Category");
  });
  it("always shows a title the owner renamed, as typed", () => {
    expect(tileTitle(w({ title: "total_revenue", display_title: "my numbers", custom_title: "my numbers" }))).toBe("my numbers");
  });
  it("falls back to a neutral label rather than inventing one", () => {
    expect(tileTitle(w({}))).toBe("Insight note");
  });
});
