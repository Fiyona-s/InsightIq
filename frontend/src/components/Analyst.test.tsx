import {analystUXApi} from "../analystUXApi";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Analyst from "./Analyst";
import { setTechnicalDetails } from "../lib/technicalDetails";
import { insightApi, analystApi, type AnalystRun, type Dataset } from "../api";
vi.mock("../api", () => ({
  insightApi: { analysis: vi.fn(), knowledge: vi.fn(), saveKnowledge: vi.fn() },
  analystApi: {
    profile: vi.fn(),
    history: vi.fn(),
    ask: vi.fn(),
    run: vi.fn(),
    results: vi.fn(),
    cancel: vi.fn(),
    rerun: vi.fn(),
    confirmedTypes: vi.fn(),
    confirmTypes: vi.fn(),
    forgetTypes: vi.fn(),
  },
}));
vi.mock("../analystUXApi",()=>({analystUXApi:{suggestions:vi.fn().mockResolvedValue([]),feedback:vi.fn().mockResolvedValue({rating:null,reason:null,timestamp:null}),rate:vi.fn().mockResolvedValue({rating:'helpful'})}}));
const data: Dataset = {
  id: "dataset-1",
  name: "orders.csv",
  rows: 3,
  bytes: 25,
  created_at: "2026-01-01",
  columns: [{ name: "revenue", type: "VARCHAR", null_count: 0 }],
};
const completed: AnalystRun = {
  id: "run-1",
  dataset_id: data.id,
  dataset_name: data.name,
  question: "What is revenue?",
  status: "succeeded",
  created_at: "2026-01-01",
  completed_at: "2026-01-01",
  sql: "SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total FROM data",
  executed_sql: "SELECT SUM(TRY_CAST(revenue AS DOUBLE)) AS total FROM data",
  explanation: "Sum numeric revenue.",
  answer: "total: 30.5",
  clarification: null,
  error: null,
  error_code: null,
  type_mapping: {},
  conversions: [],
  metrics: {
    model: "test-only-model",
    total_latency_ms: 123,
    total_tokens: 20,
  },
  result_metadata: {
    columns: [{ name: "total", type: "DOUBLE" }],
    row_count: 1,
  },
  results_available: true,
};
beforeEach(() => {
  setTechnicalDetails(false);
  vi.resetAllMocks();
  vi.mocked(analystUXApi.suggestions).mockResolvedValue([]);
  vi.mocked(analystUXApi.feedback).mockResolvedValue({rating:null,reason:null,timestamp:null});
  vi.mocked(insightApi.analysis).mockResolvedValue({
    charts: {
      recommended: {
        spec: {
          kind: "table",
          x: null,
          y: null,
          title: "Results",
          null_policy: "omit_with_count",
          zero_baseline: true,
        },
        points: [],
        omitted_rows: 0,
        note: "Table",
      },
      options: [],
      fallback_reason: "No suitable chart",
    },
    evidence: {
      result_digest: "test",
      facts: [],
      coverage: "No numeric columns",
    },
    narrative: [],
    narrative_source: "computed",
    warning: null,
  });
  vi.mocked(analystApi.profile).mockResolvedValue({
    table: "data",
    rows: 3,
    columns: [
      {
        name: "revenue",
        storage_type: "VARCHAR",
        missing: 0,
        suggested_type: "DOUBLE",
        conversions: { DOUBLE: { valid: 3, failed: 0 } },
      },
    ],
    policy: "Preserve raw data.",
  });
  vi.mocked(analystApi.history).mockResolvedValue([]);
  vi.mocked(analystApi.results).mockResolvedValue({
    columns: [{ name: "total", type: "DOUBLE" }],
    rows: [[30.5]],
    row_count: 1,
    offset: 0,
    expires_in_seconds: 600,
  });
});
const looksRight = async () => userEvent.click(await screen.findByRole("button", { name: "These types look right" }));
function mount() {
  return render(
    <Analyst
      datasets={[data]}
      initialDataset={data.id}
      onWorkspace={vi.fn()}
    />,
  );
}
it("submits a real API contract, polls, shows executed SQL and results", async () => {
  vi.mocked(analystApi.ask).mockResolvedValue({
    ...completed,
    status: "generating",
    sql: null,
    executed_sql: null,
    answer: null,
    results_available: false,
  });
  vi.mocked(analystApi.run).mockResolvedValue(completed);
  mount();
  await userEvent.click(await screen.findByText("Check column types"));
  await looksRight();
  await userEvent.type(
    screen.getByLabelText("Your question"),
    "What is revenue?",
  );
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  expect(
    await screen.findByText("Working on your question…"),
  ).toBeInTheDocument();
  expect(await screen.findByRole("heading",{name:"Your total is 30.5."})).toBeInTheDocument();
  await userEvent.click(screen.getByText("Show details"));
  expect(await screen.findByRole("cell", { name: "30.5" })).toBeInTheDocument();
  // Owners do not see the SQL by default; it is one Settings switch away.
  expect(screen.queryByRole("tab", { name: "SQL" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "How this was calculated" })).toBeInTheDocument();
  setTechnicalDetails(true);
  await userEvent.click(await screen.findByRole("tab", { name: "SQL" }));
  expect(screen.getByText(/SELECT/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Data" }));
  expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
    "href",
    "/api/analyst/runs/run-1/results.csv",
  );
  expect(analystApi.ask).toHaveBeenCalledWith(data.id, "What is revenue?", {}, expect.objectContaining({thread_id:expect.any(String)}));
});
it("requires explicit confirmation for proposed numeric mappings", async () => {
  vi.mocked(analystApi.ask).mockResolvedValue(completed);
  mount();
  await userEvent.click(await screen.findByText("Check column types"));
  await userEvent.click(
    screen.getByRole("button", { name: "Use suggested types" }),
  );
  await userEvent.type(screen.getByLabelText("Your question"), "Total revenue");
  expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await waitFor(() =>
    expect(analystApi.ask).toHaveBeenCalledWith(data.id, "Total revenue", {
      revenue: "DOUBLE",
    },expect.objectContaining({thread_id:expect.any(String)})),
  );
});
it("shows provider failure without fabricating a result", async () => {
  vi.mocked(analystApi.ask).mockResolvedValue({
    ...completed,
    status: "failed",
    sql: null,
    executed_sql: null,
    answer: null,
    results_available: false,
    error: "AI Analyst is not configured. Set LLM_API_KEY.",
    error_code: "not_configured",
  });
  mount();
  await userEvent.click(await screen.findByText("Check column types"));
  await looksRight();
  await userEvent.type(screen.getByLabelText("Your question"), "Count records");
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("LLM_API_KEY");
  expect(analystApi.results).not.toHaveBeenCalled();
});
it("shows submission errors and allows retry", async () => {
  vi.mocked(analystApi.ask).mockRejectedValue(
    new Error("Two analyst runs are already active."),
  );
  mount();
  await userEvent.click(await screen.findByText("Check column types"));
  await looksRight();
  await userEvent.type(screen.getByLabelText("Your question"), "Count records");
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already active");
  expect(screen.getByRole("button", { name: "Analyze" })).toBeEnabled();
});
it("inspects persisted history and labels expired rows", async () => {
  vi.mocked(analystApi.history).mockResolvedValue([
    { ...completed, results_available: false },
  ]);
  mount();
  await userEvent.click(screen.getByText("Recent questions"));
  await userEvent.click(
    await screen.findByRole("button", { name: /What is revenue/ }),
  );
  expect(
    await screen.findByText(/asked before answers were kept/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ask it again" })).toBeInTheDocument();
  expect(screen.queryByText("Generated SQL")).not.toBeInTheDocument(); // technical detail is off by default
  setTechnicalDetails(true);
  expect(await screen.findByText("Generated SQL")).toBeInTheDocument();
  expect(analystApi.results).not.toHaveBeenCalled();
});
it("renders valid empty results and clarifications separately", async () => {
  vi.mocked(analystApi.history).mockResolvedValue([
    { ...completed, answer: "No matching rows." },
  ]);
  vi.mocked(analystApi.results).mockResolvedValue({
    columns: [{ name: "total", type: "DOUBLE" }],
    rows: [],
    row_count: 0,
    offset: 0,
    expires_in_seconds: 500,
  });
  mount();
  await userEvent.click(screen.getByText("Recent questions"));
  await userEvent.click(
    await screen.findByRole("button", { name: /What is revenue/ }),
  );
  expect(
    await screen.findByText(
      "No rows matched this question.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("cancels an active run through the API", async () => {
  const generating = {
    ...completed,
    status: "generating",
    results_available: false,
    sql: null,
    answer: null,
  };
  vi.mocked(analystApi.ask).mockResolvedValue(generating);
  vi.mocked(analystApi.run).mockResolvedValue(generating);
  vi.mocked(analystApi.cancel).mockResolvedValue(generating);
  mount();
  await userEvent.click(await screen.findByText("Check column types"));
  await looksRight();
  await userEvent.type(screen.getByLabelText("Your question"), "Count records");
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Cancel run" }),
  );
  expect(analystApi.cancel).toHaveBeenCalledWith("run-1");
  expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
});
it("guides an empty workspace to real import", () => {
  render(
    <Analyst datasets={[]} initialDataset={undefined} onWorkspace={vi.fn()} />,
  );
  expect(
    screen.getByRole("heading", { name: "Start with your data" }),
  ).toBeInTheDocument();
});

it("loads earlier persisted runs using history pagination", async () => {
  const first = Array.from({ length: 30 }, (_, i) => ({
    ...completed,
    id: `old-${i}`,
    question: `Saved question ${i}`,
    results_available: false,
  }));
  vi.mocked(analystApi.history)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce([
      {
        ...completed,
        id: "older",
        question: "Earlier saved question",
        results_available: false,
      },
    ]);
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Load earlier runs" }),
  );
  expect(
    await screen.findByRole("button", { name: /Earlier saved question/ }),
  ).toBeInTheDocument();
  expect(analystApi.history).toHaveBeenLastCalledWith(data.id, 30);
});
it("shows clarification without executing or inventing rows", async () => {
  vi.mocked(analystApi.ask).mockResolvedValue({
    ...completed,
    status: "clarification",
    sql: null,
    executed_sql: null,
    answer: null,
    clarification: "Which revenue definition should I use?",
    results_available: false,
  });
  mount();
  await userEvent.click(await screen.findByText("Check column types"));
  await looksRight();
  await userEvent.type(
    screen.getByLabelText("Your question"),
    "What is performance?",
  );
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  expect(
    await screen.findByText("Which revenue definition should I use?"),
  ).toBeInTheDocument();
  expect(analystApi.results).not.toHaveBeenCalled();
});

// Approved fix 3a: confirmed column types are remembered per dataset.
it("remembers explicitly confirmed types and restores them after leaving and returning to Ask", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: null, current: false });
  vi.mocked(analystApi.confirmTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { revenue: "DOUBLE" }, confirmed_at: "2026-11-15T10:00:00Z", current: true });
  vi.mocked(analystApi.ask).mockResolvedValue(completed);
  const first = mount();
  await userEvent.click(await screen.findByText("Check column types"));
  await userEvent.click(screen.getByRole("button", { name: "Use suggested types" }));
  expect(analystApi.confirmTypes).not.toHaveBeenCalled(); // suggestions alone are never remembered
  await userEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(analystApi.confirmTypes).toHaveBeenCalledWith(data.id, { revenue: "DOUBLE" }));
  first.unmount(); // leave Ask

  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { revenue: "DOUBLE" }, confirmed_at: "2026-11-15T10:00:00Z", current: true });
  mount(); // return to Ask
  expect(await screen.findByText(/Using the column types you confirmed/)).toBeInTheDocument();
  await userEvent.click(screen.getByText("Check column types"));
  expect(screen.getByLabelText("Analysis type for revenue")).toHaveValue("DOUBLE");
  expect(screen.getByRole("checkbox")).toBeChecked();
  await userEvent.type(screen.getByLabelText("Your question"), "Total revenue");
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await waitFor(() => expect(analystApi.ask).toHaveBeenCalledWith(data.id, "Total revenue", { revenue: "DOUBLE" }, expect.objectContaining({ thread_id: expect.any(String) })));
});

