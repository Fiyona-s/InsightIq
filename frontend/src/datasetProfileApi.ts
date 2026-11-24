import { request } from "./api";
export interface ColumnProfile {
  name: string;
  inferred_type: string;
  storage_type: string;
  missing: number;
  nullable: boolean;
  unique_count: number;
  samples: string[];
  description: string;
}
export interface DatasetProfile {
  revision: number;
  original_filename: string;
  rows: number;
  column_count: number;
  columns: ColumnProfile[];
}
export interface QualitySummary {
  revision: number;
  rows: number;
  columns: {
    name: string;
    missing: number;
    missing_percent: number;
    unique_count: number;
  }[];
  duplicate_rows: number;
  empty_columns: string[];
  constant_columns: string[];
  type_issues: {
    column: string;
    expected: string;
    count: number;
    examples: string[];
  }[];
  type_threshold: number;
  example_limit: number;
  example_max_chars: number;
}
export interface Revision {
  snapshot_format?:string|null;
  uncompressed_size_bytes?:number|null;
  revision: number;
  source: string;
  timestamp: string | null;
  sha256: string | null;
  size_bytes: number | null;
  row_count: number | null;
  status: "available" | "unavailable" | "pruned" | "pending";
  changed_cells: number | null;
  restored_from: number | null;
}
export interface RevisionHistory {
  audit?:{id:string;action:string;timestamp:string;result:string;reason:string|null;actor:string|null}[];
  current_revision: number;
  recording_started_at: string;
  total: number;
  snapshot_limit: number;
  snapshot_bytes: number;
  revisions: Revision[];
}
export interface RevisionPreview {
  revision: number;
  columns: string[];
  rows: (string | null)[][];
  total: number;
  offset: number;
}
export const datasetProfileApi = {
  quality: (id: string) => request<QualitySummary>(`/datasets/${id}/quality`),
  profile: (id: string) =>
    request<DatasetProfile>(`/datasets/${id}/profile-details`),
  describe: (id: string, column: string, description: string) =>
    request<{ column: string; description: string }>(
      `/datasets/${id}/column-description`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column, description }),
      },
    ),
  history: (id: string, offset = 0) =>
    request<RevisionHistory>(`/datasets/${id}/revisions?offset=${offset}`),
  preview: (id: string, revision: number, offset = 0) =>
    request<RevisionPreview>(
      `/datasets/${id}/revisions/${revision}/preview?offset=${offset}`,
    ),
  restore: (id: string, revision: number, version: number, dirty: boolean) =>
    request<{ version: number }>(
      `/datasets/${id}/revisions/${revision}/restore`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected_version: version,
          confirm_restore: true,
          has_unsaved_edits: dirty,
        }),
      },
    ),
};
