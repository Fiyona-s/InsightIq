import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import ProjectsPage from "./ProjectsPage";
import ProjectSwitcher from "./ProjectSwitcher";
import { ACTIVE_PROJECT_KEY, ProjectProvider, activeProjectId } from "../lib/projects";
import { ACTIVE_KEY, activeKey } from "../lib/activeDataset";
import { ToastProvider } from "./ui/toast";

const projects = [
  { id: "default", name: "Default project", is_default: true, archived_at: null, created_at: null },
  { id: "11111111-1111-1111-1111-111111111111", name: "Main Street shop", is_default: false, archived_at: null, created_at: "2026-11-15T10:00:00Z" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Old kiosk", is_default: false, archived_at: "2026-11-15T11:00:00Z", created_at: "2026-11-14T10:00:00Z" },
];
const respond = (data: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) } as Response);
let calls: { url: string; method: string; body?: string }[] = [];
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); calls = [];
  document.cookie = "insightiq_project=default; path=/";
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input), method = init?.method || "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    if (url.endsWith("/dependencies")) return respond({ project: projects[1], counts: { datasets: 1, dashboards: 2, questions: 3, saved_charts: 0 }, on_delete: "The project is removed. Its datasets, dashboards and history move to the Default project. No data is deleted." });
    if (method === "DELETE") return respond({ deleted: projects[1].id, items_moved_to_default: 3 });
    if (url.endsWith("/archive") || url.endsWith("/restore")) return respond(projects[1]);
    return respond(projects);
  });
});

it("shows the current project in the top bar and switches the whole app to another one", async () => {
  const reload = vi.fn();
  render(<ToastProvider><ProjectProvider reload={reload}><ProjectSwitcher onManage={vi.fn()} /></ProjectProvider></ToastProvider>);
  const trigger = await screen.findByRole("button", { name: /^Project Default project/ });
  await userEvent.click(trigger);
  const items = screen.getAllByRole("menuitemradio");
  expect(items.map((i) => i.textContent)).toEqual(["Default project", "Main Street shop"]); // archived projects are not offered
  expect(items[0]).toHaveAttribute("aria-checked", "true");
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Main Street shop" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(activeProjectId()).toBe(projects[1].id);
  expect(document.cookie).toContain(`insightiq_project=${projects[1].id}`);
});

it("falls back to the Default project when the remembered project is archived", async () => {
  localStorage.setItem(ACTIVE_PROJECT_KEY, projects[2].id);
  const reload = vi.fn();
  render(<ProjectProvider reload={reload}><span>child</span></ProjectProvider>);
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(activeProjectId()).toBe("default");
});

it("remembers the active dataset separately for each project", () => {
  expect(activeKey()).toBe(ACTIVE_KEY);
  localStorage.setItem(ACTIVE_PROJECT_KEY, projects[1].id);
  expect(activeKey()).toBe(`${ACTIVE_KEY}:${projects[1].id}`);
});

it("deletes only after a dependency preview and the exact typed name; Default cannot be archived or deleted", async () => {
  render(<ToastProvider><ProjectProvider reload={vi.fn()}><ProjectsPage /></ProjectProvider></ToastProvider>);
  await screen.findByRole("button", { name: "Actions for Main Street shop" });
  // Rule 7: projects must not be presented as protection.
  expect(screen.getByText(/Projects organise your work; they do not protect it/)).toBeInTheDocument();
  expect(screen.queryByText(/private|secure|protected/i)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Actions for Default project" }));
  expect(screen.queryByRole("menuitem", { name: "Archive" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Restore Old kiosk" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Actions for Main Street shop" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(await screen.findByText("1 dataset")).toBeInTheDocument();
  expect(screen.getByText("2 dashboards")).toBeInTheDocument();
  expect(screen.getByText("3 saved questions")).toBeInTheDocument();
  expect(screen.getByText(/No data is deleted/)).toBeInTheDocument();
  const confirm = screen.getByRole("button", { name: "Delete project" });
  expect(confirm).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/to confirm/), "main street shop");
  expect(confirm).toBeDisabled(); // must match exactly
  await userEvent.clear(screen.getByLabelText(/to confirm/));
  await userEvent.type(screen.getByLabelText(/to confirm/), "Main Street shop");
  await userEvent.click(confirm);
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.body === JSON.stringify({ confirm_name: "Main Street shop" }))).toBe(true));
});

it("archives reversibly from the projects page", async () => {
  render(<ToastProvider><ProjectProvider reload={vi.fn()}><ProjectsPage /></ProjectProvider></ToastProvider>);
  await userEvent.click(await screen.findByRole("button", { name: "Actions for Main Street shop" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith(`/${projects[1].id}/archive`))).toBe(true));
  expect(await screen.findByText(/archived\. Its data is kept/)).toBeInTheDocument();
});
