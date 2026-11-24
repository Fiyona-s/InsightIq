import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import DatasetQuality from "./DatasetQuality";
import DatasetProfile from "./DatasetProfile";
import DatasetHistory from "./DatasetHistory";
import DatasetEditor from "./DatasetEditor";
import {
  datasetProfileApi,
  type DatasetProfile as Profile,
  type QualitySummary,
  type RevisionHistory,
} from "../datasetProfileApi";
import { datasetEditorApi } from "../datasetEditorApi";
import { lifecycleApi, type Dependencies } from "../datasetLifecycleApi";
import App from "../App";
import { api, type Dataset } from "../api";
const dataset: Dataset = {
  id: "fixture",
  name: "original.csv",
  display_name: "Friendly source",
  rows: 2,
  bytes: 20,
  created_at: "2026-01-01",
  columns: [{ name: "account", type: "VARCHAR", null_count: 0 }],
};
const quality: QualitySummary = {
  revision: 2,
  rows: 2,
  columns: [
    { name: "account", missing: 1, missing_percent: 50, unique_count: 1 },
  ],
  duplicate_rows: 1,
  empty_columns: ["empty"],
  constant_columns: ["account"],
  type_issues: [
    {
      column: "amount",
      expected: "numeric",
      count: 1,
      examples: ["<b>raw text</b>"],
    },
  ],
  type_threshold: 0.8,
  example_limit: 5,
  example_max_chars: 100,
};
const profile: Profile = {
  revision: 2,
  original_filename: "original.csv",
  rows: 2,
  column_count: 1,
  columns: [
    {
      name: "account",
      inferred_type: "VARCHAR",
      storage_type: "VARCHAR",
      missing: 0,
      nullable: false,
      unique_count: 2,
      samples: ["001", "002"],
      description: "Shared definition",
    },
  ],
};
const history: RevisionHistory = {
  current_revision: 3,
  recording_started_at: "2026-11-10T00:00:00Z",
  total: 3,
  snapshot_limit: 20,
  snapshot_bytes: 4096,
  revisions: [
    {
      revision: 3,
      source: "edit_save",
      timestamp: "2026-11-10",
      sha256: "abc",
      size_bytes: 4096,
      row_count: 2,
      status: "available",
      changed_cells: 1,
      restored_from: null,
    },
    {
      revision: 2,
      source: "edit_save",
      timestamp: null,
      sha256: "def",
      size_bytes: 4096,
      row_count: 2,
      status: "pruned",
      changed_cells: null,
      restored_from: null,
    },
    {
      revision: 1,
      source: "import",
      timestamp: null,
      sha256: null,
      size_bytes: null,
      row_count: null,
      status: "unavailable",
      changed_cells: null,
      restored_from: null,
    },
  ],
};
const dependencies = {
  counts: { dashboards: 1, models: 2 },
  delete_blocked: false,
  groups: {dashboards:[{id:"dash",title:"Saved sales dashboard",timestamp:null}],models:[{id:"model-a",title:"Measured model A",timestamp:null},{id:"model-b",title:"Measured model B",timestamp:null}]},
} as unknown as Dependencies;
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/#datasets");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function () {
      this.removeAttribute("open");
    },
  });
  vi.spyOn(datasetProfileApi, "quality").mockResolvedValue(quality);
  vi.spyOn(datasetProfileApi, "profile").mockResolvedValue(profile);
  vi.spyOn(datasetProfileApi, "history").mockResolvedValue(history);
  vi.spyOn(lifecycleApi, "dependencies").mockResolvedValue(dependencies);
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => [],
  } as Response);
});
it("renders deterministic quality counts and bounded examples as plain text in a disclosure", async () => {
  render(<DatasetQuality id={dataset.id} />);
  const card = await screen.findByRole("region", { name: "Data quality" });
  expect(card).toHaveTextContent("1 duplicate rows");
  expect(card).toHaveTextContent("1 missing");
  await userEvent.click(within(card).getByText("Review details"));
  expect(within(card).getByText("50.0%")).toBeVisible();
  expect(within(card).getByText("<b>raw text</b>")).toBeVisible();
  expect(card.querySelector("b")).toBeNull();
  expect(card).toHaveTextContent("5 per issue and 100 characters");
});
it("refreshes quality after revision changes", async () => {
  const r = render(<DatasetQuality id={dataset.id} revision={1} />);
  await screen.findByRole("region", { name: "Data quality" });
  r.rerender(<DatasetQuality id={dataset.id} revision={2} />);
  await waitFor(() =>
    expect(datasetProfileApi.quality).toHaveBeenCalledTimes(2),
  );
});
it("shows the inferred profile without reformatting leading zeros, with descriptions read-only and a way to Business definitions", async () => {
  const edit = vi.fn();
  render(<DatasetProfile dataset={dataset} onEditDescriptions={edit} />);
  expect(await screen.findByText("001")).toBeVisible();
  expect(screen.getByText("original.csv")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Description for account" })).not.toBeInTheDocument();        // P6: descriptions are written in Business definitions
  await userEvent.click(screen.getByRole("button", { name: "Edit descriptions in Business definitions" }));
  expect(edit).toHaveBeenCalledTimes(1);
});
it("offers history actions only for a retained snapshot", async () => {
  render(
    <DatasetHistory dataset={dataset} dirty={false} onRestored={vi.fn()} />,
  );
  expect(await screen.findByText("No snapshot available")).toBeVisible();
  expect(screen.getByText("Snapshot pruned")).toBeVisible();
  expect(
    screen.getAllByRole("button", { name: /Preview revision/ }),
  ).toHaveLength(1);
  expect(
    screen.getAllByRole("button", { name: /Restore revision/ }),
  ).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "Restore revision 1" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", {name:"Restore revision 2"})).not.toBeInTheDocument();
  expect(screen.getByRole("button", {name:"Restore revision 3"})).toBeEnabled();
});
it("renders paginated read-only snapshot preview with exact strings", async () => {
  vi.spyOn(datasetProfileApi, "preview").mockResolvedValue({
    revision: 3,
    columns: ["account"],
    rows: [["001"]],
    total: 30,
    offset: 0,
  });
  render(
    <DatasetHistory dataset={dataset} dirty={false} onRestored={vi.fn()} />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Preview revision 3" }),
  );
  expect(
    await screen.findByRole("region", {
      name: "Read-only preview of revision 3",
    }),
  ).toHaveTextContent("001");
  await userEvent.click(
    screen.getByRole("button", { name: "Next snapshot rows" }),
  );
  expect(datasetProfileApi.preview).toHaveBeenLastCalledWith("fixture", 3, 25);
});
it.each([false, true])(
  "blocks restore when read-only or unsaved: archived=%s",
  async (archived) => {
    render(
      <DatasetHistory
        dataset={archived ? { ...dataset, archived_at: "date" } : dataset}
        dirty={!archived}
        onRestored={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Restore revision 3" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Preview revision 3" }),
    ).toBeEnabled();
  },
);
it("requires confirmation, lists impacts and creates a new revision without changing source history", async () => {
  const done = vi.fn();
  vi.spyOn(datasetProfileApi, "restore").mockResolvedValue({ version: 4 });
  render(<DatasetHistory dataset={dataset} dirty={false} onRestored={done} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Restore revision 3" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Restore revision 3?",
  });
  expect(dialog).toHaveTextContent(
    "Creates revision 4 with the data from revision 3. Earlier revisions are kept.",
  );
  await userEvent.click(await screen.findByText("dashboards: 1"));
  expect(screen.getByText("Saved sales dashboard")).toBeVisible();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create new revision" }),
  );
  expect(datasetProfileApi.restore).toHaveBeenCalledWith(
    "fixture",
    3,
    3,
    false,
  );
  expect(
    await screen.findByText(
      "Revision 4 created from revision 3. Earlier revisions are kept.",
    ),
  ).toBeVisible();
  expect(done).toHaveBeenCalledOnce();
});
it("honors active-job blocks from dependency inspection", async () => {
  vi.mocked(lifecycleApi.dependencies).mockResolvedValue({
    ...dependencies,
    delete_blocked: true,
  });
  render(
    <DatasetHistory dataset={dataset} dirty={false} onRestored={vi.fn()} />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Restore revision 3" }),
  );
  expect(
    await screen.findByText("A job is using this dataset. Restore is blocked."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Create new revision" }),
  ).toBeDisabled();
});
it("keeps hash-verification failures visible and does not report a successful restore", async () => {
  const done = vi.fn();
  vi.spyOn(datasetProfileApi, "restore").mockRejectedValue(
    Error("Snapshot hash verification failed. Nothing was restored."),
  );
  render(<DatasetHistory dataset={dataset} dirty={false} onRestored={done} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Restore revision 3" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Create new revision" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "hash verification failed",
  );
  expect(done).not.toHaveBeenCalled();
});
it("has one edit-mode switch, only shows editing hints while on, and keeps archived cells disabled", async () => {
  vi.spyOn(datasetEditorApi, "rows").mockResolvedValue({
    version: 1,
    saved_at: null,
    type_mapping: {},
    columns: ["account"],
    rows: [{ id: "row", values: ["001"] }],
    total: 1,
  });
  const r = render(
    <DatasetEditor
      dataset={{ ...dataset, archived_at: "date" }}
      onSaved={vi.fn()}
      onDirty={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "001" });
  expect(
    screen.queryByRole("switch", { name: "Edit mode" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "001" })).toBeDisabled();
  expect(screen.queryByText(/Enter applies/)).not.toBeInTheDocument();
  r.unmount();
  render(
    <DatasetEditor dataset={dataset} onSaved={vi.fn()} onDirty={vi.fn()} />,
  );
  const toggle = await screen.findByRole("switch", { name: "Edit mode" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(
    screen.queryByRole("region", { name: "Unsaved dataset changes" }),
  ).not.toBeInTheDocument();
});
it("uses a compact import modal when datasets exist and preserves CSV validation", async () => {
  vi.spyOn(api, "list").mockResolvedValue([dataset]);
  vi.spyOn(datasetEditorApi, "rows").mockResolvedValue({
    version: 1,
    saved_at: null,
    type_mapping: {},
    columns: ["account"],
    rows: [{ id: "row", values: ["001"] }],
    total: 1,
  });
  render(<App />);
  await screen.findByRole("button", { name: "001" });
  expect(
    screen.queryByRole("region", { name: "CSV import" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Import CSV" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Import CSV" });
  expect(dialog).toHaveTextContent("Up to 60 MB");
  expect(dialog).toHaveTextContent("1,000,000");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Close import" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps the large import drop zone in an empty workspace", async () => {
  vi.spyOn(api, "list").mockResolvedValue([]);
  render(<App />);
  expect(
    await screen.findByRole("region", { name: "CSV import" }),
  ).toBeVisible();
  // One empty state only: the drop zone. The old list/preview empty messages are gone.
  expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
  expect(screen.queryByText("No dataset selected")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Select all visible datasets")).not.toBeInTheDocument();
});

it('audit sources keep historical NULL distinct from readable legacy JSON and current local sources',async()=>{vi.mocked(datasetProfileApi.history).mockResolvedValue({...history,audit:[{id:'legacy',action:'dashboard_refresh',timestamp:'2026-01-01',result:'success',actor:null,reason:'{"source":"user_ui"}'},{id:'current',action:'archive',timestamp:'2026-01-02',result:'success',actor:'user_ui',reason:null}]});render(<DatasetHistory dataset={dataset} dirty={false} onRestored={vi.fn()}/>);await userEvent.click(await screen.findByText('Audit sources',{exact:true}));expect(screen.getByText('Source not recorded',{exact:true})).toBeVisible();expect(screen.getByText('{"source":"user_ui"}',{exact:true})).toBeVisible();expect(screen.getByText('user_ui',{exact:true})).toBeVisible();expect(screen.getByText(/Local source labels are not authenticated identities/)).toBeVisible();});
it('retries an unavailable quality summary through the existing read-only endpoint',async()=>{
 vi.mocked(datasetProfileApi.quality).mockRejectedValueOnce(Error('Controlled unavailable profile'));
 render(<DatasetQuality id={dataset.id}/>);await screen.findByText('Quality summary unavailable.');await userEvent.click(screen.getByRole('button',{name:'Retry quality check'}));await screen.findByRole('region',{name:'Data quality'});expect(datasetProfileApi.quality).toHaveBeenCalledTimes(2);
});
