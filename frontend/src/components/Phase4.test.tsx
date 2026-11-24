import {dashboardWorkspaceApi} from "../dashboardWorkspaceApi";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import DashboardPage from "./DashboardPage";
import EvaluationPage from "./EvaluationPage";
import AnalyticsPage from "./AnalyticsPage";
import FilterEditor from "./FilterEditor";
import {
  phase4Api,
  type Dashboard,
  type Benchmark,
  type Analytics,
  type Evaluation,
} from "../phase4api";
import type { AnalystRun, ChartSpec } from "../api";
vi.mock("../dashboardWorkspaceApi",()=>({dashboardWorkspaceApi:{refresh:vi.fn(),duplicate:vi.fn()}}));
vi.mock("../phase4api", () => ({
  phase4Api: {
    dashboards: vi.fn(),
    charts: vi.fn(),
    dashboard: vi.fn(),
    createDashboard: vi.fn(),
    saveDashboard: vi.fn(),
    duplicateDashboard: vi.fn(),
    deleteDashboard: vi.fn(),
    saveChart: vi.fn(),
    refreshChart: vi.fn(),
    deleteChart: vi.fn(),
    benchmark: vi.fn(),
    evaluations: vi.fn(),
    evaluation: vi.fn(),
    evaluate: vi.fn(),
    installBenchmark: vi.fn(),
    verifyBenchmark: vi.fn(),
    cancelEvaluation: vi.fn(),
    analytics: vi.fn(),
  },
}));
const table: ChartSpec = {
  kind: "table",
  title: "Results",
  x: null,
  y: null,
  null_policy: "omit_with_count",
  zero_baseline: true,
};
const source = {
  id: "chart-1",
  title: "Revenue",
  dataset_id: "dataset-1",
  dataset_name: "controlled-test.csv",
  source_run_id: "run-1",
  question: "Total revenue?",
  sql: "SELECT SUM(revenue) AS total FROM data",
  type_mapping: { revenue: "DOUBLE" },
  spec: table,
  refresh_policy: "manual" as const,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  last_successful_refresh: "2026-01-01",
  status: "snapshot",
  error: null,
  summary: [],
  narrative_source: "computed",
};
const dashboard: Dashboard = {
  id: "dashboard-1",
  title: "Sales review",
  description: "Saved actual output",
  revision: 1,
  filters: [],
  widgets: [
    {
      id: "widget-1",
      chart_id: "chart-1",
      kind: "chart",
      title: "Revenue",
      text: "",
      spec: null,
      filters: [],
      width: 6,
      height: 4,
      source,
      freshness:{status:"Current",reason:null,can_refresh:true,label:"controlled-test.csv",original_name:"controlled-test.csv",archived:false,deleted:false},
      result: {
        columns: [{ name: "total", type: "DOUBLE" }],
        rows: [[30.5]],
        row_count: 1,
      },
      chart: { spec: table, points: [], omitted_rows: 0, note: "Exact table" },
      chart_options: [table],
      filters_applied: { applied: [], unavailable: [], scope: "Output rows" },
      evidence: { facts: [], result_digest: "digest" },
    },
  ],
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  snapshot_notice: "Explicit saved result snapshot.",
};
const benchmark: Benchmark = {
  version: "retail-v1",
  title: "Controlled authored benchmark",
  dataset_id: "dataset-benchmark",
  case_count: 45,
  verified_count: 45,
  pending_count: 0,
  cases: [
    {
      id: "q05",
      question: "How many orders?",
      category: "aggregation",
      difficulty: "easy",
      expectation: "sql",
      reference_sql: "SELECT COUNT(*) AS orders FROM data",
      expected: {
        columns: [{ name: "orders", type: "BIGINT" }],
        rows: [[8]],
        row_count: 1,
      },
      ordered: false,
      verification: "verified",
    },
    {
      id: "q06",
      question: "Sum revenue?",
      category: "aggregation",
      difficulty: "easy",
      expectation: "sql",
      reference_sql: "SELECT SUM(revenue) FROM data",
      expected: null,
      ordered: false,
      verification: "verified",
    },
  ],
  scope: "Controlled data only",
  comparison_policy: "Typed result comparison",
  pricing: { input: "1", output: "2" },
  limits: {
    max_cases: 10,
    max_provider_calls: 30,
    output_tokens_per_call: 1600,
    max_seconds: 600,
    cost_policy: "Reserved before every call",
  },
};
const analytics: Analytics = {
  total_questions: 0,
  succeeded: 0,
  failed: 0,
  execution_success_rate: null,
  correctness: "Not measured for normal activity.",
  validation_failures: 0,
  attempts: {},
  latency_ms: { average: null, p50: null, p95: null, measured_records: 0 },
  retrieval_latency_ms: { average: null, measured_records: 0 },
  tokens: { known_sum: 0, known_records: 0, unknown_records: 0 },
  cost_usd: { known_sum: 0, known_records: 0, unknown_records: 0 },
  error_categories: {},
  recent: [],
  models: [],
  coverage: "Normal activity only",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(phase4Api.dashboards).mockResolvedValue([
    { ...dashboard, widget_count: dashboard.widgets.length },
  ]);
  vi.mocked(phase4Api.charts).mockResolvedValue([source]);
  vi.mocked(dashboardWorkspaceApi.duplicate).mockResolvedValue({...dashboard,widgets:[...dashboard.widgets,{...dashboard.widgets[0],id:'widget-2'}]});
  vi.mocked(phase4Api.dashboard).mockResolvedValue(dashboard);
  vi.mocked(phase4Api.saveDashboard).mockImplementation(async (d) => ({
    ...d,
    revision: d.revision + 1,
  }));
  vi.mocked(phase4Api.benchmark).mockResolvedValue(benchmark);
  vi.mocked(phase4Api.evaluations).mockResolvedValue([]);
  vi.mocked(phase4Api.analytics).mockResolvedValue(analytics);
});
it("loads persisted dashboard output and saves resize and reorder changes", async () => {
  render(<DashboardPage />);
  expect(await screen.findByRole("cell", { name: "30.5" })).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button",{name:"Edit dashboard"}));
  await userEvent.click(screen.getByText("Layout"));
  await userEvent.selectOptions(screen.getByLabelText("Widget width 1"), "12");
  await waitFor(() =>
    expect(phase4Api.saveDashboard).toHaveBeenCalledWith(
      expect.objectContaining({
        widgets: [expect.objectContaining({ width: 12 })],
      }),
    ),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Duplicate widget 1" }),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("cell", { name: "30.5" })).toHaveLength(2),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Move widget 2 up" }),
  );
  expect(phase4Api.saveDashboard).toHaveBeenLastCalledWith(
    expect.objectContaining({
      widgets: [
        expect.objectContaining({
          id: expect.not.stringMatching(/^widget-1$/),
        }),
        expect.objectContaining({ id: "widget-1" }),
      ],
    }),
  );
});
it("creates a dashboard from a meaningful empty state", async () => {
  vi.mocked(phase4Api.dashboards).mockResolvedValue([]);
  vi.mocked(phase4Api.charts).mockResolvedValue([]);
  vi.mocked(phase4Api.createDashboard).mockResolvedValue({
    ...dashboard,
    widgets: [],
  });
  render(<DashboardPage />);
  expect(
    await screen.findByRole("heading", {
      name: "Create a dashboard",
    }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "New dashboard" }));
  await userEvent.type(
    await screen.findByLabelText("New dashboard title"),
    "Quarterly review",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create dashboard" }),
  );
  await waitFor(() =>
    expect(phase4Api.createDashboard).toHaveBeenCalledWith("Quarterly review"),
  );
});
it("reports dashboard loading errors without fabricated content", async () => {
  vi.mocked(phase4Api.dashboards).mockRejectedValue(
    new Error("Storage unavailable."),
  );
  render(<DashboardPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Storage unavailable",
  );
  expect(screen.queryByRole("cell", { name: "30.5" })).not.toBeInTheDocument();
});
it("refresh errors retain visible snapshot data and expose report exports", async () => {
  vi.mocked(dashboardWorkspaceApi.refresh).mockRejectedValue(
    new Error("Source schema changed."),
  );
  render(<DashboardPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: /^Actions for/ }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "Refresh" }));
  await userEvent.click(screen.getByRole("button",{name:"Confirm refresh"}));
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("schema changed");
  expect(screen.getByRole("cell", { name: "30.5" })).toBeInTheDocument();
  // Export PDF is the primary action, visible without opening any menu.
  expect(screen.getByRole("link", { name: "Export PDF" })).toHaveAttribute(
    "href",
    "/api/dashboards/dashboard-1/report.pdf",
  );
  await userEvent.click(screen.getByRole("button",{name:"More actions"}));
  expect(screen.queryByRole("menuitem", { name: "Export JSON" })).not.toBeInTheDocument();      // P6: the JSON export is no longer offered in the page (the API route remains)
});
it("applies actual filter contracts and resets them", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <FilterEditor filters={[]} onChange={onChange} />,
  );
  await userEvent.click(screen.getByText("Result filters"));
  await userEvent.type(screen.getByLabelText("Result column"), "region");
  await userEvent.type(
    screen.getByLabelText("Values, separated by commas"),
    "North, South",
  );
  await userEvent.click(screen.getByRole("button", { name: "Apply filter" }));
  expect(onChange).toHaveBeenCalledWith([
    {
      column: "region",
      kind: "category",
      values: ["North", "South"],
      minimum: null,
      maximum: null,
    },
  ]);
  rerender(
    <FilterEditor
      filters={[{ column: "region", kind: "category", values: ["North"] }]}
      onChange={onChange}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});
