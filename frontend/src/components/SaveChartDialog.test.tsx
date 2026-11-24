import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import SaveChartDialog, { SAVE_SENTENCE } from "./SaveChartDialog";
import { phase4Api } from "../phase4api";
import { dashboardWorkspaceApi } from "../dashboardWorkspaceApi";

vi.mock("../phase4api", () => ({
  phase4Api: { dashboards: vi.fn(), saveChart: vi.fn(), dashboard: vi.fn(), createDashboard: vi.fn() },
}));
vi.mock("../dashboardWorkspaceApi", () => ({ dashboardWorkspaceApi: { attach: vi.fn() } }));

const run = { id: "run-1" } as never;
const spec = { kind: "bar", title: "Revenue by region", x: 0, y: 1 } as never;
const board = (id: string, title: string) => ({ id, title, description: "", revision: 1, filters: [], widgets: [], created_at: "2026-01-01", updated_at: "2026-01-01" });
const onClose = vi.fn(), onDone = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(phase4Api.saveChart).mockResolvedValue({ id: "chart-1" } as never);
  vi.mocked(dashboardWorkspaceApi.attach).mockResolvedValue({ duplicate: false, matches: [] } as never);
});
const open = (mode: "pin" | "library" = "pin") => render(<SaveChartDialog run={run} spec={spec} mode={mode} open onClose={onClose} onDone={onDone} />);

it("with no dashboard, offers to create one in the same dialog (no dead end) and pins to it", async () => {
  vi.mocked(phase4Api.dashboards).mockResolvedValue([]);
  vi.mocked(phase4Api.createDashboard).mockResolvedValue(board("dash-1", "Shop overview") as never);
  vi.mocked(phase4Api.dashboard).mockResolvedValue(board("dash-1", "Shop overview") as never);
  open();
  const select = screen.getByLabelText("Dashboard") as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe("__new__"));
  const name = screen.getByLabelText("New dashboard name");
  await userEvent.clear(name);
  await userEvent.type(name, "Shop overview");
  await userEvent.click(screen.getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(phase4Api.createDashboard).toHaveBeenCalledWith("Shop overview"));
  expect(phase4Api.saveChart).toHaveBeenCalledWith("run-1", "Revenue by region", spec, "snapshot", true);
  expect(dashboardWorkspaceApi.attach).toHaveBeenCalledWith("dash-1", "chart-1", 1);
  await waitFor(() => expect(onDone).toHaveBeenCalledWith("Pinned to your dashboard. New dashboard “Shop overview” created."));
});

it("shows the 1,000-row sentence next to the Pin button and saves nothing until Pin is clicked (D5)", async () => {
  vi.mocked(phase4Api.dashboards).mockResolvedValue([board("d-1", "Weekly")] as never);
  vi.mocked(phase4Api.dashboard).mockResolvedValue(board("d-1", "Weekly") as never);
  open();
  const sentence = await screen.findByText(SAVE_SENTENCE);
  expect(sentence).toHaveTextContent("saves up to 1,000 result rows in this project on this computer");
  const pin = screen.getByRole("button", { name: "Pin" });
  expect(sentence.parentElement).toBe(pin.parentElement); // same footer, visibly next to the button
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  // Opening, editing the title and choosing a dashboard never calls the API.
  await userEvent.type(screen.getByLabelText("Title"), " (copy)");
  await waitFor(() => expect((screen.getByLabelText("Dashboard") as HTMLSelectElement).value).toBe("d-1"));
  expect(phase4Api.saveChart).not.toHaveBeenCalled();
  expect(dashboardWorkspaceApi.attach).not.toHaveBeenCalled();
  // Cancel is not a save either.
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(phase4Api.saveChart).not.toHaveBeenCalled();
  // Only the explicit Pin click sends the confirmation flag (last argument).
  await userEvent.click(pin);
  await waitFor(() => expect(phase4Api.saveChart).toHaveBeenCalledTimes(1));
  expect(vi.mocked(phase4Api.saveChart).mock.calls[0][4]).toBe(true);
});

it("offers existing dashboards plus a way to create another, without a chart-library-only choice", async () => {
  vi.mocked(phase4Api.dashboards).mockResolvedValue([board("d-1", "Weekly")] as never);
  open();
  const select = screen.getByLabelText("Dashboard") as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe("d-1"));
  expect(Array.from(select.options).map(o => o.textContent)).toEqual(["Weekly", "New dashboard…"]);
});

it("never loses the answer: if the dashboard cannot be created the chart stays saved and the owner is told", async () => {
  vi.mocked(phase4Api.dashboards).mockResolvedValue([]);
  vi.mocked(phase4Api.createDashboard).mockRejectedValue(new Error("Maximum 50 dashboards."));
  open();
  await waitFor(() => expect((screen.getByLabelText("Dashboard") as HTMLSelectElement).value).toBe("__new__"));
  await userEvent.click(screen.getByRole("button", { name: "Pin" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The chart is saved in your library, but the new dashboard could not be created: Maximum 50 dashboards.");
  expect(phase4Api.saveChart).toHaveBeenCalledTimes(1);
  expect(dashboardWorkspaceApi.attach).not.toHaveBeenCalled();
});

it("keeps Pin disabled until a dashboard name is given", async () => {
  vi.mocked(phase4Api.dashboards).mockResolvedValue([]);
  open();
  await waitFor(() => expect((screen.getByLabelText("Dashboard") as HTMLSelectElement).value).toBe("__new__"));
  await userEvent.clear(screen.getByLabelText("New dashboard name"));
  expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
});

it("Save to library keeps the chart in the library only and still needs the explicit click", async () => {
  open("library");
  expect(screen.queryByLabelText("Dashboard")).not.toBeInTheDocument();
  expect(phase4Api.dashboards).not.toHaveBeenCalled();
  expect(phase4Api.saveChart).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(phase4Api.saveChart).toHaveBeenCalledWith("run-1", "Revenue by region", spec, "snapshot", true));
  expect(dashboardWorkspaceApi.attach).not.toHaveBeenCalled();
  await waitFor(() => expect(onDone).toHaveBeenCalledWith("Saved to your chart library."));
});
