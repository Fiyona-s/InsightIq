import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BackupInfoPage, ChangeHistoryPage, WhyNothingScored } from "./AdminExtras";
import { datasetProfileApi } from "../datasetProfileApi";
import { ADMIN_NOTICE } from "../lib/adminTools";
import RunTraceDetails from "./RunTraceDetails";
import type { AnalystRun, Dataset } from "../api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const banner = <p>{ADMIN_NOTICE}</p>;
const ds = (id: string, name: string) => ({ id, name, original_filename: name, display_name: name } as unknown as Dataset);

it("explains 0 of N and only opens Live mode: the live button calls the handler, nothing else", async () => {
  const onLive = vi.fn(); const onOffline = vi.fn();
  render(<WhyNothingScored total={45} onLive={onLive} onOffline={onOffline} />);
  expect(screen.getByRole("heading", { name: /0 of 45/ })).toBeVisible();
  expect(screen.getByText(/not a low accuracy/i)).toBeVisible();
  expect(screen.getByText(/spend limit/i)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Set up a live check" }));
  expect(onLive).toHaveBeenCalledTimes(1); expect(onOffline).not.toHaveBeenCalled();
});

it("Backup info shows locations, an external-copy recommendation, restore steps and the banner", () => {
  render(<BackupInfoPage banner={banner} />);
  expect(screen.getByRole("heading", { level: 1, name: "Backup info" })).toBeVisible();
  expect(screen.getByText(/not protected by a login/)).toBeVisible();
  expect(screen.getByText(/What this is for/)).toBeVisible();
  expect(screen.getByText(/not this computer/)).toBeVisible();
  expect(screen.getByText(/project_insightiq-data/, { selector: "code" })).toBeVisible();
  expect(screen.getAllByText(/compose.restore.yaml/, { selector: "code" }).length).toBeGreaterThan(0);
});

it("Change history merges existing entries, says what it does not cover, and never claims a complete trail", async () => {
  vi.spyOn(datasetProfileApi, "history").mockImplementation(async (id: string) => id === "b" ? Promise.reject(new Error("x")) : ({
    audit: [{ id: 1, action: "rename", timestamp: "2026-01-02T10:00:00Z", result: "ok", reason: "", actor: null }],
    revisions: [{ revision: 1, source: "upload", timestamp: "2026-01-01T10:00:00Z", sha256: "", size_bytes: 1, row_count: 5, status: "available", changed_cells: null, restored_from: null }],
    total: 1,
  }) as never);
  render(<ChangeHistoryPage datasets={[ds("a", "orders.csv"), ds("b", "costs.csv")]} banner={banner} />);
  expect(screen.getByRole("heading", { level: 1, name: "Dataset change history" })).toBeVisible();
  const table = await screen.findByRole("table");
  expect(within(table).getByText("rename")).toBeVisible();
  expect(within(table).getByText(/Version 1 \(upload\)/)).toBeVisible();
  expect(screen.getByText(/could not be loaded/)).toBeVisible();
  expect(screen.getByText(/not a complete audit trail/i)).toBeVisible();
  expect(screen.getByText(/because there is no login/i)).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText("Kind"), "Action");
  await waitFor(() => expect(within(table).queryByText(/Version 1/)).not.toBeInTheDocument());
});

it("trace labels read Started/Finished while every event stays listed", () => {
  const run = { id: "r", dataset_id: "d", dataset_name: "o.csv", question: "q", status: "completed", metrics: {}, events: [
    { id: 1, step: "validate", status: "started", attempt: 1, timestamp: "2026-01-01", summary: "a" },
    { id: 2, step: "execute", status: "completed", attempt: 1, timestamp: "2026-01-01", summary: "b" }] } as unknown as AnalystRun;
  render(<RunTraceDetails run={run} />);
  const items = within(screen.getByRole("list", { name: "Recorded steps" })).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[1]).toHaveTextContent("Finished");
});
