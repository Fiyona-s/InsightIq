import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { type Evaluation } from "../phase4api";
import { type AnalystRun } from "../api";
import {
  EvaluationCaseDetails,
  EvaluationResearchSummary,
  EvaluationResultFilter,
  matchesResult,
  useEvaluationRows,
  type EvaluationRow,
} from "./EvaluationDiagnostics";
vi.mock("./DashboardPage", () => ({
  ResultTable: ({ result }: { result: { rows: unknown[] } }) => (
    <pre>{JSON.stringify(result.rows)}</pre>
  ),
}));
const actual = {
  columns: [{ name: "order_record_count", type: "BIGINT" }],
  rows: [[8]],
  row_count: 1,
};
const expected = {
  columns: [{ name: "orders", type: "BIGINT" }],
  rows: [[8]],
  row_count: 1,
};
const run = {
  dataset_name: "Fixture",
  created_at: "2026-11-04",
  completed_at: "2026-11-04",
  executed_sql: "SELECT COUNT(*) AS order_record_count FROM data",
  explanation: null,
  answer: null,
  clarification: null,
  error: null,
  error_code: null,
  type_mapping: {},
  conversions: [],
  result_metadata: null,
  results_available: false,
  id: "saved-run",
  status: "succeeded",
  question: "How many records?",
  dataset_id: "dataset",
  sql: "SELECT COUNT(*) AS order_record_count FROM data",
  attempts: 1,
  metrics: {
    model: "historical-model",
    total_tokens: 2880,
    total_latency_ms: 1574,
    retrieval_latency_ms: 303,
    query_latency_ms: 85,
    estimated_cost_usd: 0.00049275,
  },
  events: [
    {
      id: 1,
      step: "validate",
      status: "passed",
      attempt: 1,
      timestamp: "2026-11-04",
      summary: "Read-only validated.",
    },
  ],
  retrieval: {
    warning: null,
    rebuilt: false,
    status: "ready",
    workspace_id: "workspace",
    dataset_id: "dataset",
    fingerprint: "index",
    embedding_model: "local-only",
    documents: [
      {
        id: "doc",
        title: "data schema",
        text: "Authorized relation data; 8 rows.",
        kind: "dataset",
        score: 0.3,
        reason: "Dataset-scoped cosine match",
        dataset_id: "dataset",
        workspace_id: "workspace",
        fingerprint: "index",
        provenance: { source: "actual schema" },
      },
    ],
  },
} as AnalystRun;
const row = {
  case_id: "q05",
  category: "aggregation",
  difficulty: "easy",
  question: run.question,
  run,
  reference_sql: "SELECT COUNT(*) AS orders FROM data",
  expected,
  actual,
  correct: false,
  comparison: "Column names/semantic aliases differ.",
  failure_labels: ["unclassified_mismatch"],
  comparison_details: {
    policy: "retail-typed-v1-strict-aliases",
    strict_match: false,
    strict_reason: "Column names differ",
    column_names_match: false,
    positional_values_match: true,
    positional_reason: "Typed values match",
    alias_only_mismatch: true,
    notice: "Diagnostic only.",
  },
} satisfies EvaluationRow;
const job = {
  status: "completed",
  created_at: "2026-11-04",
  completed_at: "2026-11-04",
  updated_at: "2026-11-04",
  active_run_id: null,
  provider_calls: 2,
  reserved_tokens: 0,
  reserved_cost_usd: 0,
  max_total_tokens: 100000,
  max_spend_usd: 1,
  error: null,
  pricing: { input: "1", output: "2", source: "Controlled test" },
  id: "evaluation",
  mode: "paid",
  pipeline: "agentic",
  model: "historical-model",
  dataset_id: "dataset",
  dataset_fingerprint: "content-fingerprint",
  version: "retail-v1",
  case_ids: ["q05", "q06", "q07", "q08"],
  results: [
    row,
    { ...row, case_id: "q06", correct: true },
    {
      ...row,
      case_id: "q07",
      status: "execution_failed",
      correct: false,
      actual: null,
    },
  ],
  metrics: {
    total_tokens: null,
    estimated_cost_usd: null,
    valid_sql_rate: null,
    execution_success_rate: null,
    result_accuracy: null,
    repair_success_rate: null,
    categories: {},
    diagnostic_counts: {},
    diagnostic_note: "Controlled test",
    completed_cases: 3,
    accuracy: 1 / 3,
    rates: {
      result_correctness: {
        value: 1 / 3,
        numerator: 1,
        denominator: 3,
        unit: "evaluated predictions",
        description: "Strict contract",
      },
      correct_abstention: {
        value: null,
        numerator: 0,
        denominator: 0,
        unit: "abstention evaluated cases",
        description: "None evaluated",
      },
    },
    latency_sample_size: 2,
    usage_sample_size: 2,
    cost_sample_size: 2,
    p50_latency_ms: 1400,
    p95_latency_ms: 1500,
    average_attempts: 1,
  },
} as Evaluation;
function Harness() {
  const view = useEvaluationRows(job);
  return (
    <>
      <EvaluationResultFilter
        value={view.filter}
        onChange={view.setFilter}
        shown={view.rows.length}
        total={view.total}
      />
      <ul>
        {view.rows.map((r) => (
          <li key={r.case_id}>
            {r.case_id}: {r.comparison}
          </li>
        ))}
      </ul>
    </>
  );
}
it("filters correct, incorrect, execution failures and genuinely unevaluated selected cases", async () => {
  render(<Harness />);
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  for (const [filter, ids] of [
    ["correct", ["q06"]],
    ["incorrect", ["q05", "q07"]],
    ["execution_failure", ["q07"]],
    ["unevaluated", ["q08"]],
  ] as const) {
    await userEvent.selectOptions(
      screen.getByLabelText("Filter question results"),
      filter,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(ids.length);
    ids.forEach((id) => expect(screen.getByRole("list")).toHaveTextContent(id));
  }
  expect(screen.getByRole("list")).toHaveTextContent(
    "Not evaluated — prediction not recorded",
  );
  expect(job.results?.[0].correct).toBe(false);
});
it("keeps NULL correctness unscored and distinguishes execution failures from ordinary mismatches", () => {
  expect(matchesResult(row, "execution_failure")).toBe(false);
  expect(matchesResult({ ...row, correct: null }, "correct")).toBe(false);
  expect(matchesResult({ ...row, correct: null }, "unevaluated")).toBe(true);
});
it("shows aliases as an observed contract mismatch with SQL, retrieval, latency, tokens and unknown legacy prompt provenance", async () => {
  render(<EvaluationCaseDetails row={row} job={job} />);
  expect(screen.getByText(/Alias-only contract mismatch/)).toHaveTextContent(
    "Strict correctness remains failed",
  );
  expect(screen.getByText("q05 · easy · Incorrect")).toBeInTheDocument();
  expect(screen.getAllByText("[[8]]")).toHaveLength(2);
  expect(screen.getByText("2,880")).toBeInTheDocument();
  expect(screen.getAllByText(/Unknown — not recorded/).length).toBeGreaterThan(
    0,
  );
  expect(screen.getByText(/content-fingerprint/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("Retrieved context"));
  expect(screen.getByText("Authorized relation data; 8 rows.")).toBeVisible();
  await userEvent.click(screen.getByText("Agent workflow"));
  expect(screen.getByText("Read-only validated.")).toBeVisible();
});
it("reports every research percentage with its sample size and leaves zero-denominator abstention unknown", () => {
  render(<EvaluationResearchSummary job={job} />);
  const summary = screen.getByRole("region", { name: "Research summary" });
  expect(
    within(summary).getByText("33.3% · 1 / 3 evaluated predictions"),
  ).toBeInTheDocument();
  expect(
    within(summary).getByText(
      "Not measured · 0 / 0 abstention evaluated cases",
    ),
  ).toBeInTheDocument();
  expect(summary).toHaveTextContent(
    "This sample is not overall benchmark accuracy",
  );
  expect(summary).toHaveTextContent("n=2");
  expect(summary).toHaveTextContent(
    "Independent cause reviews · 0 reviewed cases",
  );
  expect(summary).toHaveTextContent("Unreviewed causes remain unknown");
});
it("labels historical effort and cost separately from new offline replay", () => {
  render(
    <EvaluationCaseDetails
      row={{
        ...row,
        source_model: "historical-model",
        source_pipeline: "agentic",
        offline_latency_ms: 200,
      }}
      job={{ ...job, mode: "offline", pipeline: "offline" }}
    />,
  );
  expect(screen.getByText("Historical reported tokens")).toBeInTheDocument();
  expect(screen.getByText("Historical estimated cost")).toBeInTheDocument();
  expect(screen.getByText("New local replay latency")).toBeInTheDocument();
  expect(screen.getByText(/estimate, not an invoice/)).toBeInTheDocument();
});