it("keeps the confirmation rule: changing a remembered type requires confirming again", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { revenue: "DOUBLE" }, confirmed_at: "2026-11-15T10:00:00Z", current: true });
  vi.mocked(analystApi.forgetTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: null, current: false });
  vi.mocked(analystApi.profile).mockResolvedValue({ table: "data", rows: 3, policy: "Preserve raw data.",
    columns: [{ name: "revenue", storage_type: "VARCHAR", missing: 0, suggested_type: "DOUBLE", conversions: { DOUBLE: { valid: 3, failed: 0 }, BIGINT: { valid: 2, failed: 1 } } }] });
  mount();
  await screen.findByText(/Using the column types you confirmed/);
  await userEvent.click(screen.getByText("Check column types"));
  await userEvent.selectOptions(screen.getByLabelText("Analysis type for revenue"), "BIGINT");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await userEvent.type(screen.getByLabelText("Your question"), "Total revenue");
  expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
  expect(screen.getByText("Confirm column types to continue.")).toBeInTheDocument();
  expect(analystApi.ask).not.toHaveBeenCalled();
});

it("does not apply remembered types after the dataset's columns changed, and says so", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: "2026-11-15T10:00:00Z", current: false });
  mount();
  expect(await screen.findByText("Your columns changed since you last confirmed types. Please check them again.")).toBeInTheDocument();
  await userEvent.click(screen.getByText("Check column types"));
  expect(screen.getByLabelText("Analysis type for revenue")).toHaveValue("VARCHAR");
});

