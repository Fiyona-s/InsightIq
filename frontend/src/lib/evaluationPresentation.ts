import type { Evaluation } from "../phase4api";
export type EvaluationRow = NonNullable<Evaluation["results"]>[number];
export type EvaluationPresentation = {
  id: string;
  scoring_version: string | null;
  comparison_policy: string | null;
  results: {
    case_id: string;
    diff: {
      available: boolean;
      notice: string;
      total_rows?: number;
      shown_rows?: number;
      rows: { side: string; row: number; value: unknown[]; match: string }[];
    };
  }[];
};
export function selectedRows(job: Evaluation): EvaluationRow[] {
  const stored = new Map(job.results?.map((r) => [r.case_id, r]));
  return job.case_ids.map(
    (id) =>
      stored.get(id) || {
        case_id: id,
        question: "Question metadata not recorded",
        category: "Unknown",
        difficulty: "Unknown",
        correct: null,
        comparison: "",
        failure_labels: [],
        expected: null,
        actual: null,
        run: null,
        reference_sql: null,
      },
  );
}
export function outcome(row: EvaluationRow) {
  return row.correct === true
    ? "Correct"
    : row.correct === false
      ? "Incorrect"
      : "Unscored";
}
export function reasons(row: EvaluationRow) {
  return row.failure_labels?.length
    ? row.failure_labels
    : row.comparison
      ? [row.comparison]
      : row.status === "missing_prediction"
        ? [row.status]
        : ["No reason recorded"];
}
export function tally(job: Evaluation) {
  const rows = selectedRows(job),
    correct = rows.filter((r) => r.correct === true).length,
    incorrect = rows.filter((r) => r.correct === false).length;
  return {
    correct,
    incorrect,
    scored: correct + incorrect,
    unscored: rows.length - correct - incorrect,
    selected: rows.length,
  };
}
export function scopeLabel(job: Evaluation, total = 45) {
  return job.case_ids.length === total
    ? "Full selected question set"
    : `Partial run: ${job.case_ids.length} of ${total} questions`;
}
export function compareRuns(
  a: Evaluation,
  b: Evaluation,
  metaA: EvaluationPresentation | null,
  metaB: EvaluationPresentation | null,
  overlap = false,
) {
  if (a.status !== "completed" || b.status !== "completed")
    return { reason: "Both runs must be completed.", changes: [] };
  if (a.version !== b.version)
    return { reason: "Benchmark versions differ.", changes: [] };
  if (!metaA?.scoring_version || !metaB?.scoring_version)
    return { reason: "Stored scoring version is unavailable.", changes: [] };
  if (metaA.scoring_version !== metaB.scoring_version)
    return { reason: "Scoring versions differ.", changes: [] };
  if (metaA.comparison_policy !== metaB.comparison_policy)
    return {
      reason: "Comparator policies differ or are not recorded consistently.",
      changes: [],
    };
  if (
    !a.dataset_fingerprint ||
    !b.dataset_fingerprint ||
    a.dataset_fingerprint !== b.dataset_fingerprint
  )
    return {
      reason: "Benchmark dataset fingerprints differ or are unavailable.",
      changes: [],
    };
  const ids = a.case_ids.filter((id) => b.case_ids.includes(id));
  if (
    !overlap &&
    (ids.length !== a.case_ids.length || ids.length !== b.case_ids.length)
  )
    return {
      reason:
        "Question sets differ. Choose overlap-only comparison explicitly.",
      changes: [],
    };
  if (!ids.length)
    return { reason: "There are no overlapping questions.", changes: [] };
  const rowsA = new Map(selectedRows(a).map((r) => [r.case_id, r])),
    rowsB = new Map(selectedRows(b).map((r) => [r.case_id, r]));
  return {
    reason: null,
    scope: overlap
      ? `Overlapping questions only: ${ids.length} of ${a.case_ids.length} / ${b.case_ids.length}.`
      : `Same ${ids.length} selected questions.`,
    changes: ids.map((id) => {
      const before = rowsA.get(id)?.correct,
        after = rowsB.get(id)?.correct;
      return {
        id,
        before: before == null ? "Unscored" : before ? "Correct" : "Incorrect",
        after: after == null ? "Unscored" : after ? "Correct" : "Incorrect",
        change:
          before == null || after == null
            ? "Unscored in one or both runs"
            : before === after
              ? "Unchanged"
              : after
                ? "Fixed"
                : "Regressed",
      };
    }),
  };
}
