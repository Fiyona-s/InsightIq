import { analystApi, type AnalystRun } from "../api";
import type { Analytics } from "../phase4api";

/**
 * Login on (hosted mode): Home and the Setup guide read the signed-in person's question list (GET /api/analyst/runs, a route
 * analysts and owners may call) instead of the owner-only analytics route (GET /api/analytics/runs). Login off keeps the
 * analytics route, exactly as before.
 */
export async function hostedRuns(): Promise<AnalystRun[]> {
  const runs = await analystApi.history();
  return Array.isArray(runs) ? runs : [];
}
export const succeededCount = (runs: AnalystRun[], datasetId?: string) =>
  runs.filter((r) => r.status === "succeeded" && (datasetId === undefined || r.dataset_id === datasetId)).length;
export const asAnalytics = (runs: AnalystRun[]) => ({ recent: runs, succeeded: succeededCount(runs), total_questions: runs.length }) as unknown as Analytics;
