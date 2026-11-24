import {TableFrame} from "./ui/data";
import {ErrorState,LoadingState} from "./WorkspaceStates";
import { useStillWorking } from "../lib/stillWorking";
import { useEffect, useState } from "react";
import {
  datasetProfileApi,
  type DatasetProfile as Profile,
} from "../datasetProfileApi";
import { formatNumber } from "../lib/formatters";
import type { Dataset } from "../api";
import { Button } from "./ui/button";
export default function DatasetProfile({
  dataset,
  revision,
  onEditDescriptions,
}: {
  dataset: Dataset;
  revision?: number;
  /** Opens Business definitions, where the descriptions are written (stored exactly as before). */
  onEditDescriptions?: () => void;
}) {
  const [data, setData] = useState<Profile | null>(null),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const slow = useStillWorking(!data && !error, 6000);
  useEffect(() => {
    let current = true;
    setData(null);
    setError("");
    datasetProfileApi
      .profile(dataset.id)
      .then((value) => {
        if (current) {
          if (!Array.isArray(value.columns)) {
            setError("Profile is unavailable.");
            return;
          }
          setData(value);
          setDraft(
            Object.fromEntries(
              value.columns.map((c) => [c.name, c.description]),
            ),
          );
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [dataset.id, revision]);
  return (
    <section className="dataset-profile" aria-label="Schema and profile">
      {error && <ErrorState as="p" role="alert">{error}</ErrorState>}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <LoadingState as="p" role="status">{slow ? "Still checking your columns. Large files take longer." : "Loading column profile…"}</LoadingState>}
      {data && (
        <>
          <p className="profile-provenance">
            Original file: <strong>{data.original_filename}</strong> ·{" "}
            {formatNumber(data.rows)} rows · {formatNumber(data.column_count)}{" "}
            columns
          </p>
          <p className="schema-note">
            Suggested types. Descriptions are written in Business definitions.{" "}
            {onEditDescriptions && <Button variant="ghost" onClick={onEditDescriptions}>Edit descriptions in Business definitions</Button>}
          </p>
          <TableFrame label="Columns">
            <table>
              <thead>
                <tr>
                  <th scope="col">Column name</th>
                  <th scope="col">Inferred type</th>
                  <th scope="col">Missing / nullable</th>
                  <th scope="col">Unique</th>
                  <th scope="col">Sample values</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {data.columns.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td title={`Storage: ${c.storage_type}`}>
                      <code>{c.inferred_type}</code>
                    </td>
                    <td>
                      {formatNumber(c.missing)} · {c.nullable ? "Yes" : "No"}
                    </td>
                    <td>{formatNumber(c.unique_count)}</td>
                    <td>
                      {c.samples.map((v, i) => (
                        <code className="profile-sample" key={i}>
                          {v === "" ? "(empty string)" : v}
                        </code>
                      ))}
                    </td>
                    <td>
                      {c.description ? <span className="profile-description">{c.description}</span> : <span className="profile-description muted-date">No description yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          <small>
            Display-only sample values are truncated to 100 characters; original
            values are preserved.
          </small>
        </>
      )}
    </section>
  );
}
