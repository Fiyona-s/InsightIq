import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import DatasetCurrency from "./DatasetCurrency";
import { insightApi } from "../api";

vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), insightApi: { knowledge: vi.fn() } }));
const info = (settings: object) => ({ settings: { description: "", columns: {}, metrics: [], ...settings }, columns: [] }) as never;
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); });

it("says which columns are money and opens the currency section on the change button", async () => {
  vi.mocked(insightApi.knowledge).mockResolvedValue(info({ monetary_columns: { revenue: { currency: "USD", mixed: false } } }));
  const onChange = vi.fn();
  render(<DatasetCurrency id="d" onChange={onChange} />);
  expect(await screen.findByText(/Money columns: revenue · USD$/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Change currency" }));
  expect(onChange).toHaveBeenCalled();
  expect(sessionStorage.getItem("insightiq-open-currencies")).toBe("1");
});

it("shows a confirmed currency, and offers to set one when none is confirmed", async () => {
  vi.mocked(insightApi.knowledge).mockResolvedValue(info({ monetary_columns: { revenue: { currency: "EUR", mixed: false } }, default_currency_columns: [] }));
  const { unmount } = render(<DatasetCurrency id="d" onChange={vi.fn()} />);
  expect(await screen.findByText(/Money columns: revenue · EUR$/)).toBeInTheDocument();
  unmount();
  vi.mocked(insightApi.knowledge).mockResolvedValue(info({ monetary_columns: {} }));
  render(<DatasetCurrency id="e" onChange={vi.fn()} />);
  expect(await screen.findByText(/No columns are confirmed as money/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set currency" })).toBeInTheDocument();
});