it("still loads the page if the remembered-types request fails", async () => {
  vi.mocked(analystApi.confirmedTypes).mockRejectedValue(new Error("offline"));
  mount();
  expect(await screen.findByText("Check column types")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

// Stage 3 (D8): plain labels, same stored values; first visit asks for confirmation.
it("shows plain type names but sends exactly the same type values as before", async () => {
  vi.mocked(analystApi.ask).mockResolvedValue(completed);
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ type_mapping: null, confirmed_at: null, current: false } as never);
  vi.mocked(analystApi.confirmTypes).mockResolvedValue({ confirmed_at: "2026-01-02T10:00:00Z" } as never);
  mount();
  const select = (await screen.findByLabelText("Analysis type for revenue")) as HTMLSelectElement;
  const options = Array.from(select.options).map((o) => [o.value, o.textContent]);
  expect(options).toEqual([
    ["VARCHAR", "Text"], ["BIGINT", "Whole number"], ["DOUBLE", "Decimal number"],
    ["DATE", "Date"], ["TIMESTAMP", "Date and time"], ["BOOLEAN", "Yes / No"],
  ]);
  await userEvent.selectOptions(select, "Decimal number");
  expect(select.value).toBe("DOUBLE");
  await userEvent.click(screen.getByRole("checkbox"));
  expect(analystApi.confirmTypes).toHaveBeenCalledWith("dataset-1", { revenue: "DOUBLE" });
  await userEvent.type(screen.getByLabelText("Your question"), "Total revenue");
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  await waitFor(() => expect(analystApi.ask).toHaveBeenCalledWith("dataset-1", "Total revenue", { revenue: "DOUBLE" }, expect.anything()));
});

it("first visit: the type check is open and Analyze stays blocked until the owner confirms", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ type_mapping: null, confirmed_at: null, current: false } as never);
  mount();
  const summary = await screen.findByText("Check column types");
  expect(summary.closest("details")).toHaveProperty("open", true);
  await userEvent.click(screen.getByRole("button", { name: "Use suggested types" }));
  await userEvent.type(screen.getByLabelText("Your question"), "Total revenue");
  expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
  expect(screen.getByText("Confirm column types to continue.")).toBeInTheDocument();
  expect(analystApi.ask).not.toHaveBeenCalled();
});

