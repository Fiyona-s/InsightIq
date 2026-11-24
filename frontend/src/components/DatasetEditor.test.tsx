import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import DatasetEditor from "./DatasetEditor";
import type { DatasetEditBatch } from "../datasetEditorApi";

// Explicit unit fixtures; browser/integration tests exercise real persistence.
function setup({ count = 2, confirmed = true } = {}) {
  let rows = Array.from({ length: count }, (_, i) => ({
    id: `stable-${i + 1}`,
    values: [
      String(i + 1).padStart(3, "0"),
      i ? `${i + 1}.00` : "1240.50",
      "2026-01-01",
    ] as (string | null)[],
  }));
  let version = 1;
  let mapping = confirmed
    ? { account: "VARCHAR", revenue: "DOUBLE", day: "DATE" }
    : {};
  let failure = "";
  const batches: DatasetEditBatch[] = [];
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, options) => {
      const url = new URL(String(input), "http://localhost");
      let status = 200,
        data: unknown;
      if (url.pathname.endsWith("/edits")) {
        const batch = JSON.parse(String(options?.body)) as DatasetEditBatch;
        batches.push(batch);
        if (failure) {
          status = 422;
          data = { detail: failure };
        } else {
          rows = rows.map((r) => ({
            ...r,
            values: ["account", "revenue", "day"].map((name, i) => {
              const update =
                batch.updates.find((u) => u.id === r.id)?.values || {};
              return name in update ? update[name] : r.values[i];
            }),
          }));
          version++;
          mapping = batch.type_mapping;
          data = {
            version,
            saved_at: "2026-11-07T00:00:00Z",
            type_mapping: mapping,
          };
        }
      } else if (url.pathname.endsWith("/profile")) {
        data = {
          columns: [
            { name: "account", suggested_type: "VARCHAR" },
            { name: "revenue", suggested_type: "DOUBLE" },
            { name: "day", suggested_type: "DATE" },
          ],
        };
      } else if (url.pathname.endsWith("/rows")) {
        const sort = ["account", "revenue", "day"].indexOf(
          url.searchParams.get("sort") || "",
        );
        const sorted =
          sort < 0
            ? rows
            : [...rows].sort((a, b) =>
                String(a.values[sort]).localeCompare(String(b.values[sort])),
              );
        const offset = Number(url.searchParams.get("offset"));
        data = {
          columns: ["account", "revenue", "day"],
          rows: sorted.slice(offset, offset + 25),
          total: rows.length,
          version,
          saved_at: null,
          type_mapping: mapping,
        };
      } else throw new Error("Unexpected unit request: " + url.pathname);
      return { ok: status < 400, status, json: async () => data } as Response;
    });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const onSaved = vi.fn(),
    onDirty = vi.fn();
  const dataset = {
    id: "unit-fixture",
    name: "UNIT-FIXTURE.csv",
    rows: count,
    bytes: 100,
    created_at: "",
    columns: [],
  };
  render(
    <DatasetEditor dataset={dataset} onSaved={onSaved} onDirty={onDirty} />,
  );
  return {
    user: userEvent.setup(),
    batches,
    fetcher,
    onSaved,
    onDirty,
    fail: (message: string) => {
      failure = message;
    },
    rows: () => rows,
  };
}
async function open(
  user: ReturnType<typeof userEvent.setup>,
  value: string,
  label: string,
) {
  await user.click(await screen.findByRole("button", { name: value }));
  const field = await screen.findByRole("textbox", {
    name: label,
  });
  await waitFor(() => expect(field).toBeEnabled());
  return field;
}
async function replace(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  value: string,
) {
  await user.clear(field);
  await user.type(field, value);
  await user.keyboard("{Enter}");
}
afterEach(() => vi.restoreAllMocks());

