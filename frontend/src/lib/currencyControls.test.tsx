import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { CurrencyControls, displayMoney, useCurrency } from "./currency";
import ResultChart from "../components/ResultChart";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
const columns = [
  { name: "revenue", type: "DOUBLE", money: { currency: "INR" } },
  { name: "orders", type: "BIGINT" },
];
function Harness() {
  const state = useCurrency("component-test");
  return (
    <>
      <CurrencyControls id="component-test" columns={columns} />
      <span data-testid="amount">
        {displayMoney("1250000", columns[0].money, state)}
      </span>
      <ResultChart
        displayId="component-test"
        data={{
          money: { currency: "INR" },
          spec: {
            kind: "kpi",
            x: null,
            y: 0,
            title: "Revenue",
            null_policy: "omit_with_count",
            zero_baseline: true,
          },
          points: [{ row: 0, value: "1250000" }],
          note: "",
          omitted_rows: 0,
        }}
      />
    </>
  );
}
it("keeps tables and KPI in sync, switches from originals, resets and reports provider failures", async () => {
  let fail = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/status"))
        return new Response(JSON.stringify({ enabled: true, reason: null }));
      if (fail)
        return new Response(
          JSON.stringify({
            detail: "Provider unavailable; original retained.",
          }),
          { status: 503 },
        );
      const body = JSON.parse(options!.body as string);
      return new Response(
        JSON.stringify({
          source_currency: "INR",
          target_currency: body.target_currency,
          rate: body.target_currency === "USD" ? "0.0125" : "0.01",
          rate_source: "Synthetic test provider",
          effective_date: "2026-01-01",
          fetched_at: "2026-01-01T00:00:00Z",
          historical: false,
        }),
      );
    }),
  );
  render(<Harness />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Convert Currency" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Convert Currency" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply conversion" }));
  await waitFor(() =>
    expect(screen.getByTestId("amount")).toHaveTextContent("$15,625.00"),
  );
  expect(document.querySelector(".result-kpi strong")).toHaveTextContent(
    "$15,625.00",
  );
  fireEvent.change(screen.getByLabelText("Target currency"), {
    target: { value: "EUR" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply conversion" }));
  await waitFor(() =>
    expect(screen.getByTestId("amount")).toHaveTextContent("€12,500.00"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Reset to Original Currency" }),
  );
  expect(screen.getByTestId("amount")).toHaveTextContent("₹12,50,000.00");
  fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Apply conversion" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Provider unavailable",
  );
  expect(screen.getByTestId("amount")).toHaveTextContent("₹12,50,000.00");
});
it("hides controls for counts and requests confirmation for unknown source", () => {
  const { rerender } = render(
    <CurrencyControls
      id="counts-test"
      columns={[{ name: "orders", type: "BIGINT" }]}
    />,
  );
  expect(screen.queryByRole("button", { name: "Convert Currency" })).toBeNull();
  rerender(
    <CurrencyControls
      id="unknown-test"
      columns={[{ name: "revenue", type: "DOUBLE", money: { currency: null } }]}
    />,
  );
  expect(screen.getByText(/Confirm source currency/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Convert Currency" })).toBeNull();
});

it("presents readable numeric KPIs while retaining the original value", () => {
  const original = {
    spec: {
      kind: "kpi" as const,
      x: null,
      y: 0,
      title: "Measured total",
      null_policy: "omit_with_count" as const,
      zero_baseline: true as const,
    },
    points: [{ row: 0, value: "8379680.760000008" }],
    note: "",
    omitted_rows: 0,
  };
  render(<ResultChart data={original} />);
  expect(document.querySelector(".result-kpi strong")).toHaveTextContent(
    "8,379,680.76",
  );
  expect(document.querySelector(".result-kpi strong")).toHaveAttribute(
    "title",
    "Original value: 8379680.760000008",
  );
  expect(original.points[0].value).toBe("8379680.760000008");
});

it("keeps the INR display and disables conversion during a provider outage", async () => {
  let unavailable = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/status"))
        return new Response(
          JSON.stringify({
            enabled: !unavailable,
            configured: true,
            reason: unavailable
              ? "Rate service temporarily unavailable. Original amounts retained; retry shortly."
              : null,
          }),
        );
      unavailable = true;
      return new Response(
        JSON.stringify({
          detail: "Exchange rate unavailable. Original values retained.",
        }),
        { status: 503 },
      );
    }),
  );
  render(
    <>
      <CurrencyControls id="outage-audit" columns={columns} />
      <ResultChart
        displayId="outage-audit"
        data={{
          money: { currency: "INR" },
          spec: {
            kind: "kpi",
            x: null,
            y: 0,
            title: "total_recognized_revenue_inr",
            null_policy: "omit_with_count",
            zero_baseline: true,
          },
          points: [{ row: 0, value: "8379680.760000008" }],
          note: "",
          omitted_rows: 0,
        }}
      />
    </>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Convert Currency" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Convert Currency" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply conversion" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Exchange rate unavailable",
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Convert Currency" }),
    ).toBeDisabled(),
  );
  expect(
    screen.getByRole("button", { name: "Apply conversion" }),
  ).toBeDisabled();
  expect(document.querySelector(".result-kpi strong")).toHaveTextContent(
    "₹83,79,680.76",
  );
  expect(document.querySelector(".result-kpi")).toHaveTextContent(
    "Recognized Revenue",
  );
});
