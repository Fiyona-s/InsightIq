import {
  request,
  type AnalystRun,
  type ChartData,
  type ChartSpec,
  type EvidenceFact,
} from "./api";
export type QueryResult = {
  columns: import("./api").ResultColumn[];
  rows: (string | number | boolean | null)[][];
  row_count: number;
};
export interface Filter {
  column: string;
  kind: "category" | "numeric" | "date";
  values: string[];
  minimum?: string | null;
  maximum?: string | null;
}
export interface SavedChart {
  data_as_of?:string|null;
  source_revision?:{number:number;hash:string}|null;
  result_hash?:string|null;
  refreshed_at?:string|null;
  currency_metadata?: Record<string, import("./api").Money>;
  currency_metadata_provenance?: {
    source: string;
    settings_digest: string;
    snapshot_digest: string;
    confirmed_at: string;
  } | null;
  snapshot_digest?: string | null;
  id: string;
  title: string;
  dataset_id: string;
  dataset_name: string;
  source_run_id: string;
  question: string;
  sql: string;
  type_mapping: Record<string, string>;
  spec: ChartSpec;
  refresh_policy: "snapshot" | "manual";
  created_at: string;
  updated_at: string;
  last_successful_refresh: string;
  status: string;
  error: string | null;
  summary: { fact_id: string; text: string }[];
  narrative_source: string;
  snapshot?: QueryResult;
}
export interface Widget {
  custom_title?:string|null;
  default_title?:string|null;
  display_title?:string|null;
  original_title?:string|null;
  freshness?:{status:string;reason:string|null;can_refresh:boolean;label:string;original_name:string;archived:boolean;deleted:boolean};
  matching_widget_ids?:string[];
  history_count?:number;
  currency_metadata_available?: boolean;
  id: string;
  chart_id: string | null;
  kind: "chart" | "text";
  title: string;
  text: string;
  spec: ChartSpec | null;
  filters: Filter[];
  width: number;
  height: number;
  source?: SavedChart;
  result?: QueryResult;
  chart?: ChartData;
  chart_options?: ChartSpec[];
  filters_applied?: {
    applied: Filter[];
    unavailable: { column: string; reason: string }[];
    scope: string;
  };
  evidence?: { facts: EvidenceFact[]; result_digest: string };
  summary?: { fact_id: string; text: string }[];
  fallback_reason?: string | null;
  error?: string;
}
export interface Dashboard {
  id: string;
  title: string;
  description: string;
  revision: number;
  filters: Filter[];
  widgets: Widget[];
  created_at: string;
  updated_at: string;
  snapshot_notice: string;
  widget_count?: number;
}
export type DashboardSummary = Pick<
  Dashboard,
  | "id"
  | "title"
  | "description"
  | "revision"
  | "filters"
  | "created_at"
  | "updated_at"