it("puts the question box first, then moves the follow-up box below the answer, and names the dataset in the placeholder", async () => {
  vi.mocked(analystApi.ask).mockResolvedValue(completed);
  mount();
  const box = await screen.findByLabelText("Your question");
  expect(box).toHaveAttribute("placeholder", "Ask a question about orders.csv");
  const types = document.querySelector("details.type-settings")!;
  expect(box.compareDocumentPosition(types) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();      // the question box comes before the column-type check
  await looksRight();
  await userEvent.type(box, "What is revenue?");
  await userEvent.click(screen.getByRole("button", { name: "Analyze" }));
  const answer = await screen.findByRole("heading", { name: "Your total is 30.5." });
  expect(box.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();      // chat style: the follow-up box sits below the answer
  expect(screen.getByLabelText("Your question")).toBe(box);                                       // and it is the same box (what was typed is never lost)
});

// Stage 3 final round: Analyze needs an explicit confirmation even when every column is Text.
const gate = () => screen.getByRole("button", { name: "Analyze" });
it("all-Text dataset, nothing remembered: Analyze is blocked until the owner confirms with one click", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: null, current: false });
  vi.mocked(analystApi.confirmTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { revenue: "VARCHAR" }, confirmed_at: "2026-11-16T09:00:00Z", current: true });
  vi.mocked(analystApi.ask).mockResolvedValue(completed);
  mount();
  await userEvent.type(await screen.findByLabelText("Your question"), "Count records");
  expect(gate()).toBeDisabled(); // blocked before confirm, although every column is Text
  expect(screen.getByText("Confirm column types to continue.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Analyze" })); // disabled: nothing happens
  expect(analystApi.ask).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "These types look right" }));
  await waitFor(() => expect(gate()).toBeEnabled()); // enabled after the explicit click
  expect(analystApi.confirmTypes).toHaveBeenCalledWith(data.id, { revenue: "VARCHAR" }); // remembered, nothing else changed
  expect(screen.queryByRole("button", { name: "These types look right" })).not.toBeInTheDocument();
  await userEvent.click(gate());
  // The types sent with the question are exactly what they were before this change (untouched mapping).
  await waitFor(() => expect(analystApi.ask).toHaveBeenCalledWith(data.id, "Count records", {}, expect.objectContaining({ thread_id: expect.any(String) })));
});

