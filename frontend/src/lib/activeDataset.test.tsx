import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ACTIVE_KEY,
  ActiveDatasetProvider,
  readLocal,
  restoreDataset,
  selectorDatasets,
  useActiveDataset,
  useDatasetGuard,
} from "./activeDataset";
import { api, type Dataset } from "../api";
import ActiveDatasetSelector from "../components/ActiveDatasetSelector";
const a: Dataset = {
  id: "a",
  name: "orders.csv",
  display_name: "Quarterly orders for the international retail division.csv",
  rows: 12,
  bytes: 20,
  created_at: "2026-01-01",
  columns: [{ name: "x", type: "VARCHAR", null_count: 0 }],
};
const b = {
  ...a,
  id: "b",
  name: "new.csv",
  display_name: null,
  created_at: "2026-02-01",
};
const sample = {
  ...a,
  id: "sample",
  name: "synthetic.csv",
  display_name: null,
  is_sample: true,
};
const archived = { ...b, id: "archived", archived_at: "2026-03-01" };
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, "list").mockResolvedValue([a, b, sample, archived]);
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => [],
  } as Response);
});
it("restores an available active ID", () =>
  expect(restoreDataset([a, b], { id: "a", mru: ["b"] }).id).toBe("a"));
it("uses the most recently used available dataset when the saved dataset was deleted", () =>
  expect(restoreDataset([a, b], { id: "deleted", mru: ["a", "b"] })).toEqual({
    id: "a",
    unavailable: true,
  }));
it("excludes archived datasets from restore and falls back to recency", () =>
  expect(
    restoreDataset([a, b, archived], { id: "archived", mru: ["archived"] }),
  ).toEqual({ id: "b", unavailable: true }));
it.each([
  null,
  4,
  "broken",
  [],
  { id: 3, mru: {} },
  { id: "missing", mru: [1, null, "gone"] },
])("never crashes on malformed saved preferences: %j", (saved) =>
  expect(() => restoreDataset([], saved)).not.toThrow(),
);
it("handles invalid JSON and denied browser storage", () => {
  localStorage.setItem(ACTIVE_KEY, "{broken");
  expect(readLocal(ACTIVE_KEY)).toBeNull();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw Error("denied");
  });
  expect(readLocal(ACTIVE_KEY)).toBeNull();
  expect(() =>
    render(
      <ActiveDatasetProvider>
        <ActiveDatasetSelector />
      </ActiveDatasetProvider>,
    ),
  ).not.toThrow();
});
it("hides samples while retaining the active sample and excluding archived datasets", () => {
  expect(
    selectorDatasets([a, b, sample, archived], "sample", true).map((d) => d.id),
  ).toEqual(["a", "b", "sample"]);
  expect(
    selectorDatasets([a, b, sample, archived], "a", true).map((d) => d.id),
  ).toEqual(["a", "b"]);
});
it("searches display and original names", () => {
  expect(selectorDatasets([a, b], "a", false, "international")).toEqual([a]);
  expect(selectorDatasets([a, b], "a", false, "orders.csv")).toEqual([a]);
});
it("renders a searchable selector with metadata, tooltip, keyboard selection and persisted active ID", async () => {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: "a" }));
  render(
    <ActiveDatasetProvider>
      <ActiveDatasetSelector />
    </ActiveDatasetProvider>,
  );
  const trigger = await screen.findByRole("button", { name: /^Active dataset/ });
  await waitFor(() => expect(trigger).toHaveAttribute("title", a.display_name));
  expect(trigger).toHaveTextContent("12 rows · 1 columns");
  await userEvent.click(trigger);
  expect(screen.getByRole("textbox")).toHaveFocus();
  await userEvent.type(screen.getByRole("textbox"), "new.csv");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await waitFor(() => expect(trigger).toHaveAttribute("title", "new.csv"));
  expect((readLocal(ACTIVE_KEY) as { id: string }).id).toBe("b");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
});
function Probe() {
  const c = useActiveDataset()!;
  useDatasetGuard("test", () => ({
    title: "Unsaved configuration",
    message: "Review it first",
  }));
  return (
    <>
      <output>{c.activeId}</output>
      <button onClick={() => void c.select("b")}>Change dataset</button>
    </>
  );
}
it("guards selection, preserves source on Cancel and changes it only after approval", async () => {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: "a" }));
  render(
    <ActiveDatasetProvider>
      <Probe />
    </ActiveDatasetProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("a"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Change dataset" }));
  await screen.findByRole("dialog");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("status")).toHaveTextContent("a");
  await userEvent.click(screen.getByRole("button", { name: "Change dataset" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Reset and switch" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("b"),
  );
});
it("notifies and recovers from a stale stored ID without mutating the catalog", async () => {
  localStorage.setItem(
    ACTIVE_KEY,
    JSON.stringify({ id: "deleted", mru: ["a"] }),
  );
  function Notice() {
    const c = useActiveDataset()!;
    return (
      <p>
        {c.notice} {c.activeId}
      </p>
    );
  }
  render(
    <ActiveDatasetProvider>
      <Notice />
    </ActiveDatasetProvider>,
  );
  expect(
    await screen.findByText("Your previous dataset is no longer available a"),
  ).toBeInTheDocument();
  expect(api.list).toHaveBeenCalledWith(true);
});
