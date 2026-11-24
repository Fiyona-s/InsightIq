import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import HomePage from "./HomePage";
import { phase4Api, type Analytics, type DashboardSummary } from "../phase4api";
import type { Dataset, AnalystRun } from "../api";
import type { useActiveDataset } from "../lib/activeDataset";
import { analystUXApi } from "../analystUXApi";
const state = vi.hoisted(() => ({
  context: null as ReturnType<typeof useActiveDataset>,
}));
vi.mock("../lib/activeDataset", () => ({
  useActiveDataset: () => state.context,
  selectorDatasets: (datasets: unknown[]) => datasets,
}));
vi.mock("./SetupGuide", () => ({ default: () => null }));
vi.mock("../analystUXApi", () => ({ analystUXApi: { suggestions: vi.fn() } }));
const active: Dataset = {
  id: "one",
  name: "orders.csv",
  rows: 2430,
  columns: [{ name: "amount", type: "VARCHAR", null_count: 0 }],
  bytes: 20,
  created_at: "2026-01-01",
};
const run = (status: string, id = status) =>
  ({
    id,
    status,
    dataset_id: "one",
    dataset_name: "orders.csv",
    question: "Question " + id,
    created_at: "2026-01-01T00:00:00Z",
    activity_kind: "analyst",
  }) as AnalystRun;