it("a remembered confirmation skips the gate: no button, Analyze enabled, remembered types sent unchanged", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { revenue: "DOUBLE" }, confirmed_at: "2026-11-15T10:00:00Z", current: true });
  vi.mocked(analystApi.ask).mockResolvedValue(completed);
  mount();
  await screen.findByText(/Using the column types you confirmed/);
  await userEvent.type(screen.getByLabelText("Your question"), "Total revenue");
  expect(screen.queryByRole("button", { name: "These types look right" })).not.toBeInTheDocument();
  expect(gate()).toBeEnabled();
  await userEvent.click(gate());
  await waitFor(() => expect(analystApi.ask).toHaveBeenCalledWith(data.id, "Total revenue", { revenue: "DOUBLE" }, expect.anything()));
  expect(analystApi.confirmTypes).not.toHaveBeenCalled(); // nothing is re-saved
});

it("changing a type after confirming blocks Analyze again until re-confirmed", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { revenue: "DOUBLE" }, confirmed_at: "2026-11-15T10:00:00Z", current: true });
  mount();
  await screen.findByText(/Using the column types you confirmed/);
  await userEvent.type(screen.getByLabelText("Your question"), "Total revenue");
  await userEvent.click(screen.getByText("Check column types"));
  await userEvent.selectOptions(screen.getByLabelText("Analysis type for revenue"), "VARCHAR");
  expect(gate()).toBeDisabled();
  expect(screen.getByRole("button", { name: "These types look right" })).toBeInTheDocument();
});

it("pressing Enter sends the question once types are confirmed; Shift+Enter adds a line; Enter before confirming does nothing", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: null, current: false });
  vi.mocked(analystApi.confirmTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { revenue: "VARCHAR" }, confirmed_at: "2026-11-16T09:00:00Z", current: true });
  vi.mocked(analystApi.ask).mockResolvedValue(completed);
  mount();
  const box = await screen.findByLabelText("Your question");
  await userEvent.type(box, "Count records{Enter}");
  expect(analystApi.ask).not.toHaveBeenCalled(); // not confirmed yet: same gate as the button
  await userEvent.click(screen.getByRole("button", { name: "These types look right" }));
  await waitFor(() => expect(gate()).toBeEnabled());
  await userEvent.type(box, "{Shift>}{Enter}{/Shift}more");
  expect(analystApi.ask).not.toHaveBeenCalled();
  expect((box as HTMLTextAreaElement).value).toBe("Count records\nmore");
  await userEvent.type(box, "{Enter}");
  await waitFor(() => expect(analystApi.ask).toHaveBeenCalledTimes(1));
  expect(analystApi.ask).toHaveBeenCalledWith("dataset-1", "Count records\nmore", {}, expect.anything());
});