it("clicks an existing preview cell, saves only its UUID update, refreshes version/profile and preserves leading zeros", async () => {
  const { user, batches, rows, onSaved, fetcher } = setup({ confirmed: false });
  expect(await screen.findByRole("cell", { name: "001" })).toBeVisible();
  expect(
    screen.queryByRole("textbox", { name: "Row 1, revenue" }),
  ).not.toBeInTheDocument();
  const field = await open(user, "1240.50", "Row 1, revenue");
  await replace(user, field, "1500.00");
  expect(screen.getByText("1 unsaved change")).toBeVisible();
  expect(screen.getByText("Original: 1240.50")).toBeVisible();
  expect(screen.getByText("Edited: 1500.00")).toBeVisible();
  expect(document.querySelectorAll("td[data-modified]")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Type for revenue"), "DOUBLE");
  await user.click(screen.getByRole("button", { name: "Confirm types" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved · Version 2");
  expect(batches[0].updates).toEqual([
    { id: "stable-1", values: { revenue: "1500.00" } },
  ]);
  expect(batches[0].additions).toEqual([]);
  expect(batches[0].deletions).toEqual([]);
  expect(rows()).toHaveLength(2);
  expect(rows()[0].values).toEqual(["001", "1500.00", "2026-01-01"]);
  expect(document.querySelectorAll("td[data-modified]")).toHaveLength(0);
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith("/profile")),
  ).toHaveLength(2);
});

it("commits multiple cell edits with Tab/Enter, counts cells and undoes one complete edit", async () => {
  const { user } = setup();
  const field = await open(user, "001", "Row 1, account");
  await user.clear(field);
  await user.type(field, "009");
  await user.keyboard("{Tab}");
  const revenue = screen.getByRole("textbox", { name: "Row 1, revenue" });
  expect(revenue).toHaveFocus();
  await replace(user, revenue, "1500.00");
  expect(screen.getByText("2 unsaved changes")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByText("1 unsaved change")).toBeVisible();
  expect(screen.getByRole("button", { name: "1240.50" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByText("No unsaved changes")).toBeVisible();
  expect(screen.getByRole("button", { name: "001" })).toBeVisible();
});

it("Escape cancels the active buffer and editing back to the original removes the net change", async () => {
  const { user, onDirty, batches } = setup();
  let field = await open(user, "1240.50", "Row 1, revenue");
  await user.type(field, "999");
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
  await user.keyboard("{Escape}");
  expect(screen.getByText("No unsaved changes")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "1240.50" })).toHaveFocus(),
  );
  field = await open(user, "1240.50", "Row 1, revenue");
  await replace(user, field, "1500.00");
  field = await open(user, "1500.00", "Row 1, revenue");
  await replace(user, field, "1240.50");
  expect(screen.getByText("No unsaved changes")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  expect(batches).toHaveLength(0);
});

it("keeps invalid values after rejected saves, then saves a corrected value without adding rows", async () => {
  const { user, fail, batches } = setup();
  fail(
    "revenue: 'bad' is invalid for confirmed type DOUBLE. Use NULL for a missing value.",
  );
  await replace(user, await open(user, "1240.50", "Row 1, revenue"), "bad");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "invalid for confirmed type DOUBLE",
  );
  expect(screen.getByRole("button", { name: "bad" })).toBeVisible();
  expect(screen.getByText("1 unsaved change")).toBeVisible();
  fail("");
  await replace(user, await open(user, "bad", "Row 1, revenue"), "1500.00");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved · Version 2");
  expect(batches).toHaveLength(2);
  expect(batches[1].additions).toEqual([]);
});

it("retains UUID-targeted edits across pagination and sorting in one batch", async () => {
  const { user, batches } = setup({ count: 30 });
  await replace(user, await open(user, "1240.50", "Row 1, revenue"), "1500.00");
  await user.click(screen.getByRole("button", { name: "Next rows" }));
  const row = await screen.findByRole("cell", { name: "027" });
  const record = row.closest("tr")!;
  await user.click(within(record).getByRole("button", { name: "27.00" }));
  await replace(
    user,
    screen.getByRole("textbox", { name: "Row 27, revenue" }),
    "2700.00",
  );
  await user.selectOptions(
    screen.getByLabelText("Sort editor rows"),
    "revenue",
  );
  await screen.findByRole("cell", { name: "001" });
  expect(screen.getByText("2 unsaved changes")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved · Version 2");
  expect(batches[0].updates).toEqual([
    { id: "stable-1", values: { revenue: "1500.00" } },
    { id: "stable-27", values: { revenue: "2700.00" } },
  ]);
  expect(batches[0].additions).toEqual([]);
});

it("keeps explicit NULL distinct from empty text and commits the last focused input on Save", async () => {
  const { user, batches } = setup();
  await open(user, "1240.50", "Row 1, revenue");
  await user.click(
    screen.getByRole("button", { name: "Set row 1 revenue to NULL" }),
  );
  const field = await open(user, "001", "Row 1, account");
  await user.clear(field);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Saved · Version 2");
  expect(batches[0].updates).toEqual([
    { id: "stable-1", values: { revenue: null, account: "" } },
  ]);
});

it("Cancel discards a pending input and committed edits without making a save request", async () => {
  const { user, batches } = setup();
  const field = await open(user, "1240.50", "Row 1, revenue");
  await user.clear(field);
  await user.type(field, "1500.00");
  await user.click(screen.getByRole("button", { name: "Discard" }));
  await screen.findByRole("switch", { name: "Edit mode" });
  expect(screen.getByRole("cell", { name: "1240.50" })).toBeVisible();
  expect(
    screen.getByText("Saved · Version 1"),
  ).toBeVisible();
  expect(batches).toHaveLength(0);
});

it("commits at Tab boundaries and restores a visible keyboard focus target", async () => {
  const { user } = setup();
  const field = await open(user, "001", "Row 1, account");
  await user.clear(field);
  await user.type(field, "009");
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "009" })).toHaveFocus(),
  );
  const last = document.querySelector(
    'tr[data-row-id="stable-2"]',
  ) as HTMLElement;
  await user.click(within(last).getByRole("button", { name: "2026-01-01" }));
  const date = screen.getByRole("textbox", { name: "Row 2, day" });
  await user.clear(date);
  await user.type(date, "2026-02-03");
  await user.keyboard("{Tab}");
  await waitFor(() =>
    expect(
      within(last).getByRole("button", { name: "2026-02-03" }),
    ).toHaveFocus(),
  );
  expect(screen.getByText("2 unsaved changes")).toBeVisible();
});
