import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import DatasetTabs from "./DatasetTabs";
function Harness() {
  const [value, setValue] = useState("Data preview");
  return <DatasetTabs value={value} onChange={setValue} />;
}
it("provides two named views (Version history and Data quality moved out of the tabs) with roving keyboard selection, wraparound and Home/End", async () => {
  render(<Harness />);
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Preview", "Columns"]);
  expect(screen.queryByRole("tab", { name: "Data Quality" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Version History" })).not.toBeInTheDocument();
  const preview = screen.getByRole("tab", { name: "Preview" });
  preview.focus();
  expect(preview).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Columns" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  expect(preview).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Columns" })).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Home}");
  expect(preview).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Columns" })).toHaveFocus();
  expect(screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
});