it("an older question with no saved values can be run again on current data without the AI", async () => {
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { revenue: "DOUBLE" }, confirmed_at: "2026-11-15T10:00:00Z", current: true });
  vi.mocked(analystApi.history).mockResolvedValue([{ ...completed, results_available: false }]);
  vi.mocked(analystApi.rerun).mockResolvedValue({ ...completed, id: "run-2", results_available: true });
  vi.mocked(analystApi.run).mockResolvedValue({ ...completed, id: "run-2" });
  mount();
  await userEvent.click(screen.getByText("Recent questions"));
  await userEvent.click(await screen.findByRole("button", { name: /What is revenue/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Run again on current data" }));
  expect(analystApi.rerun).toHaveBeenCalledWith("run-1");
  expect(analystApi.ask).not.toHaveBeenCalled(); // no AI call
  expect(await screen.findByRole("heading", { name: "Your total is 30.5." })).toBeInTheDocument();
});

const unitProfile = () => vi.mocked(analystApi.profile).mockResolvedValue({ table: "data", rows: 3, policy: "Preserve raw data.",
  columns: [
    { name: "sales", storage_type: "VARCHAR", missing: 0, suggested_type: "BIGINT", conversions: { DOUBLE: { valid: 3, failed: 0 }, BIGINT: { valid: 3, failed: 0 }, DATE: { valid: 0, failed: 3 }, TIMESTAMP: { valid: 0, failed: 3 }, BOOLEAN: { valid: 0, failed: 3 } } },
    { name: "discount_pct", storage_type: "VARCHAR", missing: 0, suggested_type: "DOUBLE", conversions: { DOUBLE: { valid: 3, failed: 0 }, BIGINT: { valid: 0, failed: 3 }, DATE: { valid: 0, failed: 3 }, TIMESTAMP: { valid: 0, failed: 3 }, BOOLEAN: { valid: 0, failed: 3 } } },
  ] } as never);
const blankSettings = { description: "", columns: {}, metrics: [], monetary_columns: {}, percent_columns: [], units_confirmed: false };

it("number columns are only SUGGESTED as money or a percentage from their names; nothing is saved until the owner confirms", async () => {
  unitProfile();
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: null, current: false });
  vi.mocked(insightApi.knowledge).mockResolvedValue({ settings: blankSettings, columns: ["sales", "discount_pct"] } as never);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Use suggested types" }));
  expect(await screen.findByLabelText("What sales is")).toHaveValue("money");   // a count named "sales" is only suggested as money
  expect(screen.getByLabelText("What discount_pct is")).toHaveValue("percent");
  expect(screen.getAllByText("Suggested")).toHaveLength(2);
  expect(insightApi.saveKnowledge).not.toHaveBeenCalled();                      // a suggestion is not a confirmation
});

it("'These types look right' confirms the types and the number choices in one click; the offered currency is the Settings one", async () => {
  localStorage.setItem("insightiq-default-currency-v1", "EUR");
  unitProfile();
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: null, current: false });
  vi.mocked(analystApi.confirmTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: {}, confirmed_at: "2026-11-20T09:00:00Z", current: true });
  vi.mocked(insightApi.knowledge).mockResolvedValue({ settings: blankSettings, columns: ["sales", "discount_pct"] } as never);
  vi.mocked(insightApi.saveKnowledge).mockImplementation(async (_id, settings) => ({ settings } as never));
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Use suggested types" }));
  await userEvent.selectOptions(await screen.findByLabelText("What sales is"), "neither"); // the owner says it is a count
  await userEvent.click(screen.getByRole("button", { name: "These types look right" }));
  await waitFor(() => expect(insightApi.saveKnowledge).toHaveBeenCalled());
  const saved = vi.mocked(insightApi.saveKnowledge).mock.calls[0][1];
  expect(saved.monetary_columns).toEqual({});                    // "sales" is NOT money: the owner said so
  expect(saved.percent_columns).toEqual(["discount_pct"]);
  expect(saved.units_confirmed).toBe(true);
  expect(screen.getByLabelText("What sales is").querySelector("option[value=money]")?.textContent).toBe("Money (EUR)");
  localStorage.removeItem("insightiq-default-currency-v1");
});

