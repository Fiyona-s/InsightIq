import { describe, expect, it } from "vitest";
import { plainUploadError } from "./uploadErrors";
import { sampleCsv } from "./sampleData";

describe("plain upload errors", () => {
  it.each([
    ["Select a .csv file.", /not a CSV/],
    ["Maximum upload size is 30 MB.", /too big \(the limit is 30 MB\)/],
    ["Maximum 500,000 rows per dataset.", /more than 500,000 rows/],
    ["Every row must have the same number of fields as the header.", /different number of columns/],
    ["Column names must be unique (case insensitive).", /same name/],
    ["Use 1–100 nonempty column names, each at most 128 characters.", /needs a name/],
    ["Upload a valid UTF-8 CSV with fields no longer than 65,536 characters.", /UTF-8/],
    ["Failed to fetch", /could not reach the app/],
  ])("%s", (message, expected) => {
    const text = plainUploadError(message);
    expect(text).toMatch(expected);
    expect(text).not.toMatch(/UTF-8 CSV with fields|nonempty|MiB|header\./);
  });
  it("keeps the original words for an unknown problem, inside a plain sentence", () => {
    expect(plainUploadError("Something odd")).toBe("We could not import that file (Something odd). Check that it opens as a table in a spreadsheet, then try again.");
  });
});
describe("sample data", () => {
  it("is a fixed fictional shop file: 60 rows, same every time", () => {
    const a = sampleCsv(), b = sampleCsv();
    expect(a).toBe(b);
    expect(a.trim().split("\n")).toHaveLength(61);
    expect(a.split("\n")[0]).toBe("order_id,order_date,product,region,quantity,unit_price,revenue");
  });
});
