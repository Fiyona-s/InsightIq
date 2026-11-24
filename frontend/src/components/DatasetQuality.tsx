import {TableFrame} from "./ui/data";
import {ErrorState,LoadingState} from "./WorkspaceStates";
import {Button} from "./ui/button";
import { useEffect, useState } from "react";
import { datasetProfileApi, type QualitySummary } from "../datasetProfileApi";
import { formatNumber } from "../lib/formatters";
export default function DatasetQuality({
  id,
  revision,
}: {
  id: string;
  revision?: number;
}) {
  const [data, setData] = useState<QualitySummary | null>(null),
    [error, setError] = useState(""),
    [attempt,setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setData(null);
    setError("");
    datasetProfileApi
      .quality(id)
      .then((v) => {
        if (current) {
          if (!Array.isArray(v.columns) || typeof v.revision !== "number") {
            setError("Quality summary unavailable.");
            return;
          }
          setData(v);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [id, revision,attempt]);
  if (error) return <ErrorState details={error}>Quality summary unavailable. <Button variant="ghost" onClick={()=>setAttempt(value=>value+1)}>Retry quality check</Button></ErrorState>;
  if (!data) return <LoadingState as="p">Checking data quality…</LoadingState>;
  const missing = data.columns.reduce((n, c) => n + c.missing, 0);
  return (
    <section className="dataset-quality" aria-label="Data quality">
      <div className="quality-summary">
        <strong>Data quality</strong>
        <span>{formatNumber(missing)} missing</span>
        <span>{formatNumber(data.duplicate_rows)} duplicate rows</span>
        <span>{formatNumber(data.empty_columns.length)} empty columns</span>
        <span>{formatNumber(data.constant_columns.length)} constant</span>
        <span>
          {formatNumber(data.type_issues.reduce((n, i) => n + i.count, 0))} type
          issues
        </span>
        <small>Revision {formatNumber(data.revision)}</small>
      </div>
      <details>
        <summary>Review details</summary>
        <p>
          Informational only. No values are changed. Duplicate rows count copies
          after the first identical row.
        </p>
        {!data.rows && <p>No rows to assess.</p>}
        <TableFrame label="Column health">
          <table>
            <thead>
              <tr>
                <th scope="col">Column</th>
                <th scope="col">Missing</th>
                <th scope="col">Missing %</th>
                <th scope="col">Unique populated values</th>
              </tr>
            </thead>
            <tbody>
              {data.columns.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{formatNumber(c.missing)}</td>
                  <td>{formatNumber(c.missing_percent, { decimals: 1 })}%</td>
                  <td>{formatNumber(c.unique_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        {data.empty_columns.length > 0 && (
          <p>Fully empty: {data.empty_columns.join(", ")}</p>
        )}
        {data.constant_columns.length > 0 && (
          <p>One populated value: {data.constant_columns.join(", ")}</p>
        )}
        {data.type_issues.map((i) => (
          <div key={i.column}>
            <strong>{i.column}</strong>: {formatNumber(i.count)} values do not
            conform to {i.expected}.
            <ul>
              {i.examples.map((v, index) => (
                <li key={index}>
                  <code>{v}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <small>
          Type hints flag mixed columns when at least{" "}
          {formatNumber(data.type_threshold * 100)}% of populated values
          convert. Examples are limited to {formatNumber(data.example_limit)} per issue and{" "}
          {formatNumber(data.example_max_chars)} characters each.
        </small>
      </details>
    </section>
  );
}