> & { widget_count: number };
export interface Analytics {
  feedback_counts?:{helpful:number;not_helpful:number};
  total_questions: number;
  succeeded: number;
  failed: number;
  execution_success_rate: number | null;
  correctness: string;
  validation_failures: number;
  attempts: Record<string, number>;
  latency_ms: {
    average: number | null;
    p50: number | null;
    p95: number | null;
    measured_records: number;
  };
  retrieval_latency_ms: { average: number | null; measured_records: number };
  tokens: { known_sum: number; known_records: number; unknown_records: number };
  cost_usd: {
    known_sum: number;
    known_records: number;
    unknown_records: number;
  };
  error_categories: Record<string, number>;
  recent: AnalystRun[];
  models: string[];
  coverage: string;
}
export interface BenchmarkCase {
  id: string;
  question: string;
  category: string;
  difficulty: string;
  expectation: "sql" | "abstain";
  reference_sql: string | null;
  expected: QueryResult | null;
  ordered: boolean;
  verification: "verified" | "pending";
  verification_reason?: string;
}
export interface Benchmark {
  version: string;
  title: string;
  dataset_id: string | null;
  fingerprint?: string;
  case_count: number;
  verified_count: number;
  pending_count: number;
  cases: BenchmarkCase[];
  scope: string;
  comparison_policy: string;
  pricing: { input: string; output: string } | null;
  limits: {
    max_cases: number;
    max_provider_calls: number;
    output_tokens_per_call: number;
    max_seconds: number;
    cost_policy: string;
  };
}
export interface EvaluationRate {
  numerator: number;
  denominator: number;
  value: number | null;
  unit: string;
  description: string;
}
export interface ComparisonDetails {
  policy: string;
  strict_match: boolean;
  strict_reason: string;
  column_names_match: boolean;
  positional_values_match: boolean;
  positional_reason: string;
  alias_only_mismatch: boolean;
  notice: string;
}
export interface EvaluationMetrics {
  metrics_version?: string | null;
  rates?: Record<string, EvaluationRate>;
  latency_sample_size?: number;
  usage_sample_size?: number;
  cost_sample_size?: number;
  evaluated_count?: number | null;
  correct_count?: number | null;
  incorrect_count?: number | null;
  missing_predictions?: number | null;
  execution_failures?: number | null;
  reference_failures?: number | null;
  reviewed_cases?: number;
  wrong_join_rate?: number | null;
  wrong_filter_rate?: number | null;
  wrong_aggregation_rate?: number | null;
  hallucinated_column_rate?: number | null;
  hallucinated_table_rate?: number | null;
  completed_cases: number;
  accuracy: number | null;
  valid_sql_rate: number | null;
  execution_success_rate: number | null;
  result_accuracy: number | null;
  average_attempts: number | null;
  repair_success_rate: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  difficulties?: Record<string, { total: number; correct: number }>;
  categories: Record<string, { total: number; correct: number }>;
  diagnostic_counts: Record<string, number>;
  diagnostic_note: string;
}
export interface Evaluation {
  prompt_version?: string | null;
  prompt_hash?: string | null;
  workflow_version?: string | null;
  comparison_policy?: string | null;
  id: string;
  dataset_id: string;
  version: string;
  mode?: "paid" | "offline";
  dataset_fingerprint?: string;
  source_evaluation_id?: string | null;
  pipeline: "baseline" | "rag" | "agentic" | "offline";
  model: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
  active_run_id: string | null;
  case_ids: string[];
  provider_calls: number;
  reserved_tokens: number;
  reserved_cost_usd: number;
  max_total_tokens: number;
  max_spend_usd: number;
  error: string | null;
  metrics: EvaluationMetrics | null;
  pricing: { input: string; output: string; source: string };
  results?: {
    case_id: string;
    category: string;
    difficulty: string;
    question: string;
    reference_sql: string | null;
    expected: QueryResult | null;
    actual: QueryResult | null;
    status?:
      | "missing_prediction"
      | "correct"
      | "incorrect"
      | "execution_failed"
      | "reference_failed";
    source_evaluation_id?: string | null;
    source_run_id?: string | null;
    source_model?: string | null;
    source_pipeline?: string | null;
    replayed_sql?: string | null;
    offline_latency_ms?: number | null;
    ordered?: boolean;
    comparison_details?: ComparisonDetails | null;
    replay_diagnostics?: Record<string, string>;
    correct: boolean | null;
    comparison: string;
    run: AnalystRun | null;
    review?: {
      reviewed: boolean;
      labels: string[];
      reason: string;
      reviewed_at: string;
    };
    failure_labels: string[];
  }[];
}
const body = (data: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
export const phase4Api = {
  confirmChartCurrency: (id: string, expected_snapshot_digest: string) =>
    request<SavedChart>(`/saved-charts/${id}/currency-metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_snapshot_digest }),
    }),

  dashboards: () => request<DashboardSummary[]>("/dashboards"),
  dashboard: (id: string) => request<Dashboard>(`/dashboards/${id}`),
  createDashboard: (title: string, description = "") =>
    request<Dashboard>("/dashboards", body({ title, description })),
  saveDashboard: (dashboard: Dashboard) =>
    request<Dashboard>(
      `/dashboards/${dashboard.id}`,
      body(
        {
          title: dashboard.title,
          description: dashboard.description,
          revision: dashboard.revision,
          filters: dashboard.filters,
          widgets: dashboard.widgets.map((w) => ({
            id: w.id,
            chart_id: w.chart_id,
            kind: w.kind,
            title: w.title,
            custom_title:w.custom_title,
            text: w.text,
            spec: w.spec,
            filters: w.filters,
            width: w.width,
            height: w.height,
          })),
        },
        "PUT",
      ),
    ),
  duplicateDashboard: (id: string) =>
    request<Dashboard>(`/dashboards/${id}/duplicate`, body({})),
  deleteDashboard: async (id: string) => {
    const response = await fetch(`/api/dashboards/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Dashboard deletion failed.");
  },
  charts: () => request<SavedChart[]>("/saved-charts"),
  saveChart: (
    run_id: string,
    title: string,
    spec: ChartSpec,
    refresh_policy: "snapshot" | "manual",
    persist_snapshot_confirmed: true,
  ) =>
    request<SavedChart>(
      "/saved-charts",
      body({ run_id, title, spec, refresh_policy, persist_snapshot_confirmed }),
    ),
  refreshChart: (id: string) =>
    request<SavedChart>(`/saved-charts/${id}/refresh`, body({})),
  deleteChart: async (id: string) => {
    const response = await fetch(`/api/saved-charts/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Chart deletion failed.");
    }
  },
  analytics: (filters: Record<string, string> = {}) =>
    request<Analytics>(
      "/analytics/runs?" +
        new URLSearchParams(Object.entries(filters).filter(([, v]) => v)),
    ),
  benchmark: () => request<Benchmark>("/benchmarks"),
  installBenchmark: () =>
    request<{ dataset_id: string }>("/benchmarks/retail-v1/install", body({})),
  verifyBenchmark: (dataset_id: string) =>
    request<Benchmark>(
      "/benchmarks/retail-v1/verify?" + new URLSearchParams({ dataset_id }),
      body({}),
    ),
  evaluations: () => request<Evaluation[]>("/evaluations"),
  evaluation: (id: string) => request<Evaluation>(`/evaluations/${id}`),
  evaluate: (data: {
    dataset_id: string;
    version: string;
    case_ids: string[];
    pipeline: string;
    max_spend_usd: number;
    max_total_tokens: number;
    confirm_paid_calls: true;
  }) => request<Evaluation>("/evaluations", body(data)),
  evaluateOffline: (data: {
    dataset_id: string;
    version: string;
    case_ids?: string[];
    source_evaluation_id?: string | null;
  }) => request<Evaluation>("/evaluations/offline", body(data)),
  reviewCase: (id: string, caseId: string, labels: string[], reason: string) =>
    request<Evaluation>(
      `/evaluations/${id}/cases/${caseId}/review`,
      body({ reviewed: true, labels, reason }, "PUT"),
    ),
  deleteEvaluation: async (id: string) => {
    const response = await fetch(`/api/evaluations/${id}/record`, {
      method: "DELETE",
    });
    if (!response.ok)
      throw new Error("Stop the evaluation before deleting its record.");
  },
  cancelEvaluation: (id: string) =>
    request<Evaluation>(`/evaluations/${id}`, { method: "DELETE" }),
};
