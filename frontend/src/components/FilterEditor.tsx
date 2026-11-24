import {ErrorState} from "./WorkspaceStates";
import { formatNumber } from "../lib/formatters";
import { useState } from "react";
import type { Filter, QueryResult } from "../phase4api";
import { Button } from "./ui/button";
export default function FilterEditor({
  filters,
  result,
  onChange,
  label = "Result filters",
  disabled = false,
}: {
  filters: Filter[];
  result?: QueryResult;
  onChange: (filters: Filter[]) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [column, setColumn] = useState(""),
    [kind, setKind] = useState<Filter["kind"]>("category"),
    [value, setValue] = useState(""),
    [max, setMax] = useState(""),
    [error, setError] = useState("");
  const names = [...new Set(result?.columns.map((c) => c.name) || [])];
  return (
    <details className="filter-editor">
      <summary>
        {label} <span>{formatNumber(filters.length)} active</span>
      </summary>
      <p className="insight-note">
        Filters select actual query-output rows. They do not recalculate metrics
        from filtered source records. Widgets without compatible columns show
        “not applicable”.
      </p>
      {filters.map((f, i) => (
        <div className="filter-chip" key={i}>
          <span>
            {f.column} · {f.kind} ·{" "}
            {f.kind === "category"
              ? f.values.join(", ")
              : `${f.minimum || "any"} → ${f.maximum || "any"}`}
          </span>
          <button
            aria-label={"Remove filter " + (i + 1)}
            disabled={disabled}
            onClick={() => onChange(filters.filter((_, j) => i !== j))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="filter-fields">
        <label>
          Result column
          <input
            list={label.replaceAll(" ", "-") + "-columns"}
            value={column}
            onChange={(e) => setColumn(e.target.value)}
            maxLength={128}
          />
          <datalist id={label.replaceAll(" ", "-") + "-columns"}>
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label>
          Filter kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Filter["kind"])}
          >
            <option value="category">Category</option>
            <option value="numeric">Numeric range</option>
            <option value="date">Date range</option>
          </select>
        </label>
        <label>
          {kind === "category"
            ? "Values, separated by commas"
            : "Minimum (inclusive)"}
          <input
            value={value}
            type={kind === "date" ? "date" : "text"}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {kind !== "category" && (
          <label>
            Maximum (inclusive)
            <input
              value={max}
              type={kind === "date" ? "date" : "text"}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || filters.length >= 12}
          onClick={() => {
            if (!column.trim() || (!value.trim() && !max.trim())) {
              setError("Choose a column and at least one value or bound.");
              return;
            }
            setError("");
            onChange([
              ...filters,
              {
                column: column.trim(),
                kind,
                values:
                  kind === "category"
                    ? value.split(",").map((v) => v.trim())
                    : [],
                minimum: kind === "category" ? null : value || null,
                maximum: kind === "category" ? null : max || null,
              },
            ]);
          }}
        >
          Apply filter
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled || !filters.length}
          onClick={() => onChange([])}
        >
          Reset filters
        </Button>
      </div>
      {error && <ErrorState as="p" role="alert">{error}</ErrorState>}
    </details>
  );
}
