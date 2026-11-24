import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "./App";
vi.mock("./components/AutoMLStudio", () => ({
  default: () => (
    <section data-testid="automl">Local predictive models</section>
  ),
}));
vi.mock("./components/Analyst", () => ({
  default: () => <section data-testid="analyst">Ask InsightIQ interface</section>,
}));
vi.mock("./components/ExecutionTracesPage", () => ({
  default: () => (
    <section data-testid="traces">Recorded run inspection</section>
  ),
}));
vi.mock("./components/DashboardPage", () => ({
  default: () => <section data-testid="dashboards">Dashboard builder</section>,
}));
vi.mock("./components/EvaluationPage", () => ({
  default: () => <section data-testid="evaluation">Evaluation Center</section>,
}));
vi.mock("./components/KnowledgeEditor", () => ({
  default: () => <section data-testid="knowledge">Knowledge editor</section>,
}));
vi.mock("./components/AnalyticsPage", () => ({
  default: () => <section data-testid="analytics">Run Analytics</section>,
  Overview: () => <section data-testid="overview">Overview</section>,
}));
it("maps every sidebar module to its own page, opens on Home and keeps Admin tools hidden until switched on", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => [],
  } as Response);
  window.history.replaceState(null,"","/");localStorage.clear();
  render(<App />);
  // Home is the default page (audit U11).
  expect(await screen.findByTestId("overview")).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  // Owner navigation, in order, with no Admin items.
  expect(Array.from(nav.querySelectorAll(".nav-item")).map(b => b.textContent)).toEqual(
    ["Home", "Ask", "Datasets", "Dashboards", "Predictions", "Business definitions"]);
  for (const hidden of ["Accuracy check", "Performance & errors", "Execution traces"])
    expect(screen.queryByRole("button", { name: hidden })).not.toBeInTheDocument();
  for (const [route, id] of [
    ["Ask", "analyst"],
    ["Business definitions", "knowledge"],
    ["Dashboards", "dashboards"],
    ["Predictions", "automl"],
    ["Home", "overview"],
  ]) {
    await userEvent.click(screen.getByRole("button", { name: route }));
    expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(route);        // the rail marks the page (there is no breadcrumb any more)
  }
  // Admin tools appear only after the explicit, honestly labelled switch.
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  expect(screen.getByText(/not protected by a login/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitemcheckbox", { name: /Show admin tools/ }));
  for (const [route, id] of [
    ["Performance & errors", "analytics"],
    ["Execution traces", "traces"],
    ["Accuracy check", "evaluation"],
  ]) {
    if (!screen.queryByRole("menu")) await userEvent.click(screen.getByRole("button", { name: "Menu" }));       // Admin pages are chosen from the Menu
    await userEvent.click(screen.getByRole("menuitem", { name: route }));
    expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getAllByText(/not protected by a login/i).length).toBeGreaterThan(0);
    if (id === "traces")
      expect(screen.queryByTestId("analyst")).not.toBeInTheDocument();
  }
  await userEvent.click(screen.getByRole("button", { name: "Datasets" }));
  expect(screen.getByRole("heading", { name: "Datasets", level: 1 })).toBeInTheDocument();
});

it("shows an honest notice instead of an Admin page while Admin tools are hidden", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => [] } as Response);
  localStorage.clear();
  window.history.replaceState(null, "", "/#evaluation");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Admin tools are hidden" })).toBeInTheDocument();
  expect(screen.queryByTestId("evaluation")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show admin tools" }));
  expect(screen.getByTestId("evaluation")).toBeInTheDocument();
});

it("keeps every earlier page name working as a bookmark", async () => {
  const { bookmarkedPage } = await import("./lib/navigation");
  for (const [hash, page] of [["#my-data", "Data workspace"], ["#ask-insightiq", "AI Analyst"], ["#build-models", "AutoML Studio"],
    ["#knowledge-base", "Knowledge base"], ["#evaluation-center", "Evaluation center"], ["#run-analytics", "Run analytics"],
    ["#performance-&-errors", "Run analytics"], ["#datasets", "Data workspace"], ["#predictions", "AutoML Studio"], ["#", "Overview"], ["#guide", "Overview"]]) {
    window.history.replaceState(null, "", "/" + hash);
    expect(bookmarkedPage()).toBe(page);
  }
});

it("reaches Settings from the top-bar Menu (it is no longer a sidebar item)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => [] } as Response);
  localStorage.clear();
  window.history.replaceState(null, "", "/#overview");
  render(<App />);
  await screen.findByTestId("overview");
  expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
  expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeInTheDocument();
  expect(window.location.hash).toBe("#settings");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

