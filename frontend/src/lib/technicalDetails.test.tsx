import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { TECHNICAL_DETAILS_KEY, setTechnicalDetails, useTechnicalDetails } from "./technicalDetails";

function Probe() {
  const [on, set] = useTechnicalDetails();
  return <label><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />Show technical details<output>{String(on)}</output></label>;
}
beforeEach(() => { localStorage.clear(); act(() => setTechnicalDetails(false)); });

it("is off by default so owners see the plain answer, and the choice is remembered and shared across components", async () => {
  render(<><Probe /><Probe /></>);
  expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
  await userEvent.click(screen.getAllByRole("checkbox")[0]);
  expect(screen.getAllByRole("checkbox")[1]).toBeChecked(); // every screen sees it immediately
  expect(localStorage.getItem(TECHNICAL_DETAILS_KEY)).toBe("true");
});
