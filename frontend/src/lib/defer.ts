/**
 * Run non-urgent start-up work after the first screen has had time to load, so it does not compete with the requests
 * the visible page needs (Stage 7 follow-up, mobile performance). Returns a cancel function.
 */
export function whenIdle(task: () => void, delayMs = 1200): () => void {
  let cancelled = false;
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    const run = () => { if (!cancelled) task(); };
    if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run, { timeout: 1500 });
    else run();
  }, delayMs);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    if (idle !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
  };
}
