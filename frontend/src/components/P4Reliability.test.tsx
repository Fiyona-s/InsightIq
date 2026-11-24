import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";
import { useStillWorking } from "../lib/stillWorking";

/** PRODUCT-POLISH P4: a crashing page shows plain words and a way back; slow work says it is still working. */
afterEach(() => vi.useRealTimers());

it("a page that crashes shows a plain message and Try again, and the rest of the app is untouched", async () => {
  let crash = true;
  function Page() { if (crash) throw new Error("boom"); return <p>Recovered page</p>; }
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<div><p>Rail stays</p><ErrorBoundary><Page /></ErrorBoundary></div>);
  expect(screen.getByRole("alert")).toHaveTextContent("This page ran into a problem");
  expect(screen.getByRole("alert")).toHaveTextContent("Your data and saved work are not affected");
  expect(screen.getByText("Rail stays")).toBeVisible();
  crash = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("Recovered page")).toBeVisible();
});

it("says it is still working only after the wait, and stops when the work ends", () => {
  vi.useFakeTimers();
  function Probe({ busy }: { busy: boolean }) { return <p>{useStillWorking(busy, 6000) ? "still" : "fresh"}</p>; }
  const { rerender } = render(<Probe busy />);
  expect(screen.getByText("fresh")).toBeVisible();
  act(() => { vi.advanceTimersByTime(5900); });
  expect(screen.getByText("fresh")).toBeVisible();
  act(() => { vi.advanceTimersByTime(200); });
  expect(screen.getByText("still")).toBeVisible();
  rerender(<Probe busy={false} />);
  expect(screen.getByText("fresh")).toBeVisible();
});