it("confirming money uses the offered currency on the existing monetary_columns path", async () => {
  unitProfile();
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: null, current: false });
  vi.mocked(analystApi.confirmTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: {}, confirmed_at: "2026-11-20T09:00:00Z", current: true });
  vi.mocked(insightApi.knowledge).mockResolvedValue({ settings: blankSettings, columns: ["sales", "discount_pct"] } as never);
  vi.mocked(insightApi.saveKnowledge).mockImplementation(async (_id, settings) => ({ settings } as never));
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Use suggested types" }));
  await userEvent.click(await screen.findByRole("button", { name: "These types look right" }));
  await waitFor(() => expect(insightApi.saveKnowledge).toHaveBeenCalled());
  expect(vi.mocked(insightApi.saveKnowledge).mock.calls[0][1].monetary_columns).toEqual({ sales: { currency: "USD", mixed: false } });
});

it("settings that arrive late never overwrite a choice the owner already made", async () => {
  unitProfile();
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: null, confirmed_at: null, current: false });
  let release: (v: unknown) => void = () => undefined;
  vi.mocked(insightApi.knowledge).mockReturnValue(new Promise((resolve) => { release = resolve; }) as never);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Use suggested types" }));
  await userEvent.selectOptions(await screen.findByLabelText("What sales is"), "percent");   // the owner picks before the settings arrive
  release({ settings: blankSettings, columns: ["sales", "discount_pct"] });                  // the name hint would say "money"
  await waitFor(() => expect(screen.getByLabelText("What discount_pct is")).toHaveValue("percent")); // the other column got its suggestion...
  expect(screen.getByLabelText("What sales is")).toHaveValue("percent");                      // ...the owner's choice stayed
});

const reopened = (mapping: Record<string, string>) => ({ ...completed, type_mapping: mapping });
function mountReopened() {
  return render(<Analyst datasets={[data]} initialDataset={data.id} initialRunId="run-1" onWorkspace={vi.fn()} />);
}

it("reopening a saved question keeps the confirmation when it used exactly the types the owner confirmed", async () => {
  unitProfile();
  vi.mocked(analystApi.run).mockResolvedValue(reopened({ sales: "BIGINT", discount_pct: "DOUBLE" }) as never);
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { sales: "BIGINT", discount_pct: "DOUBLE" }, confirmed_at: "2026-11-20T09:00:00Z", current: true });
  mountReopened();
  await userEvent.type(await screen.findByLabelText("Your question"), "And last month?");
  await waitFor(() => expect(gate()).toBeEnabled());                        // no second confirmation needed
  expect(screen.queryByText("Confirm column types to continue.")).not.toBeInTheDocument();
});

it("reopening a saved question never enables Analyze for types the owner did not confirm", async () => {
  unitProfile();
  vi.mocked(analystApi.run).mockResolvedValue(reopened({ sales: "BIGINT", discount_pct: "VARCHAR" }) as never);
  vi.mocked(analystApi.confirmedTypes).mockResolvedValue({ dataset_id: data.id, type_mapping: { sales: "BIGINT", discount_pct: "DOUBLE" }, confirmed_at: "2026-11-20T09:00:00Z", current: true });
  mountReopened();
  await userEvent.type(await screen.findByLabelText("Your question"), "And last month?");
  const select = (await screen.findByLabelText("Analysis type for discount_pct")) as HTMLSelectElement;
  await waitFor(() => expect(analystApi.confirmedTypes).toHaveBeenCalled());
  // Either the gate stays shut (types differ from what was confirmed) or the screen shows exactly the confirmed types.
  if (!(gate() as HTMLButtonElement).disabled) expect(select.value).toBe("DOUBLE");
});
