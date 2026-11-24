import {TableFrame} from "./ui/data";
import {Modal} from "./ui/overlay";
import {ErrorState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import { useEffect, useState } from "react";
import {
  datasetProfileApi,
  type Revision,
  type RevisionHistory,
  type RevisionPreview,
} from "../datasetProfileApi";
import { lifecycleApi, type Dependencies } from "../datasetLifecycleApi";
import { useActiveDataset } from "../lib/activeDataset";
import { formatNumber } from "../lib/formatters";
import type { Dataset } from "../api";
import { Button } from "./ui/button";
const labels = {
  available: "Snapshot available",
  unavailable: "No snapshot available",
  pruned: "Snapshot pruned",
  pending: "Snapshot pending",
};
export default function DatasetHistory({
  dataset,
  dirty,
  revision,
  onRestored,
}: {
  dataset: Dataset;
  dirty: boolean;
  revision?: number;
  onRestored: () => void;
}) {
  const context = useActiveDataset(),
    [history, setHistory] = useState<RevisionHistory | null>(null),
    [offset, setOffset] = useState(0),
    [preview, setPreview] = useState<RevisionPreview | null>(null),
    [choice, setChoice] = useState<Revision | null>(null),
    [dependencies, setDependencies] = useState<Dependencies | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const running = !!context?.jobs.some((j) => j.datasetId === dataset.id);
  async function load() {
    setError("");
    try {
      const value = await datasetProfileApi.history(dataset.id, offset);
      setHistory(value);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let current = true;
    setError("");
    datasetProfileApi
      .history(dataset.id, offset)
      .then((value) => {
        if (current) setHistory(value);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [dataset.id, offset, revision]);
  async function view(r: Revision, page = 0) {
    setBusy(true);
    setError("");
    try {
      setPreview(await datasetProfileApi.preview(dataset.id, r.revision, page));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(r: Revision) {
    setChoice(r);
    setDependencies(null);
    setError("");
    try {
      setDependencies(await lifecycleApi.dependencies(dataset.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function restore() {
    if (!choice || !history) return;
    setBusy(true);
    setError("");
    try {
      const saved = await datasetProfileApi.restore(
        dataset.id,
        choice.revision,
        history.current_revision,
        dirty,
      );
      setNotice(
        `Revision ${saved.version} created from revision ${choice.revision}. Earlier revisions are kept.`,
      );
      setChoice(null);
      setPreview(null);
      await load();
      onRestored();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dataset-history" aria-label="Revision history">
      <div className="insight-heading">
        <h3>Revision history</h3>
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          Reload history
        </Button>
      </div>
      {error && !choice && <ErrorState as="p" role="alert">{error}</ErrorState>}
      {notice && <p role="status">{notice}</p>}
      {dataset.archived_at && <p>Archived dataset — history is view only.</p>}
      {dirty && (
        <p>Save or discard unsaved changes before restoring a revision.</p>
      )}
      {running && (
        <p>
          A job is using this dataset. Wait for it to finish before restoring.
        </p>
      )}
      {history && (
        <>
          {!!history.audit?.length&&<details><summary>Audit sources</summary><p>Local source labels are not authenticated identities. Existing entries without a source stay unrecorded.</p><TableFrame label="Audit sources"><table><thead><tr><th scope="col">Action</th><th scope="col">Result</th><th scope="col">Source</th><th scope="col">Recorded reason</th></tr></thead><tbody>{history.audit.map(a=><tr key={a.id}><td>{a.action}</td><td>{a.result}</td><td>{a.actor||'Source not recorded'}</td><td>{a.reason||'—'}</td></tr>)}</tbody></table></TableFrame></details>}
          <p>
            Revision history started recording snapshots on{" "}
            {formatDate(history.recording_started_at, "date")}.
          </p>
          <small>
            Up to {formatNumber(history.snapshot_limit)} retained snapshots ·{" "}
            {formatNumber(history.snapshot_bytes / 1024 / 1024, {
              decimals: 2,
            })}{" "}
            MiB
          </small>
          <TableFrame label="Revisions">
            <table>
              <thead>
                <tr>
                  <th scope="col">Revision</th>
                  <th scope="col">Saved</th>
                  <th scope="col">Source</th>
                  <th scope="col">Changed cells</th>
                  <th scope="col">Snapshot</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.revisions.map((r) => (
                  <tr key={r.revision}>
                    <td>
                      {r.revision}
                      {r.revision === history.current_revision
                        ? " (current)"
                        : ""}
                    </td>
                    <td>
                      {r.timestamp
                        ? formatDate(r.timestamp, "datetime")
                        : "Not recorded"}
                    </td>
                    <td>
                      {r.source === "edit_save"
                        ? "Edit save"
                        : r.source === "restore"
                          ? `Restore from ${r.restored_from}`
                          : r.source === "unknown"
                            ? "Not recorded"
                            : "Import"}
                    </td>
                    <td>
                      {r.changed_cells === null
                        ? "Not recorded"
                        : formatNumber(r.changed_cells)}
                    </td>
                    <td>
                      <span className={`snapshot-status ${r.status}`}>
                        {labels[r.status]}
                      </span>
                      {r.status === "available" && (
                        <small title={r.sha256 || undefined}>
                          {formatNumber(r.row_count)} rows ·{" "}
                          {formatNumber((r.size_bytes || 0) / 1024, {
                            decimals: 0,
                          })}{" "}
                          KiB
                        </small>
                      )}
                    </td>
                    <td>
                      {r.status === "available" && (
                        <>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Preview revision ${r.revision}`}
                            onClick={() => void view(r)}
                          >
                            Preview
                          </Button>
                          <Button
                            variant="outline"
                            disabled={
                              busy || dirty || running || !!dataset.archived_at
                            }
                            aria-label={`Restore revision ${r.revision}`}
                            onClick={() => void confirm(r)}
                          >
                            Restore
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          <div className="history-pagination">
            <Button
              variant="ghost"
              disabled={!offset}
              onClick={() => setOffset((v) => Math.max(0, v - 100))}
            >
              Newer revisions
            </Button>
            <Button
              variant="ghost"
              disabled={offset + history.revisions.length >= history.total}
              onClick={() => setOffset((v) => v + 100)}
            >
              Older revisions
            </Button>
          </div>
        </>
      )}
      {preview && (
        <section
          className="revision-preview"
          aria-label={`Read-only preview of revision ${preview.revision}`}
        >
          <div className="insight-heading">
            <h3>Revision {preview.revision} — read-only preview</h3>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Close preview
            </Button>
          </div>
          <TableFrame label="Revision preview">
            <table>
              <thead>
                <tr>
                  {preview.columns.map((c) => (
                    <th scope="col" key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((value, j) => (
                      <td key={j}>
                        {value === null ? (
                          <span className="null">NULL</span>
                        ) : (
                          value
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
          <Button
            variant="ghost"
            disabled={busy || !preview.offset}
            onClick={() =>
              void view(
                { revision: preview.revision } as Revision,
                Math.max(0, preview.offset - 25),
              )
            }
          >
            Previous snapshot rows
          </Button>
          <Button
            variant="ghost"
            disabled={
              busy || preview.offset + preview.rows.length >= preview.total
            }
            onClick={() =>
              void view(
                { revision: preview.revision } as Revision,
                preview.offset + 25,
              )
            }
          >
            Next snapshot rows
          </Button>
        </section>
      )}
      {choice && (
        <Modal
          open
          title={`Restore revision ${choice.revision}?`}
          busy={busy}
          onClose={() => setChoice(null)}
          className="dataset-restore-dialog"
          footer={
            <>
              <Button autoFocus variant="outline" disabled={busy} onClick={() => setChoice(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !dependencies || dependencies.delete_blocked || dirty || !!dataset.archived_at}
                onClick={() => void restore()}
              >
                {busy ? "Restoring…" : "Create new revision"}
              </Button>
            </>
          }
        >
          <p>Dataset: {dataset.display_name||dataset.name}</p>
          <p>
            Creates revision {formatNumber((history?.current_revision || 0) + 1)} with the
            data from revision {choice.revision}. Earlier revisions are kept.
          </p>
          <p>
            Dashboards keep their saved snapshots. Existing models, run results
            and historical artifacts are not rewritten. Current profile and
            quality are recomputed for the new revision.
          </p>
          {dependencies ? (
            <ul>
              {Object.entries(dependencies.counts)
                .filter(([, n]) => n > 0)
                .map(([key, n]) => (
                  <li key={key}><details><summary>{key.replaceAll("_", " ")}: {formatNumber(n)}</summary><ul>{(dependencies.groups[key]||[]).map(item=><li key={item.id}>{item.title}</li>)}</ul></details></li>
                ))}
            </ul>
          ) : (
            <p>Checking dependencies…</p>
          )}
          {error && <ErrorState as="p" role="alert">{error}</ErrorState>}
          {dependencies?.delete_blocked && (
            <p>A job is using this dataset. Restore is blocked.</p>
          )}
        </Modal>
      )}
    </section>
  );
}
