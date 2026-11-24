import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { whenIdle } from "./defer";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("runs the task once, only after the delay", () => {
  const task = vi.fn();
  whenIdle(task, 1000);
  vi.advanceTimersByTime(999);
  expect(task).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2000);
  expect(task).toHaveBeenCalledTimes(1);
});

it("never runs a cancelled task, whether the timer or the idle callback was pending", () => {
  const early = vi.fn(), late = vi.fn();
  whenIdle(early, 1000)();
  vi.advanceTimersByTime(5000);
  expect(early).not.toHaveBeenCalled();
  let pending: (() => void) | undefined;
  vi.stubGlobal("requestIdleCallback", (fn: () => void) => { pending = fn; return 7; });
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  const cancel = whenIdle(late, 100);
  vi.advanceTimersByTime(100);       // timer fired, idle callback now pending
  cancel();
  pending?.();
  expect(late).not.toHaveBeenCalled();
});

it("uses the browser's idle callback when there is one", () => {
  const task = vi.fn();
  const idle = vi.fn((fn: () => void) => { fn(); return 1; });
  vi.stubGlobal("requestIdleCallback", idle);
  whenIdle(task, 10);
  vi.advanceTimersByTime(10);
  expect(idle).toHaveBeenCalledTimes(1);
  expect(task).toHaveBeenCalledTimes(1);
});