const board = {
  id: "board-two",
  title: "Revenue review",
  widget_count: 3,
  updated_at: "2026-01-02",
  created_at: "2026-01-01",
} as DashboardSummary;
beforeEach(() => {
  vi.restoreAllMocks();
  state.context = {
    active,
    loading: false,
    select: vi.fn().mockResolvedValue(true),
  } as unknown as NonNullable<ReturnType<typeof useActiveDataset>>;
  vi.spyOn(phase4Api, "analytics").mockResolvedValue({
    total_questions: 9,
    recent: [
      run("succeeded"),
      run("failed"),
      run("clarification"),
      { ...run("succeeded", "benchmark"), activity_kind: "evaluation" },
    ],
  } as Analytics);
  vi.spyOn(phase4Api, "dashboards").mockResolvedValue([board]);
  vi.mocked(analystUXApi.suggestions).mockResolvedValue([
    { question: "How many records are in this dataset?", kind: "count", columns: [] },
  ] as never);
});
it("leads with a question box, then real dashboards and completed questions, never summed unrelated records", async () => {
  render(
    <HomePage
      datasets={[active, { ...active, id: "two", rows: 999999 }]}
      onNavigate={vi.fn()}
    />,
  );
  expect(screen.getByRole("heading", { name: "What do you want to know?" })).toBeVisible();
  expect(screen.getByLabelText("Your question")).toHaveAttribute("placeholder", "Ask a question about orders.csv");
  expect(document.body).not.toHaveTextContent("1,002,429");
  expect(screen.queryByRole("region", { name: "Active dataset summary" })).not.toBeInTheDocument();
  await screen.findByText("Revenue review");
  expect(screen.getByText(/^Updated /)).toBeVisible();
  expect(screen.getByText("Question succeeded")).toBeVisible();
  expect(screen.queryByText("Question failed")).not.toBeInTheDocument();
  expect(screen.queryByText("Question benchmark")).not.toBeInTheDocument();
  expect(screen.queryByText("Execution success")).not.toBeInTheDocument();
  // Failed / clarification outcomes now live in Ask > Recent questions, not on Home.
  expect(screen.queryByLabelText("Show all", { exact: true })).not.toBeInTheDocument();
});
it("typing a question opens Ask with that text and does not run anything; a suggestion only fills the box", async () => {
  const onAsk = vi.fn(), navigate = vi.fn();
  render(<HomePage datasets={[active]} onNavigate={navigate} onAsk={onAsk} />);
  const box = screen.getByLabelText("Your question");
  expect(screen.getByRole("button", { name: "Ask now" })).toBeDisabled();
  await userEvent.click(await screen.findByRole("button", { name: "How many records are in this dataset?" }));
  expect(box).toHaveValue("How many records are in this dataset?");
  expect(onAsk).not.toHaveBeenCalled();
  await userEvent.clear(box);
  await userEvent.type(box, "Which region sells most?");
  await userEvent.click(screen.getByRole("button", { name: "Ask now" }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(onAsk).toHaveBeenCalledWith("Which region sells most?");
});
it("opens the chosen saved dashboard and question through explicit callbacks, without running a query", async () => {
  const navigate = vi.fn(),
    open = vi.fn().mockResolvedValue(undefined),
    dashboard = vi.fn();
  render(
    <HomePage
      datasets={[active]}
      onNavigate={navigate}
      onOpenRun={open}
      onOpenDashboard={dashboard}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Open dashboard Revenue review",
    }),
  );
  expect(dashboard).toHaveBeenCalledWith("board-two");
  await userEvent.click(
    screen.getByRole("button", { name: /Question succeeded/ }),
  );
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ id: "succeeded" }),
  );
  expect(navigate).not.toHaveBeenCalled();
});
it("shows three-step upload welcome without inventing demo availability", async () => {
  state.context = { ...state.context!, active: null };
  render(<HomePage datasets={[]} onNavigate={vi.fn()} />);
  expect(screen.getByRole("region", { name: "Welcome" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Add your data to get started" })).toBeVisible();
  expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Use sample data" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText("Loading dashboards…")).not.toBeInTheDocument(),
  );
});
it("retains unavailable-source history without offering a new query against it", async () => {
  render(<HomePage datasets={[]} onNavigate={vi.fn()} />);
  await screen.findByText("Question succeeded");
  expect(
    screen.getByText("Source unavailable · history retained"),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Question succeeded/ }),
  ).not.toBeInTheDocument();
});
it("keeps successful dashboard reads and offers retry when activity is unavailable", async () => {
  vi.mocked(phase4Api.analytics).mockRejectedValueOnce(
    Error("Controlled temporary failure"),
  );
  render(<HomePage datasets={[active]} onNavigate={vi.fn()} />);
  await screen.findByText("Some workspace information could not load.");
  expect(screen.getByText("Revenue review")).toBeVisible();
  expect(screen.getByText("Recent questions are unavailable.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Question succeeded");
});
it('uses an existing demo only after explicit selection and never imports one', async () => {
  const select = vi.fn().mockResolvedValue(true), navigate = vi.fn();
  state.context = { ...state.context!, active: null, select };
  render(<HomePage datasets={[{ ...active, is_sample: true, name: 'retail-demo.csv' }]} onNavigate={navigate} />);
  expect(select).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Use sample data' }));
  expect(select).toHaveBeenCalledWith('one');
  expect(navigate).toHaveBeenCalledWith('AI Analyst');         // first run: straight on to the first question
});
it("shows identical questions once as 'asked 2x', opens the newest run, and keeps at most 3 suggestions", async () => {
  const open = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(phase4Api, "analytics").mockResolvedValue({
    total_questions: 3,
    recent: [
      { ...run("succeeded", "older"), question: "Total revenue?", created_at: "2026-01-01T00:00:00Z" },
      { ...run("succeeded", "newer"), question: "  total   revenue? ", created_at: "2026-01-03T00:00:00Z" },
      { ...run("succeeded", "other"), question: "Orders by region", created_at: "2026-01-02T00:00:00Z" },
    ],
  } as Analytics);
  vi.mocked(analystUXApi.suggestions).mockResolvedValue(
    ["a", "b", "c", "d", "e"].map((q) => ({ question: "Suggested " + q, kind: "count", columns: [] })) as never,
  );
  render(<HomePage datasets={[active]} onNavigate={vi.fn()} onOpenRun={open} />);
  const rows = await screen.findAllByRole("button", { name: /Total revenue|Orders by region/i });
  expect(rows).toHaveLength(2);                                                    // grouped, not three rows
  expect(rows[0].closest("li")).toHaveTextContent("asked 2x");
  expect(rows[1].closest("li")).not.toHaveTextContent("asked");
  await userEvent.click(rows[0]);                                                  // the whole row opens it, no separate button
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "newer" }));
  const chips = await screen.findAllByRole("button", { name: /^Suggested / });
  expect(chips).toHaveLength(3);
});

it("the dataset picker sits inside the question box on Home (it is no longer in the top bar)", async () => {
  state.context = { ...state.context!, datasets: [active], activeId: active.id, hideSamples: false } as unknown as NonNullable<ReturnType<typeof useActiveDataset>>;
  render(<HomePage datasets={[active]} onNavigate={vi.fn()} />);
  const form = screen.getByLabelText("Your question").closest("form")!;
  expect(form.querySelector(".global-dataset-selector .dataset-trigger")).not.toBeNull();
  expect(form).toHaveTextContent("orders.csv");
});

it("an empty workspace has one clear path: upload, or a sample that is only added when pressed; no checklist", async () => {
  const upload = vi.fn(), sample = vi.fn();
  state.context = { ...state.context!, active: null };
  render(<HomePage datasets={[]} onNavigate={vi.fn()} onUpload={upload} onSample={sample} />);
  expect(sample).not.toHaveBeenCalled();                                          // nothing is added by looking at Home
  expect(screen.getByText(/Sample data, not your business/)).toBeVisible();
  expect(screen.queryByText(/Show setup guide|Get started/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try sample data" }));
  expect(sample).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Upload a dataset" }));
  expect(upload).toHaveBeenCalledTimes(1);
});
