import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import ResultDataTable from "./ResultDataTable";
import type { AnalystResults } from "../api";

/** PRODUCT-POLISH P2: long tables show the top 10 first, with plain column types and a "Show all" button. */
const many = (n: number): AnalystResults => ({ columns: [{ name: "region", type: "VARCHAR" }, { name: "units", type: "BIGINT" }], rows: Array.from({ length: n }, (_, i) => [`Region ${i + 1}`, i + 1]), row_count: n, offset: 0, expires_in_seconds: 60 }) as AnalystResults;
it("shows the top 10 of a longer table, then every row after Show all", async () => {
  render(<ResultDataTable result={many(14)} runId="r1" offset={0} onOffset={() => {}} />);
  expect(screen.getAllByRole("row")).toHaveLength(11);                       // header + 10
  expect(screen.getByText("Top 10 of 14 rows")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Show all 14 rows" }));
  expect(screen.getAllByRole("row")).toHaveLength(15);
  expect(screen.queryByText(/Top 10 of/)).not.toBeInTheDocument();
});
it("a short table has no Show all, and column types are plain words", () => {
  render(<ResultDataTable result={many(4)} runId="r1" offset={0} onOffset={() => {}} />);
  expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  expect(screen.getByText("Whole number")).toBeVisible();
  expect(screen.queryByText("BIGINT")).not.toBeInTheDocument();
});
