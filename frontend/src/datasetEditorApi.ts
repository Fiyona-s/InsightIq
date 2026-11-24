import { request, type AnalysisType } from "./api";

export type DatasetRow = { id: string; values: (string | null)[] };
export interface DatasetRevision {
  version: number;
  saved_at: string | null;
  type_mapping: Record<string, AnalysisType>;
}
export interface DatasetRows extends DatasetRevision {
  columns: string[];
  rows: DatasetRow[];
  total: number;
}
export interface DatasetEditBatch {
  expected_version: number;
  types_confirmed: boolean;
  type_mapping: Record<string, AnalysisType>;
  updates: { id: string; values: Record<string, string | null> }[];
  additions: Record<string, string | null>[];
  deletions: string[];
}
export const datasetEditorApi = {
  rows: (id: string, offset: number, sort: string) =>
    request<DatasetRows>(
      `/datasets/${id}/rows?offset=${offset}&sort=${encodeURIComponent(sort)}`,
    ),
  save: (id: string, batch: DatasetEditBatch) =>
    request<DatasetRevision>(`/datasets/${id}/edits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    }),
};
