export interface Money {
  currency: string | null;
  mixed?: boolean;
}
export interface ResultColumn {
  name: string;
  type: string;
  money?: Money | null;
  /** True only when the owner confirmed the source column as a percentage. */
  percent?: boolean;
}
export interface ColumnInfo {
  name: string;
  type: string;
  null_count: number;
}
export interface Dataset {
  display_name?: string | null;
  archived_at?: string | null;
  archived_reason?: string | null;
  is_sample?: boolean;
  /** The installed test benchmark (Admin-only); never shown in owner views. */
  is_benchmark?: boolean;
  id: string;
  name: string;
  rows: number;
  bytes: number;
  created_at: string;
  columns: ColumnInfo[];
}
export interface Preview {
  columns: string[];
  rows: (string | null)[][];
  offset: number;
  total: number;
}
export type UploadProgress = { phase: "sending" | "processing"; loaded: number; total: number };
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail))
        message = body.detail
          .slice(0, 3)
          .map(
            (item: { loc?: string[]; msg?: string }) =>
              `${item.loc?.slice(1).join(".") || "Request"}: ${item.msg || "Invalid value"}`,
          )
          .join("; ");
    } catch {
      /* retain status */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const api = {
  list: (includeArchived = false) => request<Dataset[]>("/datasets" + (includeArchived ? "?include_archived=true" : "")),
  preview: (id: string, offset = 0) =>
    request<Preview>(`/datasets/${id}/preview?offset=${offset}&limit=25`),
  upload: (file: File, onProgress?: (p: UploadProgress) => void) => {
    const body = new FormData();
    body.append("file", file);
    if (!onProgress) return request<Dataset>("/datasets", { method: "POST", body });
    return new Promise<Dataset>((resolve, reject) => {        // the browser can only report upload progress through XMLHttpRequest
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/datasets");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress({ phase: "sending", loaded: e.loaded, total: e.total }); };
      xhr.upload.onload = () => onProgress({ phase: "processing", loaded: file.size, total: file.size });
      xhr.onerror = () => reject(new Error("Failed to fetch"));
      xhr.onload = () => {
        let parsed: { detail?: unknown } | Dataset | null = null;
        try { parsed = JSON.parse(xhr.responseText); } catch { /* keep status */ }
        if (xhr.status >= 200 && xhr.status < 300 && parsed) resolve(parsed as Dataset);
        else reject(new Error(parsed && typeof (parsed as { detail?: unknown }).detail === "string" ? ((parsed as { detail: string }).detail) : `Request failed (${xhr.status}).`));
      };
      xhr.send(body);
    });
  },
};

export type AnalysisType =
  "VARCHAR" | "BIGINT" | "DOUBLE" | "DATE" | "TIMESTAMP" | "BOOLEAN";
export interface ProfileColumn {
  name: string;
  storage_type: string;
  missing: number;
  suggested_type: AnalysisType;
  conversions: Record<string, { valid: number; failed: number }>;
}
export interface TypeProfile {
  table: string;
  rows: number;
  columns: ProfileColumn[];
  policy: string;
}
export interface SQLAttempt {
  attempt: number;
  context_fingerprint: string;
  sql: string | null;
  outcome: string;
  validation: "not_started" | "passed" | "rejected" | "stopped";
  execution: "not_started" | "succeeded" | "failed";
  error_code: string | null;
}
export interface AnalystRun {
  activity_kind?: string;
  thread_id?:string|null;
  thread_context?:{question:string;executed_sql:string|null;result_summary:unknown}[];
  thread_result_summary?:{columns:string[];row_count:number;rows:unknown[][]}|null;
  clarification_options?:{kind:"column"|"metric";name:string}[];
  clarification_choice?:{kind:"column"|"metric";name:string}|null;
  pipeline?: string;
  prompt_version?: string | null;
  prompt_hash?: string | null;
  workflow_version?: string | null;
  attempt_history?: SQLAttempt[];
  events?: AgentEvent[];
  attempts?: number;
  current_step?: string;
  retrieval?: Retrieval | null;
  chart_spec?: ChartSpec | null;
  evidence_count?: number;
  result_digest?: string | null;
  id: string;
  dataset_id: string;
  dataset_name: string;
  question: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  sql: string | null;
  executed_sql: string | null;
  explanation: string | null;
  answer: string | null;
  clarification: string | null;
  error: string | null;
  error_code: string | null;
  type_mapping: Record<string, AnalysisType>;
  conversions: {
    column: string;
    type: string;
    missing: number;
    failed: number;
  }[];
  metrics: {
    model?: string;
    provider_model?: string;
    model_latency_ms?: number;
    retrieval_latency_ms?: number;
    query_latency_ms?: number;
    total_latency_ms?: number;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    estimated_cost_usd?: number | null;
  };
  result_metadata: {
    columns: ResultColumn[];
    row_count: number;
  } | null;
  results_available: boolean;
}
export interface AnalystResults {
  columns: ResultColumn[];
  rows: (string | number | boolean | null)[][];
  row_count: number;
  offset: number;
  expires_in_seconds: number;
}
/** Remembered, explicitly confirmed column types for a dataset (approved fix 3a). */
export interface ConfirmedTypes {
  dataset_id: string;
  type_mapping: Record<string, AnalysisType> | null;
  confirmed_at: string | null;
  /** False when the dataset's columns changed since confirmation (the memory no longer applies). */
  current: boolean;
}
export const analystApi = {
  profile: (id: string) => request<TypeProfile>(`/datasets/${id}/profile`),
  confirmedTypes: (id: string) => request<ConfirmedTypes>(`/datasets/${id}/confirmed-types`),
  confirmTypes: (id: string, type_mapping: Record<string, AnalysisType>) =>
    request<ConfirmedTypes>(`/datasets/${id}/confirmed-types`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type_mapping, confirm: true }),
    }),
  forgetTypes: (id: string) => request<ConfirmedTypes>(`/datasets/${id}/confirmed-types`, { method: "DELETE" }),
  history: (id?: string, offset = 0) =>
    request<AnalystRun[]>(
      `/analyst/runs?${id ? `dataset_id=${encodeURIComponent(id)}&` : ""}offset=${offset}`,
    ),
  ask: (
    dataset_id: string,
    question: string,
    type_mapping: Record<string, AnalysisType>,
    context: {thread_id?:string;clarification_choice?:{kind:"column"|"metric";name:string}} = {},
  ) =>
    request<AnalystRun>("/analyst/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id, question, type_mapping, ...context }),
    }),
  run: (id: string) => request<AnalystRun>(`/analyst/runs/${id}`),
  /** Run a saved question again on the current data. No AI call: the stored SQL goes through the same safety checks. */
  rerun: (id: string) => request<AnalystRun>(`/analyst/runs/${id}/rerun`, { method: "POST" }),
  cancel: (id: string) =>
    request<AnalystRun>(`/analyst/runs/${id}`, { method: "DELETE" }),
  results: (id: string, offset = 0) =>
    request<AnalystResults>(
      `/analyst/runs/${id}/results?offset=${offset}&limit=25`,
    ),
};

