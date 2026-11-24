import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Sidebar, { modules } from "./Sidebar";
import TopMenu from "./TopMenu";
import { AdminToolsProvider } from "../lib/adminTools";
import { bookmarkedPage, pageLabel, pageRoutes } from "../lib/navigation";
import { setupSteps } from "./SetupGuide";
import SetupGuide from "./SetupGuide";
import { ACTIVE_KEY, ActiveDatasetProvider } from "../lib/activeDataset";
import { api, type Dataset } from "../api";
import { phase4Api, type Benchmark, type Analytics } from "../phase4api";
import EvaluationPage from "./EvaluationPage";
// Start-up work is deferred in the app (lib/defer.ts); these tests check what it loads, not when, so run it at once.
vi.mock("../lib/defer", () => ({ whenIdle: (task: () => void) => { task(); return () => undefined; } }));
const dataset: Dataset = {
  id: "real",
  name: "orders.csv",
  rows: 2,
  bytes: 20,
  columns: [],
  created_at: "2026-01-01",
};
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => [],
  } as Response);
});
const sidebar = (module = "Overview") => (
  <Sidebar
    module={module}
    menu={false}
    collapsed={false}
    setCollapsed={vi.fn()}
    setModule={vi.fn()}
    setMenu={vi.fn()}
  />
);
it("the rail shows only the six owner pages, with no group label, and never the Admin pages (they live under Menu)", () => {
  const r = render(sidebar());
  expect(screen.queryByText("Your business")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Predictions" })).toBeVisible();
  expect(screen.queryByText("Admin tools")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Accuracy check" })).not.toBeInTheDocument();
  r.unmount();
  localStorage.setItem("insightiq-admin-tools-v1", "true");
  render(<AdminToolsProvider>{sidebar()}</AdminToolsProvider>);
  expect(screen.queryByText("Admin tools")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Accuracy check" })).not.toBeInTheDocument();      // even when switched on: Menu only
});
it("the Menu lists the Admin pages only when switched on, and marks the active one", async () => {
  const user = userEvent.setup();
  const r = render(<AdminToolsProvider><TopMenu onNavigate={vi.fn()} current="Run analytics" /></AdminToolsProvider>);
  await user.click(screen.getByRole("button", { name: "Menu" }));
  expect(screen.queryByRole("menuitem", { name: "Performance & errors" })).not.toBeInTheDocument();
  r.unmount();
  localStorage.setItem("insightiq-admin-tools-v1", "true");
  render(<AdminToolsProvider><TopMenu onNavigate={vi.fn()} current="Run analytics" /></AdminToolsProvider>);
  await user.click(screen.getByRole("button", { name: "Menu" }));
  expect(document.getElementById("menu-admin-heading")).toHaveTextContent("Admin tools");
  expect(screen.getByRole("menuitem", { name: "Performance & errors" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("menuitem", { name: "Accuracy check" })).toBeVisible();
});
it("supports old bookmark names and canonical route aliases for every page", () => {
  for (const m of modules) {
    window.history.replaceState(
      null,
      "",
      `#${m.name.toLowerCase().replace(/ /g, "-")}`,
    );
    expect(bookmarkedPage()).toBe(m.name);
    window.history.replaceState(null, "", `#${pageRoutes[m.name]}`);
    expect(bookmarkedPage()).toBe(m.name);
    expect(pageLabel(m.name)).toBeTruthy();
  }
});
it("derives setup steps from non-sample active datasets, viewed profiles, completed runs and saved charts", () => {
  expect(setupSteps([], [], new Set(), [])).toEqual([
    false,
    false,
    false,
    false,
  ]);
  expect(
    setupSteps([{ ...dataset, is_sample: true }], ["real"], new Set(["real"]), [
      { dataset_id: "real" },
    ]),
  ).toEqual([false, false, false, false]);
  expect(setupSteps([dataset], ["real"], new Set(), [])).toEqual([
    true,
    true,
    false,
    false,
  ]);
  expect(
    setupSteps([dataset], [], new Set(["real"]), [{ dataset_id: "real" }]),
  ).toEqual([true, true, true, true]);
  expect(
    setupSteps([{ ...dataset, archived_at: "date" }], [], new Set(["real"]), [
      { dataset_id: "real" },
    ]),
  ).toEqual([false, false, false, false]);
});
function mockGuide(completed = false, chart = false) {
  vi.spyOn(phase4Api, "dashboards").mockResolvedValue(
    chart ? [{ id: "dashboard", widget_count: 1 } as never] : [],
  );
  vi.spyOn(phase4Api, "dashboard").mockResolvedValue({
    widgets: [{ kind: "chart", chart_id: "chart" }],
  } as never);
  vi.spyOn(api, "list").mockResolvedValue([dataset]);
  vi.spyOn(phase4Api, "analytics").mockResolvedValue({
    succeeded: completed ? 1 : 0,
  } as Analytics);
  vi.spyOn(phase4Api, "charts").mockResolvedValue(
    chart ? [{ id: "chart", dataset_id: "real" } as never] : [],
  );
}
it("shows real progress, persists dismissal and allows showing the guide again", async () => {
  mockGuide();
  const nav = vi.fn();
  render(
    <ActiveDatasetProvider>
      <SetupGuide onNavigate={nav} />
    </ActiveDatasetProvider>,
  );
  expect(await screen.findByText("1 of 4 done")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Dismiss setup guide" }),
  );
  expect(
    screen.queryByRole("region", { name: "Setup guide" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Show setup guide" }),
  );
  expect(screen.getByRole("region", { name: "Setup guide" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Ask a question" }));
  expect(nav).toHaveBeenCalledWith("AI Analyst");
});
it("hides the guide automatically when all real steps are complete", async () => {
  mockGuide(true, true);
  render(
    <ActiveDatasetProvider>
      <SetupGuide onNavigate={vi.fn()} />
    </ActiveDatasetProvider>,
  );
  await waitFor(() => expect(phase4Api.charts).toHaveBeenCalled());
  expect(
    screen.queryByRole("region", { name: "Setup guide" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Show setup guide" }),
  ).not.toBeInTheDocument();
});
it("does not nag an existing workspace with non-sample activity", async () => {
  mockGuide(true, false);
  render(
    <ActiveDatasetProvider>
      <SetupGuide onNavigate={vi.fn()} />
    </ActiveDatasetProvider>,
  );
  expect(
    await screen.findByRole("button", { name: "Show setup guide" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Setup guide" }),
  ).not.toBeInTheDocument();
});
it("requires an explicit page-only benchmark choice and leaves global selection unchanged", async () => {
  vi.spyOn(api, "list").mockResolvedValue([dataset]);
  vi.spyOn(phase4Api, "benchmark").mockResolvedValue({
    dataset_id: "benchmark",
    version: "retail-v1",
    cases: [],
    limits: {},
    title: "Retail",
    pending_count: 0,
    verified_count: 0,
    case_count: 0,
  } as unknown as Benchmark);
  vi.spyOn(phase4Api, "evaluations").mockResolvedValue([]);
  render(
    <ActiveDatasetProvider>
      <EvaluationPage onDatasetChange={vi.fn()} />
    </ActiveDatasetProvider>,
  );
  expect(
    await screen.findByRole("heading", {
      name: "Evaluation uses the controlled retail benchmark dataset",
    }),
  ).toBeVisible();
  await userEvent.click(screen.getByText("Setup and verification",{exact:true}));
  expect(
    screen.getByRole("button", { name: "Verify benchmark references" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Use benchmark for this page only" }),
  );
  expect(screen.getByText(/Global selection is unchanged/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Verify benchmark references" }),
  ).toBeEnabled();
  expect(JSON.parse(localStorage.getItem(ACTIVE_KEY)!).id).toBe("real");
});

it("suppresses automatic onboarding for deliberate saved answers and pinned dashboards even when the source filename is a demo", async () => {
  mockGuide(true, true);
  vi.mocked(api.list).mockResolvedValue([{ ...dataset, is_sample: true }]);
  render(
    <ActiveDatasetProvider>
      <SetupGuide onNavigate={vi.fn()} />
    </ActiveDatasetProvider>,
  );
  await screen.findByRole("button", { name: "Show setup guide" });
  expect(
    screen.queryByRole("region", { name: "Setup guide" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Show setup guide" }),
  );
  expect(screen.getByText("0 of 4 done")).toBeVisible();
});
it("does not count a saved library chart as pinned until it belongs to a dashboard", async () => {
  mockGuide(true, true);
  vi.mocked(phase4Api.dashboards).mockResolvedValue([]);
  render(
    <ActiveDatasetProvider>
      <SetupGuide onNavigate={vi.fn()} />
    </ActiveDatasetProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Show setup guide" }),
  );
  expect(screen.getByText("3 of 4 done")).toBeVisible();
});
it("still shows setup for sample datasets without completed questions and pinned charts", async () => {
  mockGuide(false, false);
  vi.mocked(api.list).mockResolvedValue([{ ...dataset, is_sample: true }]);
  render(
    <ActiveDatasetProvider>
      <SetupGuide onNavigate={vi.fn()} />
    </ActiveDatasetProvider>,
  );
  expect(await screen.findByText("0 of 4 done")).toBeVisible();
});
