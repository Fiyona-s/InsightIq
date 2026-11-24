import { describe, expect, it } from "vitest";
import { ANALYSIS_TYPES, TYPE_LABELS, typeLabel } from "./typeLabels";

describe("plain type labels map one-to-one to the stored types", () => {
  it("covers exactly the six analysis types, each with its own label", () => {
    expect([...ANALYSIS_TYPES].sort()).toEqual(["BIGINT", "BOOLEAN", "DATE", "DOUBLE", "TIMESTAMP", "VARCHAR"]);
    expect(new Set(Object.values(TYPE_LABELS)).size).toBe(ANALYSIS_TYPES.length);
    expect(TYPE_LABELS).toMatchObject({ VARCHAR: "Text", BIGINT: "Whole number", DOUBLE: "Decimal number", DATE: "Date" });
  });
  it("never invents a label for an unknown type", () => {
    expect(typeLabel("DECIMAL(18,3)")).toBe("DECIMAL(18,3)");
  });
});