export interface AgentEvent {
  id: number;
  step: string;
  status: string;
  timestamp: string;
  attempt: number;
  summary: string;
}
export interface Retrieval {
  status: "ready" | "unavailable";
  workspace_id: string;
  dataset_id: string;
  fingerprint: string;
  embedding_model: string;
  warning: string | null;
  rebuilt: boolean;
  documents: {
    id: string;
    kind: string;
    title: string;
    text: string;
    workspace_id: string;
    dataset_id: string;
    fingerprint: string;
    provenance: Record<string, unknown>;
    score: number;
    reason: string;
  }[];
}
export type ChartKind = "bar" | "line" | "donut" | "scatter" | "kpi" | "table";
export interface ChartSpec {
  kind: ChartKind;
  x: number | null;
  y: number | null;
  title: string;
  null_policy: "omit_with_count";
  zero_baseline: true;
}
export interface ChartData {
  x_money?: Money | null;
  money?: Money | null;
  /** True only when the owner confirmed the plotted column as a percentage. */
  percent?: boolean | null;
  spec: ChartSpec;
  points: {
    row: number;
    x?: number | string;
    label?: string;
    y?: number;
    value: string | number;
  }[];
  omitted_rows: number;
  note: string;
}
export interface EvidenceFact {
  id: string;
  method: string;
  value: string;
  statement: string;
  source: {
    result_digest: string;
    columns: number[];
    rows: number[];
    formula: string;
    scope: string;
  };
}
export interface Analysis {
  charts: {
    recommended: ChartData;
    options: ChartSpec[];
    fallback_reason: string | null;
  };
  evidence: { result_digest: string; facts: EvidenceFact[]; coverage: string };
  narrative: { fact_id: string; text: string }[];
  narrative_source: string;
  warning: string | null;
}
export interface KnowledgeSettings {
  monetary_columns?: Record<string, Money>;
  default_currency_columns?: string[];
  /** Columns the owner confirmed as percentages (shown with %). */
  percent_columns?: string[];
  /** True once the owner confirmed what each numeric column is. */
  units_confirmed?: boolean;
  description: string;
  columns: Record<string, string>;
  metrics: {
    name: string;
    description: string;
    sql: string;
    money?: Money | null;
  }[];
}
export interface KnowledgeInfo {
  workspace_id: string;
  dataset_id: string;
  settings: KnowledgeSettings;
  columns: string[];
  schema_signature: string;
  updated_at: string;
  verified_examples: number;
  embedding_model: string;
}
const jsonBody = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const insightApi = {
  analysis: (id: string) => request<Analysis>(`/analyst/runs/${id}/analysis`),
  chart: (id: string, spec: ChartSpec) =>
    request<ChartData>(`/analyst/runs/${id}/chart`, jsonBody(spec)),
  knowledge: (id: string) =>
    request<KnowledgeInfo>(`/datasets/${id}/knowledge`),
  saveKnowledge: (id: string, settings: KnowledgeSettings) =>
    request<KnowledgeInfo>(
      `/datasets/${id}/knowledge`,
      jsonBody(settings, "PUT"),
    ),
  retrieve: (
    id: string,
    question: string,
    type_mapping: Record<string, AnalysisType> = {},
  ) =>
    request<Retrieval>(
      `/datasets/${id}/knowledge/retrieve`,
      jsonBody({ question, type_mapping, top_k: 6 }),
    ),
  verify: (id: string, run_id: string, expected_result_digest: string) =>
    request<{ status: string }>(
      `/datasets/${id}/knowledge/examples`,
      jsonBody({ run_id, expected_result_digest }),
    ),
  deleteDataset: (id: string, confirmation: import("./datasetLifecycleApi").Confirmation) =>
    request<void>(`/datasets/${id}`, {method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify(confirmation)}),
};
