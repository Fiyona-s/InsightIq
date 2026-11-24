import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AnalystRun } from "../api";
import AskPanel from "./AskPanel";

const run = (id: string, question: string, created_at: string) => ({ id, question, created_at, dataset_id: "d1", status: "succeeded" }) as AnalystRun;
const base = { error: "", more: false, loadingMore: false, disabled: false, onNew: () => {}, onOpen: () => {}, onMore: () => {}, close: () => {} };

describe("AskPanel", () => {
  it("shows one line when there are no questions yet", () => {
    render(<AskPanel {...base} history={[]} />);
    expect(screen.getByText("Your questions will appear here.")).toBeVisible();
    expect(screen.getByRole("button", { name: "New question" })).toBeEnabled();
  });
  it("groups, counts repeats, highlights the current one and opens a saved question on click", async () => {
    const open = vi.fn(), add = vi.fn();
    const now = new Date().toISOString();
    render(<AskPanel {...base} onOpen={open} onNew={add} currentId="r1" history={[run("r1", "Revenue by region", now), run("r2", "Revenue by region", now), run("r3", "How many rows?", now)]} />);
    expect(screen.getByRole("region", { name: "Today" })).toBeVisible();
    expect(screen.getByText(/asked 2x/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Revenue by region/ })).toHaveAttribute("aria-current", "true");
    await userEvent.click(screen.getByRole("button", { name: /How many rows/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "r3" }));
    await userEvent.click(screen.getByRole("button", { name: "New question" }));
    expect(add).toHaveBeenCalled();
  });
  it("disables questions and New question while an answer is being produced", () => {
    render(<AskPanel {...base} disabled history={[run("r1", "Q", new Date().toISOString())]} />);
    expect(screen.getByRole("button", { name: "New question" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Q/ })).toBeDisabled();
  });
});
