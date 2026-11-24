import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
const dataset = {
  id: "abc",
  name: "real.csv",
  rows: 1,
  bytes: 21,
  created_at: "2026-01-01T00:00:00Z",
  columns: [{ name: "account", type: "VARCHAR", null_count: 0 }],
};
function respond(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(data),
  } as Response);
}
beforeEach(() => {vi.restoreAllMocks();localStorage.clear();window.history.replaceState(null,"","/#datasets")});
it("loads the real catalog and preview, and exposes schema", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
    String(input).endsWith("/profile-details")?respond({revision:1,original_filename:dataset.name,rows:1,column_count:1,columns:[{name:"account",inferred_type:"VARCHAR",storage_type:"VARCHAR",missing:0,unique_count:1,samples:["001"],description:"",nullable:false}]}):String(input).includes("/rows?")
      ? respond({
          columns: ["account"],
          rows: [{ id: "stable-001", values: ["001"] }],
          version: 1,
          saved_at: null,
          type_mapping: {},
          offset: 0,
          total: 1,
        })
      : respond([dataset, { ...dataset, id: "dataset-2", name: "second.csv" }]),
  );
  render(<App />);
  expect(await screen.findByText("001")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith("/api/datasets?include_archived=true", undefined);
  await userEvent.click(screen.getByRole("tab", { name: "Columns" }));
  expect(screen.getByText("VARCHAR")).toBeInTheDocument();
  await userEvent.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Preview" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Find a dataset" }),
    "missing",
  );
  expect(screen.getByText("No matching datasets")).toBeInTheDocument();
});
it("uploads an actual multipart file (with progress) and selects the returned dataset", async () => {
  let uploaded=false;
  const sent: unknown[] = [];
  class FakeXhr {       // the upload goes through XMLHttpRequest so the browser can report progress
    upload: { onprogress?: (e: unknown) => void; onload?: () => void } = {};
    onload?: () => void; onerror?: () => void; status = 201; responseText = JSON.stringify(dataset);
    open() {}
    send(body: unknown) { sent.push(body); uploaded = true; this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 }); this.upload.onload?.(); this.onload?.(); }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, options) =>
      options?.method === "POST"
        ? (uploaded=true,respond(dataset, 201))
        : String(input).includes("/rows?")
          ? respond({
              columns: ["account"],
              rows: [{ id: "stable-001", values: ["001"] }],
              version: 1,
              saved_at: null,
              type_mapping: {},
              offset: 0,
              total: 1,
            })
          : respond(uploaded?[dataset]:[]),
    );
  render(<App />);
  await screen.findByRole("region", { name: "CSV import" });
  await userEvent.upload(
    screen.getByLabelText("Upload CSV file"),
    new File(["account\n001\n"], "real.csv", { type: "text/csv" }),
  );
  expect(
    await screen.findByText("real.csv imported successfully."),
  ).toBeInTheDocument();
  expect(await screen.findByText("001")).toBeInTheDocument();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toBeInstanceOf(FormData);
  expect(fetcher.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);      // not a plain fetch: it reports progress
  vi.unstubAllGlobals();
});
it("shows server errors and recovers on refresh", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => respond({ detail: "Catalog unavailable" }, 503));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Catalog unavailable",
  );
  fetcher.mockImplementation(() => respond([]));
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh catalog" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});
it("opens the implemented dashboard empty state", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => respond([]));
  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "Dashboards" }));
  expect(
    await screen.findByRole("heading", {
      name: "Create a dashboard",
    }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "New dashboard" }));
  expect(
    await screen.findByRole("button", { name: "Create dashboard" }),
  ).toBeDisabled();
});
it("renders a header-only dataset as a valid empty result", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
    String(input).includes("/rows?")
      ? respond({
          columns: ["account"],
          rows: [],
          offset: 0,
          total: 0,
          version: 1,
          saved_at: null,
          type_mapping: {},
        })
      : respond([{ ...dataset, rows: 0 }]),
  );
  render(<App />);
  expect(
    await screen.findByText(/No records. This dataset/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("preserves unsaved cell edits while switching between Schema and Data preview", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    if (String(input).includes("/rows?"))
      return respond({
        columns: ["account"],
        rows: [{ id: "stable-001", values: ["001"] }],
        total: 1,
        version: 1,
        saved_at: null,
        type_mapping: {},
      });
    if (String(input).endsWith("/profile"))
      return respond({
        columns: [{ name: "account", suggested_type: "VARCHAR" }],
      });
    return respond([dataset]);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "001" }));
  const field = await screen.findByRole("textbox", { name: "Row 1, account" });
  await waitFor(() => expect(field).toBeEnabled());
  await userEvent.clear(field);
  await userEvent.type(field, "009");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("tab", { name: "Columns" }));
  expect(screen.getByText("1 unsaved change")).not.toBeVisible();
  await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
  expect(screen.getByText("1 unsaved change")).toBeVisible();
  expect(screen.getByRole("button", { name: "009" })).toBeVisible();
  expect(
    fetcher.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});
