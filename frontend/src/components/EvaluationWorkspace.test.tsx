import {
  render,
  screen,
  within,
  waitFor,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import EvaluationWorkspaceResults from "./EvaluationWorkspaceResults";
import EvaluationRunComparison from "./EvaluationRunComparison";
import {
  tally,
  reasons,
  compareRuns,
  scopeLabel,
  type EvaluationPresentation,
} from "../lib/evaluationPresentation";
import { request } from "../api";
import { phase4Api, type Evaluation, type Benchmark } from "../phase4api";
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  request: vi.fn(),
}));
vi.mock("../phase4api", () => ({ phase4Api: { evaluation: vi.fn() } }));
const result = {
  columns: [{ name: "amount", type: "DOUBLE" }],
  rows: Array.from({ length: 40 }, (_, i) => [i]),
};
const benchmark = {
  version: "retail-v1",
  title: "Authored fictional retail",
  case_count: 45,
} as Benchmark;
function job(id = "a"): Evaluation {
  return {
    id,
    version: "retail-v1",
    mode: "offline",
    status: "completed",
    dataset_fingerprint: "same",
    created_at: "2026-01-01",
    completed_at: "2026-01-01",
    updated_at: "2026-01-01",
    case_ids: ["q1", "q2", "q3", "q4", "q5"],
    results: [true, false, false, null, null].map((correct, i) => ({
      case_id: "q" + (i + 1),
      question: "Question " + (i + 1),
      category: i % 2 ? "aggregate" : "filter",
      difficulty: "easy",
      correct,
      failure_labels: i === 1 ? ["stored_execution_failure"] : [],
      comparison: i === 2 ? "Stored alias mismatch" : "",
      expected: result,
      actual: result,
      run: null,
      reference_sql: "SELECT 1",
    })),
  } as Evaluation;
}
const meta: EvaluationPresentation = {
  id: "a",
  scoring_version: "metrics-v2",
  comparison_policy: "typed-v1",
  results: [
    {
      case_id: "q2",
      diff: {
        available: true,
        notice: "Display only; stored verdict unchanged.",
        shown_rows: 20,
        total_rows: 80,
        rows: [{ side: "actual", row: 1, value: [0], match: "Unmatched" }],
      },
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(request).mockResolvedValue(meta);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("never counts unscored questions as correct or incorrect and shows exact denominators and small groups", async () => {
  const run = job();
  expect(tally(run)).toEqual({
    correct: 1,
    incorrect: 2,
    scored: 3,
    unscored: 2,
    selected: 5,
  });
  render(<EvaluationWorkspaceResults job={run} benchmark={benchmark} />);
  expect(screen.getByText("33.3% · 1 correct / 3 scored")).toBeInTheDocument();
  expect(screen.getByText(/2 incorrect · 2 unscored/)).toBeInTheDocument();
  expect(
    screen.getAllByText(/fewer than 5 scored questions/).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByText("Partial run: 5 of 45 questions"),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /overall accuracy/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Offline replay · 0 new LLM calls/),
  ).toBeInTheDocument();
});
it("failure tags come only from stored scorer reasons with the No reason recorded fallback", () => {
  const rows = job().results!;
  expect(reasons(rows[1])).toEqual(["stored_execution_failure"]);
  expect(reasons(rows[2])).toEqual(["Stored alias mismatch"]);
  expect(reasons(rows[3])).toEqual(["No reason recorded"]);
  render(<EvaluationWorkspaceResults job={job()} benchmark={benchmark} />);
  expect(
    screen.getByRole("table", { name: "Evaluation questions" }),
  ).toHaveTextContent("stored_execution_failure");
  expect(screen.queryByText("wrong_join")).not.toBeInTheDocument();
});
it("filters outcome difficulty type reason and text while keeping stored metrics unchanged", async () => {
  const original = job(),
    raw = JSON.stringify(original);
  render(<EvaluationWorkspaceResults job={original} benchmark={benchmark} />);
  await userEvent.selectOptions(
    screen.getByLabelText("Filter outcome"),
    "Unscored",
  );
  expect(screen.getByRole("status")).toHaveTextContent("2 of 5");
  await userEvent.type(screen.getByLabelText("Search questions"), "q4");
  expect(screen.getByRole("status")).toHaveTextContent("1 of 5");
  expect(JSON.stringify(original)).toBe(raw);
});
it("drawer shows stored outputs SQL diff truncation and technical disclosure; traps focus Escape returns focus", async () => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  render(<EvaluationWorkspaceResults job={job()} benchmark={benchmark} />);
  const opener = screen.getByRole("button", { name: "Inspect q2" });
  await userEvent.click(opener);
  const drawer = screen.getByRole("dialog");
  expect(
    within(drawer).getByRole("heading", { name: "Expected result" }),
  ).toBeInTheDocument();
  expect(
    within(drawer).getByRole("heading", { name: "Actual result" }),
  ).toBeInTheDocument();
  expect(
    within(drawer).getAllByText("Showing first 20 of 40 stored rows."),
  ).toHaveLength(2);
  await waitFor(() =>
    expect(drawer).toHaveTextContent(
      "Showing first 20 of 80 combined output rows",
    ),
  );
  expect(drawer).toHaveTextContent("Unmatched");
  const close = within(drawer).getByRole("button", { name: "Close details" }),
    technical = within(drawer).getByText("Technical details");
  expect(close).toHaveFocus();
  await userEvent.tab({ shift: true });
  expect(technical).toHaveFocus();
  await userEvent.tab();
  expect(close).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
it("compares only matching versions sets and scoring; overlap is explicit with fixed regressed unchanged and unscored categories", () => {
  const a = job(),
    b = job("b");
  b.results![0].correct = false;
  b.results![1].correct = true;
  const compared = compareRuns(a, b, meta, meta);
  expect(compared.reason).toBeNull();
  expect(compared.changes.map((c) => c.change)).toEqual([
    "Regressed",
    "Fixed",
    "Unchanged",
    "Unscored in one or both runs",
    "Unscored in one or both runs",
  ]);
  b.case_ids = ["q1", "q2"];
  expect(compareRuns(a, b, meta, meta).reason).toContain(
    "Question sets differ",
  );
  expect(compareRuns(a, b, meta, meta, true).scope).toContain(
    "Overlapping questions only: 2",
  );
  expect(
    compareRuns(a, b, meta, { ...meta, scoring_version: "different" }, true)
      .reason,
  ).toBe("Scoring versions differ.");
  expect(compareRuns(a, b, null, meta, true).reason).toContain("unavailable");
});
it("refuses non-comparable runs with a visible reason and no deltas or trend chart", async () => {
  const a = job(),
    b = { ...job("b"), version: "retail-v2" };
  vi.mocked(phase4Api.evaluation).mockImplementation(async (id) =>
    id === "a" ? a : b,
  );
  render(<EvaluationRunComparison history={[a, b]} />);
  await userEvent.selectOptions(screen.getByLabelText("Earlier run"), "a");
  await userEvent.selectOptions(screen.getByLabelText("Later run"), "b");
  expect(
    await screen.findByText("Not comparable: Benchmark versions differ."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("table", { name: "Per-question changes" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
it("partial scopes never claim benchmark overall accuracy", () => {
  expect(scopeLabel(job())).toBe("Partial run: 5 of 45 questions");
  expect(
    scopeLabel({
      ...job(),
      case_ids: Array.from({ length: 45 }, (_, i) => String(i)),
    }),
  ).toBe("Full selected question set");
});
it("keeps recorded execution error text collapsed under Technical details", async () => {
  const run = job();
  run.results![1].status = "execution_failed";
  run.results![1].comparison = "Recorded worker timeout text";
  render(<EvaluationWorkspaceResults job={run} benchmark={benchmark} />);
  await userEvent.click(screen.getByRole("button", { name: "Inspect q2" }));
  const dialog = screen.getByRole("dialog"),
    error = within(dialog).getByText("Recorded worker timeout text", {
      exact: true,
    });
  expect(error).not.toBeVisible();
  await userEvent.click(within(dialog).getByText("Technical details"));
  expect(error).toBeVisible();
});