it("requires paid-call confirmation and displays exact usage ceilings", async () => {
  const job = {
    id: "evaluation-1",
    dataset_id: "dataset-benchmark",
    version: "retail-v1",
    pipeline: "agentic",
    model: "controlled-test",
    status: "completed",
    created_at: "2026-01-01",
    completed_at: "2026-01-01",
    updated_at: "2026-01-01",
    active_run_id: null,
    case_ids: ["q05", "q06"],
    provider_calls: 2,
    reserved_tokens: 100,
    reserved_cost_usd: 0.01,
    max_total_tokens: 100000,
    max_spend_usd: 0.5,
    error: null,
    metrics: null,
    pricing: { input: "1", output: "2", source: "test-only" },
    results: [],
  } as Evaluation;
  vi.mocked(phase4Api.evaluate).mockResolvedValue(job);
  render(<EvaluationPage onDatasetChange={vi.fn()} />);
  expect(
    await screen.findByText("45 / 45 verified · 0 pending"),
  ).toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByLabelText("Evaluation mode"),
    "paid",
  );
  expect(screen.getByRole("button", { name: "Run evaluation" })).toBeDisabled();
  expect(screen.getByText("Up to 6 provider calls")).toBeInTheDocument();
  await userEvent.click(
    screen.getByLabelText(
      "I authorize paid provider calls within these displayed limits.",
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Run evaluation" }));
  await waitFor(() =>
    expect(phase4Api.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        confirm_paid_calls: true,
        pipeline: "agentic",
        case_ids: ["q05", "q06"],
        max_spend_usd: 0.5,
      }),
    ),
  );
  await userEvent.click(await screen.findByText("Detailed diagnostics and exports",{exact:true}));
  expect(
    await screen.findByRole("region", { name: "Evaluation results" }),
  ).toHaveTextContent("completed");
});
it("blocks paid evaluation when pricing is unknown", async () => {
  vi.mocked(phase4Api.benchmark).mockResolvedValue({
    ...benchmark,
    pricing: null,
  });
  render(<EvaluationPage onDatasetChange={vi.fn()} />);
  await screen.findByLabelText("Evaluation mode");
  await userEvent.selectOptions(
    screen.getByLabelText("Evaluation mode"),
    "paid",
  );
  expect(await screen.findByText(/Pricing unknown/)).toBeInTheDocument();
  await userEvent.click(
    screen.getByLabelText(
      "I authorize paid provider calls within these displayed limits.",
    ),
  );
  expect(screen.getByRole("button", { name: "Run evaluation" })).toBeDisabled();
  expect(phase4Api.evaluate).not.toHaveBeenCalled();
});
it("filters persisted analytics and labels correctness as unmeasured", async () => {
  render(<AnalyticsPage datasets={[]} />);
  expect(
    await screen.findByText(/Not measured for normal activity/),
  ).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Search questions"), "revenue");
  await userEvent.click(
    screen.getByRole("button", { name: "Apply analytics filters" }),
  );
  await waitFor(() =>
    expect(phase4Api.analytics).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "revenue" }),
    ),
  );
  expect(screen.getByText("Not recorded")).toBeInTheDocument();
});
it('opens in View and toggles modes without saving or exposing authoring controls',async()=>{
 const before=JSON.stringify(dashboard);render(<DashboardPage/>);await screen.findByRole('heading',{name:'Sales review'});expect(screen.queryByLabelText('Widget width 1')).not.toBeInTheDocument();expect(screen.queryByLabelText('Dashboard title')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Delete widget 1'})).not.toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'Edit dashboard'}));expect(screen.getByLabelText('Dashboard title')).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Done editing'}));expect(screen.getByRole('heading',{name:'Sales review'})).toBeVisible();expect(phase4Api.saveDashboard).not.toHaveBeenCalled();expect(JSON.stringify(dashboard)).toBe(before);
});
it('keeps unsaved details separate from auto-saved layout and supports explicit discard',async()=>{
 render(<DashboardPage/>);await userEvent.click(await screen.findByRole('button',{name:'Edit dashboard'}));const title=screen.getByLabelText('Dashboard title');await userEvent.clear(title);await userEvent.type(title,'Draft review');await userEvent.click(screen.getByText('Layout'));await userEvent.selectOptions(screen.getByLabelText('Widget width 1'),'12');await waitFor(()=>expect(phase4Api.saveDashboard).toHaveBeenCalledWith(expect.objectContaining({title:'Sales review'})));await userEvent.click(screen.getByRole('button',{name:'Done editing'}));const dialog=screen.getByRole('dialog',{name:'Unsaved dashboard details'});await userEvent.click(within(dialog).getByRole('button',{name:'Keep editing'}));expect(screen.getByLabelText('Dashboard title')).toHaveValue('Draft review');await userEvent.click(screen.getByRole('button',{name:'Done editing'}));await userEvent.click(screen.getByRole('button',{name:'Discard details and view'}));expect(screen.getByRole('heading',{name:'Sales review'})).toBeVisible();expect(phase4Api.saveDashboard).toHaveBeenCalledTimes(1);
});
it('retains Edit and draft details on failed save, then saves explicitly before View',async()=>{
 vi.mocked(phase4Api.saveDashboard).mockRejectedValueOnce(Error('Controlled storage failure'));render(<DashboardPage/>);await userEvent.click(await screen.findByRole('button',{name:'Edit dashboard'}));await userEvent.clear(screen.getByLabelText('Dashboard title'));await userEvent.type(screen.getByLabelText('Dashboard title'),'Reviewed sales');await userEvent.click(screen.getByRole('button',{name:'Done editing'}));await userEvent.click(screen.getByRole('button',{name:'Save and view'}));await screen.findByText('Controlled storage failure');expect(screen.getByRole('dialog',{name:'Unsaved dashboard details'})).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Save and view'}));await screen.findByRole('heading',{name:'Reviewed sales'});expect(phase4Api.saveDashboard).toHaveBeenLastCalledWith(expect.objectContaining({title:'Reviewed sales'}));
});
it('keeps Analytics missing usage unknown and detailed filters collapsed without submitting work',async()=>{
 render(<AnalyticsPage datasets={[]}/>);await screen.findByText('Normal user questions');expect(screen.getByText('Known estimated cost').closest('.metric-card')).toHaveTextContent('Unknown');expect(screen.getByText('Known token sum').closest('.metric-card')).toHaveTextContent('Unknown');expect(screen.getByText('More filters',{exact:true}).closest('details')).not.toHaveAttribute('open');expect(screen.getByText('No recent runs match the applied filters.')).toBeVisible();expect(phase4Api.analytics).toHaveBeenCalledTimes(1);
});
it('uses recorded retry buckets and preserves tiny known cost rather than rounding it to zero',async()=>{
 const measured={...analytics,total_questions:7,attempts:{'1':2,'2':3,'3':1,'None':1},cost_usd:{known_sum:0.00000001,known_records:1,unknown_records:6}};const original=JSON.stringify(measured);vi.mocked(phase4Api.analytics).mockResolvedValue(measured);render(<AnalyticsPage datasets={[]}/>);await screen.findByText('Normal user questions');expect(screen.getByText('Runs with recorded retries').closest('.metric-card')).toHaveTextContent('4');expect(screen.getByText('Known estimated cost').closest('.metric-card')).toHaveTextContent('$0.00000001');await userEvent.selectOptions(screen.getByLabelText('Status'),'failed');await userEvent.click(screen.getByRole('button',{name:'Apply analytics filters'}));await waitFor(()=>expect(phase4Api.analytics).toHaveBeenLastCalledWith(expect.objectContaining({status:'failed'})));expect(JSON.stringify(measured)).toBe(original);
});

