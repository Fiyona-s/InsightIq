import {reviewApi} from "../knowledgeReviewApi";
import {analystUXApi} from "../analystUXApi";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import RunInsights, {
  RetrievalPanel,
  SQLCode,
  WorkflowInspector,
} from "./RunInsights";
import KnowledgeEditor from "./KnowledgeEditor";
import { AdminToolsProvider } from "../lib/adminTools";
import { useRunEvents } from "./useRunEvents";
import {
  insightApi,
  type AnalystRun,
  type Analysis,
  type Retrieval,
} from "../api";
vi.mock("../api", () => ({
  insightApi: {
    analysis: vi.fn(),
    chart: vi.fn(),
    verify: vi.fn(),
    knowledge: vi.fn(),
    saveKnowledge: vi.fn(),
    retrieve: vi.fn(),
    deleteDataset: vi.fn(),
  },
}));
vi.mock("../knowledgeReviewApi",()=>({reviewApi:{get:vi.fn().mockResolvedValue({revision:"r",drafts:[],examples:[]})}}));
vi.mock("../analystUXApi",()=>({analystUXApi:{suggestions:vi.fn().mockResolvedValue([]),feedback:vi.fn().mockResolvedValue({rating:null,reason:null,timestamp:null}),rate:vi.fn().mockResolvedValue({rating:'helpful'})}}));
const spec = {
  kind: "kpi" as const,
  x: null,
  y: 0,
  title: "total",
  null_policy: "omit_with_count" as const,
  zero_baseline: true as const,
};
const table = { ...spec, kind: "table" as const, y: null };
const analysis: Analysis = {
  charts: {
    recommended: {
      spec,
      points: [{ row: 0, value: 30.5 }],
      omitted_rows: 0,
      note: "One actual result",
    },
    options: [spec, table],
    fallback_reason: null,
  },
  evidence: {
    result_digest: "abc123",
    facts: [
      {
        id: "f1",
        method: "total",
        value: "30.5",
        statement: "total: total = 30.5.",
        source: {
          result_digest: "abc123",
          columns: [0],
          rows: [0],
          formula: "sum(values)",
          scope: "returned rows",
        },
      },
    ],
    coverage: "Returned rows",
  },
  narrative: [{ fact_id: "f1", text: "total: total = 30.5." }],
  narrative_source: "computed",
  warning: null,
};
const run = {
  id: "run-1",
  dataset_id: "data-1",
  status: "succeeded",
  events: [
    {
      id: 1,
      step: "validate",
      status: "rejected",
      timestamp: "2026-01-01",
      attempt: 1,
      summary: "Unknown column.",
    },
  ],
  attempts: 2,
  current_step: "finish",
} as AnalystRun;
const retrieval: Retrieval = {
  status: "ready",
  workspace_id: "private-workspace",
  dataset_id: "data-1",
  fingerprint: "abcd",
  embedding_model: "test-only",
  warning: null,
  rebuilt: true,
  documents: [
    {
      id: "doc-1",
      kind: "column",
      title: "revenue",
      text: "Column revenue; DOUBLE.",
      workspace_id: "private-workspace",
      dataset_id: "data-1",
      fingerprint: "abcd",
      provenance: { source: "actual schema" },
      score: 0.9,
      reason: "Rank 1 within selected dataset.",
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(reviewApi.get).mockResolvedValue({revision:"r",drafts:[],examples:[]});
  vi.mocked(analystUXApi.suggestions).mockResolvedValue([]);
  vi.mocked(analystUXApi.feedback).mockResolvedValue({rating:null,reason:null,timestamp:null});
  vi.mocked(insightApi.analysis).mockResolvedValue(analysis);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it("renders actual KPI, compatible switching and traceable evidence", async () => {
  vi.mocked(insightApi.chart).mockResolvedValue({
    spec: table,
    points: [],
    omitted_rows: 0,
    note: "Table",
  });
  localStorage.setItem("insightiq-admin-tools-v1", "true");
  render(<AdminToolsProvider><RunInsights run={run} results={{columns:[{name:"total",type:"DOUBLE"}],rows:[[30.5]],row_count:1,offset:0,expires_in_seconds:600}} /></AdminToolsProvider>);
  expect(await screen.findByRole("heading",{name:"Your total is 30.5."})).toBeVisible();
  expect(screen.queryByRole("link",{name:"Evidence f1"})).not.toBeInTheDocument();
  expect(
    screen.getByLabelText("Visualization type").querySelectorAll("option"),
  ).toHaveLength(2);
  await userEvent.selectOptions(
    screen.getByLabelText("Visualization type"),
    "table",
  );
  expect(insightApi.chart).toHaveBeenCalledWith("run-1", table);
  // Choosing the table view already opened the details.
  expect(screen.getByText("Show details").closest("details")).toHaveProperty("open", true);
  await userEvent.click(screen.getByRole("tab", { name: "How this was calculated" }));
  await userEvent.click(screen.getByRole("tab", { name: "Execution (admin)" }));
  expect(screen.getByText(/sum\(values\)/)).toBeVisible();
  localStorage.removeItem("insightiq-admin-tools-v1");
});
it("keeps raw execution details out of the owner answer card unless Admin tools are shown", async () => {
  vi.mocked(insightApi.chart).mockResolvedValue({ spec: table, points: [], omitted_rows: 0, note: "Table" });
  localStorage.removeItem("insightiq-admin-tools-v1");
  render(<AdminToolsProvider><RunInsights run={run} results={{columns:[{name:"total",type:"DOUBLE"}],rows:[[30.5]],row_count:1,offset:0,expires_in_seconds:600}} /></AdminToolsProvider>);
  expect(await screen.findByRole("heading",{name:"Your total is 30.5."})).toBeVisible();
  expect(screen.getByRole("tab", { name: "How this was calculated" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /Execution/ })).not.toBeInTheDocument();
});
it("surfaces analysis and chart errors without fabricating a chart", async () => {
  vi.mocked(insightApi.analysis).mockRejectedValue(
    new Error("Result rows expired."),
  );
  render(<RunInsights run={run} results={{columns:[{name:"total",type:"DOUBLE"}],rows:[[30.5]],row_count:1,offset:0,expires_in_seconds:600}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(screen.queryByLabelText("Visualization type")).not.toBeInTheDocument();
});
it("offers explicit candidate proposal without treating feedback as verification",async()=>{
  render(<RunInsights run={run} results={{columns:[{name:"total",type:"DOUBLE"}],rows:[[30.5]],row_count:1,offset:0,expires_in_seconds:600}} />);
  await userEvent.click(await screen.findByRole('button',{name:'More result actions'}));expect(await screen.findByRole('menuitem',{name:'Propose as verified example'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Verify & save SQL example'})).not.toBeInTheDocument();
  expect(insightApi.verify).not.toHaveBeenCalled();
});
it("shows scoped retrieval scores, provenance and unavailable embeddings", async () => {
  const { rerender } = render(<RetrievalPanel retrieval={retrieval} />);
  await userEvent.click(screen.getByText("Retrieved context"));
  expect(screen.getByText("column · 0.900")).toBeVisible();
  await userEvent.click(screen.getByText("Provenance"));
  expect(screen.getByText(/actual schema/)).toBeVisible();
  rerender(
    <RetrievalPanel
      retrieval={{
        ...retrieval,
        status: "unavailable",
        documents: [],
        warning: "Model not provisioned.",
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("not provisioned");
});
it("renders retry details and escapes SQL as text", async () => {
  render(
    <>
      <WorkflowInspector run={run} />
      <pre>
        <SQLCode sql={"SELECT '<img src=x onerror=alert(1)>' FROM data"} />
      </pre>
    </>,
  );
  await userEvent.click(screen.getByText("Agent workflow"));
  expect(screen.getByText("Unknown column.")).toBeVisible();
  expect(screen.getByText("Attempt 2 / 3")).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector(".sql-keyword")).toHaveTextContent("SELECT");
});
class FakeSource extends EventTarget {
  static latest: FakeSource;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
    FakeSource.latest = this;
  }
}
it("streams steps, handles reconnect/error state, completion and cleanup", () => {
  vi.stubGlobal("EventSource", FakeSource);
  const step = vi.fn(),
    complete = vi.fn();
  const { result, unmount } = renderHook(() =>
    useRunEvents("run-1", true, step, complete),
  );
  const source = FakeSource.latest;
  act(() => source.onopen?.());
  expect(result.current).toBe("Live event stream");
  act(() =>
    source.dispatchEvent(
      new MessageEvent("step", { data: JSON.stringify(run.events![0]) }),
    ),
  );
  expect(step).toHaveBeenCalledWith(run.events![0]);
  act(() => source.onerror?.());
  expect(result.current).toContain("Reconnecting");
  act(() => source.onopen?.());
  expect(result.current).toBe("Live event stream");
  act(() =>
    source.dispatchEvent(new MessageEvent("step", { data: "invalid" })),
  );
  expect(result.current).toContain("Invalid event");
  act(() => source.dispatchEvent(new MessageEvent("complete", { data: "{}" })));
  expect(complete).toHaveBeenCalledOnce();
  expect(source.close).toHaveBeenCalled();
  unmount();
  expect(source.close).toHaveBeenCalledTimes(2);
});
it("falls back when EventSource is unavailable", () => {
  vi.stubGlobal("EventSource", undefined);
  const { result } = renderHook(() =>
    useRunEvents("run-1", true, vi.fn(), vi.fn()),
  );
  expect(result.current).toBe("Status polling");
});
it("loads and edits knowledge through typed API calls", async () => {
  const info = {
    workspace_id: "w",
    dataset_id: "d",
    settings: { description: "Original", columns: {}, metrics: [] },
    columns: ["revenue"],
    schema_signature: "hash",
    updated_at: "2026-01-01",
    verified_examples: 0,
    embedding_model: "local-model",
  };
  vi.mocked(insightApi.knowledge).mockResolvedValue(info);
  vi.mocked(insightApi.saveKnowledge).mockResolvedValue(info);
  vi.mocked(insightApi.retrieve).mockResolvedValue(retrieval);
  render(
    <KnowledgeEditor
      datasets={[
        {
          id: "d",
          name: "orders.csv",
          rows: 1,
          bytes: 1,
          created_at: "2026-01-01",
          columns: [],
        },
      ]}
      onDeleted={vi.fn()}
    />,
  );
  const input = await screen.findByLabelText("Dataset description");
  await userEvent.clear(input);
  await userEvent.type(input, "Gross retail sales.");
  await userEvent.click(screen.getByRole("button", { name: "Save definitions" }));
  await waitFor(() =>
    expect(insightApi.saveKnowledge).toHaveBeenCalledWith("d", {
      description: "Gross retail sales.",
      columns: {},
      metrics: [],
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Definitions saved",
  );
  await userEvent.click(screen.getByText("Advanced: verified examples and search"));
  await userEvent.type(screen.getByLabelText("Question"), "revenue");
  await userEvent.click(
    screen.getByRole("button", { name: "Show what Ask would use" }),
  );
  expect(await screen.findByText("What Ask would use")).toBeInTheDocument();
});
it('retries saved-result presentation without submitting a query or fabricating a chart',async()=>{
 vi.mocked(insightApi.analysis).mockRejectedValueOnce(Error('Controlled display unavailable'));
 render(<RunInsights run={run} results={{columns:[{name:'total',type:'DOUBLE'}],rows:[[30.5]],row_count:1,offset:0,expires_in_seconds:600}}/>);
 await screen.findByText('Could not prepare this saved result.');await userEvent.click(screen.getByRole('button',{name:'Retry result display'}));expect(await screen.findByRole('heading',{name:'Your total is 30.5.'})).toBeVisible();expect(insightApi.analysis).toHaveBeenCalledTimes(2);expect(insightApi.chart).not.toHaveBeenCalled();
});
it('keeps secondary actions in a keyboard menu while pinning to a dashboard stays primary',async()=>{
 render(<RunInsights run={run} results={{columns:[{name:'total',type:'DOUBLE'}],rows:[[30.5]],row_count:1,offset:0,expires_in_seconds:600}}/>);
 const more=await screen.findByRole('button',{name:'More result actions'});
 expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Pin to dashboard'})).toHaveClass('button-primary');
 await userEvent.click(more);
 expect(screen.queryByRole('menuitem',{name:'Save to library'})).not.toBeInTheDocument();      // P6: Pin to dashboard already saves the chart
 expect(screen.getByRole('menuitem',{name:'Download CSV'})).toHaveAttribute('href','/api/analyst/runs/run-1/results.csv');
 await userEvent.keyboard('{Escape}');
 expect(more).toHaveFocus();
 expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
});
