import type { AnalysisType } from "../api";

/**
 * Plain-language names for the column types an owner can confirm in Ask. The labels are display
 * only: each one maps one-to-one to the stored/sent type value, which is unchanged.
 */
export const TYPE_LABELS: Record<AnalysisType, string> = {
  VARCHAR: "Text",
  BIGINT: "Whole number",
  DOUBLE: "Decimal number",
  DATE: "Date",
  TIMESTAMP: "Date and time",
  BOOLEAN: "Yes / No",
};
export const ANALYSIS_TYPES = Object.keys(TYPE_LABELS) as AnalysisType[];
export const typeLabel = (type: string): string => TYPE_LABELS[type as AnalysisType] ?? type;
