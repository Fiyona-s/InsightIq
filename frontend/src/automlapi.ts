import { request } from "./api";
export type MLTask =
  "regression" | "classification" | "clustering" | "anomaly" | "forecasting";
export interface LeakageFinding {
  column: string;
  rule: "A" | "B" | "C";
  sentence: string;
}
export interface LeakageResult {
  rows_checked: number;
  findings: LeakageFinding[];
}
export interface MLFeature {
  name: string;
  kind: "numeric" | "categorical" | "datetime";
}
export interface MLColumn extends MLFeature {
  missing: number;
  cardinality: number;
  constant: boolean;
  potential_identifier: boolean;
  potential_leakage: boolean;
  high_cardinality: boolean;
  numeric_valid: number;
  date_valid: number;
  minimum: number | null;
  maximum: number | null;
  date_start: string | null;
  date_end: string | null;
  target_copy?: boolean;
}
export interface MLProfile {
  dataset_id: string;
  dataset_name: string;
  fingerprint: string;
  total_rows: number;
  sampled_rows: number;
  sampled: boolean;
  duplicate_rows: number;
  columns: MLColumn[];
  target_distribution: {
    observed: number;
    missing: number;
    unique: number;
    top_values: { value: string; count: number }[];
    remaining_values: number;
  } | null;
  readiness: { ready: boolean; reasons: string[]; warnings: string[] };
  policy: string;
}
export interface MLConfiguration {
  dataset_id: string;
  title: string;
  task: MLTask;
  target?: string | null;
  target_unit?: string | null;
  features: MLFeature[];
  scaler: "standard" | "robust" | "none";
  seed: number;
  clusters: number;
  contamination: number;
  rfm?: {
    customer: string;
    date: string;
    amount: string;
    order?: string | null;
    reference_date?: string | null;
  } | null;
  forecast?: {
    date_column: string;
    measure: string;
    frequency: "day" | "week" | "month";
    missing_periods: "error" | "zero" | "forward_fill";
    horizon: number;
    seasonal_period: number;
  } | null;
  confirm_feature_availability: true;
}
export type MLMetrics = Record<string, number | null>;
export interface MLCandidate {
  algorithm: string;
  status: string;
  training_metrics: MLMetrics | null;
  validation_metrics: MLMetrics | null;
  test_metrics: MLMetrics | null;
  fit_seconds: number;
  selected: boolean;
  model_id: string | null;
  error?: string | null;
}
export interface MLPlots {
  anomaly_distribution?: {
    lower: number;
    upper: number;
    count: number;
    flagged: number;
  }[];
  regression?: {
    row_index: number;
    actual: number;
    predicted: number;
    residual: number;
  }[];
  classification?: { class: string; actual: number; predicted: number }[];
  clusters?: { x: number; y: number; cluster: number; entity: string }[];
  anomalies?: {
    row_index: number;
    score: number;
    anomaly: boolean;
    features: Record<string, number | null>;
  }[];
  forecast?: { date: string; actual: number | null; forecast: number | null }[];
  backtest?: { date: string; actual: number; predicted: number }[];
}
export interface MLResult {
  leaderboard: MLCandidate[];
  selected_model_id: string;
  selection_metric: string;
  selection_split: string;
  split: Record<string, unknown>;
  plots: MLPlots;
  details: {
    labels?: string[];
    confusion_matrix?: number[][];
    averaging?: string;
    roc_auc_note?: string;
    cluster_profiles?: {
      cluster: number;
      count: number;
      features: Record<string, number | string | null>;
    }[];
    pca_explained_variance?: number[];
    pca_note?: string;
    reference_date?: string;
    frequency_definition?: string;
    backtests?: {
      algorithm: string;
      fold: number;
      scope: string;
      train_end: string;
      evaluation_start: string;
      evaluation_end: string;
      train_count: number;
      horizon: number;
      metrics: MLMetrics;
    }[];
    missing_periods?: string[];
    frequency?: string;
    measure?: string;
    wape_definition?: string;
    score_definition?: string;
    [key: string]: unknown;
  };
  rows_used: number;
  warnings: string[];
  scope: string;
  feature_importance: {
    method: string;
    values: { feature: string; importance: number }[];
  };
}
export interface MLExperiment {
  id: string;
  dataset_id: string;
  dataset_name: string;
  dataset_fingerprint: string;
  title: string;
  task: MLTask;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  configuration: MLConfiguration;
  limits: Record<string, number>;
  error: string | null;
  error_code: string | null;
  result: MLResult | null;
}
export interface MLModel {
  id: string;
  experiment_id: string;
  dataset_id: string;
  dataset_fingerprint: string;
  algorithm: string;
  task: MLTask;
  created_at: string;
  hyperparameters: Record<string, unknown>;
  metrics: Record<string, MLMetrics | null>;
  feature_schema: MLFeature[];
  selected: boolean;
  selection_metric: string;
  artifact_path: string;
  artifact_sha256: string;
  versions: Record<string, string>;
  configuration: MLConfiguration;
}
export interface MLPrediction {
  id: string;
  model_id: string;
  dataset_id: string | null;
  created_at: string;
  row_count: number;
  scope: string;
  columns: string[];
  rows: Record<string, unknown>[];
  offset: number;
}
const body = (value: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
export interface MLInputSchema {
  model_id: string;
  dataset_name: string;
  dataset_fingerprint: string;
  source_status: string;
  scope: string;
  features: (MLFeature & {
    minimum: number | null;
    maximum: number | null;
    categories: string[];
    hints_recorded: boolean;
  })[];
}
export interface MLInputValidation {
  valid: boolean;
  rows: number;
  rejected_row_count: number;
  rejected_rows: { row: number; field: string | null; reason: string }[];
  error_limit?: number;
}
export const automlApi = {
  validateInput: (id: string, input: unknown) =>
    request<MLInputValidation>(
      `/automl/models/${id}/validate-input`,
      body(input),
    ),
  inputSchema: (id: string) =>
    request<MLInputSchema>(`/automl/models/${id}/input-schema`),
  /** Read-only warning: predictor columns that look like they give away the answer (never blocks or trains). */
  leakage: (datasetId: string, task: MLTask, target: string, features: string[]) =>
    request<LeakageResult>(`/datasets/${datasetId}/leakage-check`, body({ task, target, features })),
  validate: (config: MLConfiguration) =>
    request<{ ready: boolean; reasons: string[] }>(
      "/automl/validate-configuration",
      body(config),
    ),
  profile: (id: string, task: MLTask, target?: string) =>
    request<MLProfile>(
      `/automl/datasets/${id}/profile?` +
        new URLSearchParams({ task, ...(target ? { target } : {}) }),
    ),
  experiments: () => request<MLExperiment[]>("/automl/experiments"),
  experiment: (id: string) =>
    request<MLExperiment>(`/automl/experiments/${id}`),
  train: (config: MLConfiguration) =>
    request<MLExperiment>("/automl/experiments", body(config)),
  cancel: (id: string) =>
    request<MLExperiment>(`/automl/experiments/${id}/cancel`, body({})),
  deleteExperiment: (id: string) =>
    request<void>(`/automl/experiments/${id}`, { method: "DELETE" }),
  models: () => request<MLModel[]>("/automl/models"),
  predict: (
    id: string,
    input: {
      records?: Record<string, unknown>[];
      dataset_id?: string;
      horizon?: number;
    },
  ) => request<MLPrediction>(`/automl/models/${id}/predict`, body(input)),
  predictions: () => request<MLPrediction[]>("/automl/predictions"),
  prediction: (id: string, offset = 0) =>
    request<MLPrediction>(
      `/automl/predictions/${id}?offset=${offset}&limit=50`,
    ),
  deletePrediction: (id: string) =>
    request<void>(`/automl/predictions/${id}`, { method: "DELETE" }),
};