it("deleting a dashboard tile asks in the shared Modal first, keeps it on Cancel and removes it only on confirm", async () => {
  vi.mocked(phase4Api.saveDashboard).mockImplementation(async (next) => next as never);
  const confirmSpy = vi.spyOn(window, "confirm");
  render(<DashboardPage />);
  await screen.findByRole("heading", { name: "Sales review" });
  await userEvent.click(screen.getByRole("button", { name: "Edit dashboard" }));
  await userEvent.click(screen.getByRole("button", { name: "Delete widget 1" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete widget" });
  expect(dialog).toHaveTextContent("Delete this widget? Saved charts remain in your library.");
  expect(phase4Api.saveDashboard).not.toHaveBeenCalled(); // asking is not deleting
  await userEvent.click(screen.getByRole("button", { name: "Keep widget" }));
  expect(screen.queryByRole("dialog", { name: "Delete widget" })).not.toBeInTheDocument();
  expect(phase4Api.saveDashboard).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete widget 1" }));
  await userEvent.click(within(await screen.findByRole("dialog", { name: "Delete widget" })).getByRole("button", { name: "Delete widget" }));
  await waitFor(() => expect(phase4Api.saveDashboard).toHaveBeenCalledTimes(1));
  expect(vi.mocked(phase4Api.saveDashboard).mock.calls[0][0].widgets.some((w) => w.id === dashboard.widgets[0].id)).toBe(false);
  expect(confirmSpy).not.toHaveBeenCalled(); // no browser confirm box any more
});

it("Export PDF explains that the last pages show how numbers were calculated, and a shorter PDF stays one click away", async () => {
  render(<DashboardPage />);
  const link = await screen.findByRole("link", { name: "Export PDF" });
  expect(link).toHaveAttribute("title", expect.stringMatching(/last pages show how they were calculated/));
  expect(link.getAttribute("href")).not.toContain("appendix=false"); // the appendix is included by default
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menuitem", { name: "Export PDF without calculation pages" })).toHaveAttribute("href", expect.stringContaining("report.pdf?appendix=false"));
});
