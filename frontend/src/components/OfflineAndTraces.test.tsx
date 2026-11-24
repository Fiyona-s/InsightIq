import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import EvaluationPage from "./EvaluationPage";
import ExecutionTracesPage from "./ExecutionTracesPage";
import { phase4Api, type Benchmark, type Evaluation } from "../phase4api";
import { request, analystApi, type AnalystRun } from "../api";
import { numericAxis } from "../lib/chartAxis";
vi.mock("../phase4api", () => ({
  phase4Api: {
    benchmark: vi.fn(),
    evaluations: vi.fn(),
    evaluation: vi.fn(),
    evaluate: vi.fn(),
    evaluateOffline: vi.fn(),
    installBenchmark: vi.fn(),
    verifyBenchmark: vi.fn(),
    cancelEvaluation: vi.fn(),
  },
}));
vi.mock("../api", () => ({
  request:vi.fn().mockResolvedValue({scoring_version:null,comparison_policy:null,results:[]}),
  analystApi: { history: vi.fn(), run: vi.fn(), ask: vi.fn() },
}));
const benchmark: Benchmark = {
  version: "retail-v1",
  fingerprint: "fingerprint-1",
  dataset_id: "dataset-1",
  title: "Controlled benchmark",
  case_count: 45,
  verified_count: 45,
  pending_count: 0,
  cases: [
    {
      id: "q06",
      question: "What is total revenue?",
      category: "aggregation",
      difficulty: "easy",
      expectation: "sql",
      reference_sql: "SELECT SUM(revenue) AS total_revenue FROM data",
      expected: {
        columns: [{ name: "total_revenue", type: "DOUBLE" }],
        rows: [[1000]],
        row_count: 1,
      },
      ordered: false,
      verification: "verified",
    },
  ],
  scope: "Only registered dataset",
  comparison_policy: "Typed comparison, no lost NULLs/duplicates.",
  pricing: null,
  limits: {
    max_cases: 10,
    max_provider_calls: 30,
    output_tokens_per_call: 1600,
    max_seconds: 600,
    cost_policy: "Paid only",
  },
};
const run: AnalystRun = {
  id: "run-1",
  dataset_id: "dataset-1",
  dataset_name: "controlled.csv",
  question: "What is total revenue?",
  status: "succeeded",
  created_at: "2026-01-01",
  completed_at: "2026-01-01",
  sql: "SELECT SUM(revenue) AS total_revenue FROM data",
  executed_sql: "SELECT SUM(revenue) AS total_revenue FROM data",
  answer: "total_revenue: 1000",
  clarification: null,
  explanation: "Sum revenue",
  error: null,
  error_code: null,
  type_mapping: { revenue: "DOUBLE" },
  conversions: [],
  metrics: { total_latency_ms: 100, total_tokens: 25 },
  result_metadata: {
    columns: [{ name: "total_revenue", type: "DOUBLE" }],
    row_count: 1,
  },
  results_available: false,
  attempts: 1,
  current_step: "finish",
  events: [
    {
      id: 1,
      step: "validate",
      status: "passed",
      timestamp: "2026-01-01",
      attempt: 1,
      summary: "Read-only query validated.",
    },
  ],
};
const missing: Evaluation = {
  id: "offline-1",
  dataset_id: "dataset-1",
  dataset_fingerprint: "fingerprint-1",
  version: "retail-v1",
  mode: "offline",
  pipeline: "offline",
  model: "Saved predictions only",
  status: "completed",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  completed_at: "2026-01-01",
  active_run_id: null,
  case_ids: ["q06"],
  provider_calls: 0,
  reserved_tokens: 0,
  reserved_cost_usd: 0,
  max_total_tokens: 0,
  max_spend_usd: 0,
  error: null,
  pricing: { input: "0", output: "0", source: "No new calls" },
  metrics: {
    completed_cases: 1,
    evaluated_count: 0,
    correct_count: 0,
    incorrect_count: 0,
    missing_predictions: 1,
    execution_failures: 0,
    reference_failures: 0,
    accuracy: null,
    valid_sql_rate: null,
    execution_success_rate: null,
    result_accuracy: null,
    average_attempts: 0,
    repair_success_rate: null,
    p50_latency_ms: null,
    p95_latency_ms: null,
    total_tokens: 0,
    estimated_cost_usd: 0,
    categories: {},
    diagnostic_counts: {},
    diagnostic_note: "Zero new model calls.",
  },
  results: [
    {
      case_id: "q06",
      category: "aggregation",
      difficulty: "easy",
      question: run.question,
      reference_sql: run.sql,
      expected: benchmark.cases[0].expected,
      actual: null,
      correct: null,
      comparison: "Not evaluated — no saved prediction",
      run: null,
      failure_labels: [],
      status: "missing_prediction",
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(request).mockResolvedValue({scoring_version:null,comparison_policy:null,results:[]});
  vi.mocked(phase4Api.benchmark).mockResolvedValue(benchmark);
  vi.mocked(phase4Api.evaluations).mockResolvedValue([]);
  vi.mocked(phase4Api.evaluateOffline).mockResolvedValue(missing);
  vi.mocked(analystApi.history).mockResolvedValue([run]);
});
it("defaults to zero-cost offline mode without prices or a paid authorization checkbox", async () => {
  render(<EvaluationPage onDatasetChange={vi.fn()} />);
  expect(await screen.findByLabelText("Evaluation mode")).toHaveValue(
    "offline",
  );
  expect(
    screen.getByText("0 new LLM calls", { exact: true }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText(/I authorize paid/)).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Maximum spend (USD)"),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Start offline replay" }),
  );
  await waitFor(() =>
    expect(phase4Api.evaluateOffline).toHaveBeenCalledWith({
      dataset_id: "dataset-1",
      version: "retail-v1",
      case_ids: ["q06"],
      source_evaluation_id: null,
    }),
  );
  expect(phase4Api.evaluate).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByText("Detailed diagnostics and exports",{exact:true}));
  const result = await screen.findByRole("region", {
    name: "Offline evaluation results",
  });
  expect(
    within(result).getAllByText("Not evaluated — no saved prediction").length,
  ).toBeGreaterThan(0);
  expect(
    within(result).getByText("Accuracy over evaluated predictions")
      .parentElement,
  ).toHaveTextContent("Not evaluated");
  expect(within(result).queryByText("100.0%")).not.toBeInTheDocument();
  expect(
    within(result).getByRole("columnheader", { name: "Expected output" }),
  ).toBeInTheDocument();
  expect(
    within(result).getByRole("columnheader", { name: "Actual output" }),
  ).toBeInTheDocument();
});
it("keeps paid generation separate and gated after selecting paid mode", async () => {
  render(<EvaluationPage onDatasetChange={vi.fn()} />);
  await userEvent.selectOptions(
    await screen.findByLabelText("Evaluation mode"),
    "paid",
  );
  expect(screen.getByLabelText(/I authorize paid provider/)).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Run evaluation" })).toBeDisabled();
  expect(screen.getByText(/Pricing unknown/)).toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByLabelText("Evaluation mode"),
    "offline",
  );
  expect(screen.queryByLabelText(/I authorize paid/)).not.toBeInTheDocument();
  expect(phase4Api.evaluate).not.toHaveBeenCalled();
});
it("shows actual saved-replay outputs and their source independently of reference verification", async () => {
  vi.mocked(phase4Api.evaluateOffline).mockResolvedValue({
    ...missing,
    metrics: {
      ...missing.metrics!,
      evaluated_count: 1,
      correct_count: 0,
      incorrect_count: 1,
      missing_predictions: 0,
      accuracy: 0,
    },
    results: [
      {
        ...missing.results![0],
        run,
        correct: false,
        status: "incorrect",
        actual: {
          columns: [{ name: "total_revenue", type: "DOUBLE" }],
          rows: [[1001]],
          row_count: 1,
        },
        comparison: "Typed result values differ.",
        source_evaluation_id: "source-1",
        source_run_id: run.id,
        source_model: "historical-model",
        source_pipeline: "agentic",
        replayed_sql: run.sql,
      },
    ],
  });
  render(<EvaluationPage onDatasetChange={vi.fn()} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Start offline replay" }),
  );
  const results = await screen.findByRole("region", {
    name: "Offline evaluation results",
  });
  expect(within(results).getByText("0.0%")).toBeInTheDocument();
  expect(
    within(results).getByText(/Typed result values differ/),
  ).toBeInTheDocument();
  expect(
    within(results).getAllByText(/historical-model/).length,
  ).toBeGreaterThan(0);
  expect(within(results).getByText(/1001/)).toBeInTheDocument();
  expect(within(results).queryByText("100.0%")).not.toBeInTheDocument();
});
it("renders history and trace diagnostics without mounting an Analyst question composer", async () => {
  render(<ExecutionTracesPage datasets={[]} />);
  expect(
    screen.getByRole("heading", { name: /Execution traces/ }),
  ).toBeInTheDocument();
  await userEvent.click(
    await screen.findByRole("button", { name: /What is total revenue/ }),
  );
  expect(analystApi.history).toHaveBeenCalledWith(undefined);
  expect(
    screen.getByRole("region", { name: "Run trace details" }),
  ).toHaveTextContent("Executed SQL");
  await userEvent.click(screen.getByText("Technical details",{exact:true}));
  await userEvent.click(screen.getByText("Agent workflow"));
  expect(within(screen.getByRole("region",{name:"Selected step"})).getByText("Read-only query validated.")).toBeVisible();
  expect(screen.queryByLabelText("Ask InsightIQ")).not.toBeInTheDocument();
  expect(analystApi.ask).not.toHaveBeenCalled();
});
it("filters loaded trace history and gives actionable errors", async () => {
  const { unmount } = render(<ExecutionTracesPage datasets={[]} />);
  await screen.findByRole("button", { name: /What is total revenue/ });
  await userEvent.type(
    screen.getByLabelText("Search loaded runs"),
    "unmatched",
  );
  expect(
    screen.getByText("No loaded runs match these filters."),
  ).toBeInTheDocument();
  unmount();
  vi.mocked(analystApi.history).mockRejectedValue(
    new Error("History unavailable."),
  );
  render(<ExecutionTracesPage datasets={[]} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "History unavailable.",
  );
});
it("formats Y-axis labels without rounding data, dropping small values, or collapsing a narrow large range", () => {
  const values = Object.freeze([0.1, 0.30000000000000004]);
  const before = [...values];
  expect(numericAxis([...values], true).formatter(values[1])).toBe("0.3");
  expect(numericAxis([1e6, 2e6], true).formatter(1e6)).toBe("1M");
  expect(numericAxis([-1000, 1000], true).formatter(-1000)).toBe("-1K");
  expect(numericAxis([1e-9], true).formatter(1e-9)).not.toBe("0");
  const dense = numericAxis([1000000001, 1000000005]);
  expect(new Set(dense.ticks.map(dense.formatter)).size).toBe(dense.ticks.length);
  expect(dense.width).toBeGreaterThanOrEqual(60);
  expect([...values]).toEqual(before);
});
it('separates verified reference inventory from missing scores and collapses new setup for a saved result',async()=>{
 vi.mocked(phase4Api.evaluations).mockResolvedValue([missing]);vi.mocked(phase4Api.evaluation).mockResolvedValue(missing);render(<EvaluationPage onDatasetChange={vi.fn()}/>);
 const summary=await screen.findByRole('region',{name:'Stored evaluation summary'});expect(summary).toHaveTextContent('Not measured');expect(summary).toHaveTextContent('0 correct / 0 scored');expect(summary).toHaveTextContent('1 unscored');expect(summary).not.toHaveTextContent('100.0%');
 const inventory=screen.getByRole('region',{name:'Benchmark inventory'});expect(inventory).toHaveTextContent('45 verified reference questions');expect(inventory).toHaveTextContent('not system accuracy');
 const panel=screen.getByText('New evaluation',{exact:true}).closest('details');expect(panel).not.toHaveAttribute('open');expect(screen.getByRole('button',{name:'Start offline replay'})).not.toBeVisible();await userEvent.click(screen.getByText('New evaluation',{exact:true}));expect(screen.getByLabelText('Evaluation mode')).toBeVisible();expect(phase4Api.evaluate).not.toHaveBeenCalled();expect(phase4Api.evaluateOffline).not.toHaveBeenCalled();
});
it('keeps empty-workspace setup available without implying inventory is evaluated accuracy',async()=>{
 render(<EvaluationPage onDatasetChange={vi.fn()}/>);await screen.findByText('No evaluation results yet');expect(screen.getByText('Check saved answers against reference questions. For developers.',{exact:true})).toBeVisible();expect(screen.getByText('New evaluation',{exact:true}).closest('details')).toHaveAttribute('open');expect(screen.queryByRole('region',{name:'Stored evaluation summary'})).not.toBeInTheDocument();expect(screen.getByRole('region',{name:'Benchmark inventory'})).toHaveTextContent('45 verified reference questions');expect(phase4Api.evaluateOffline).not.toHaveBeenCalled();
});
