import {ErrorState,LoadingState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import {useDatasetGuard} from "../lib/activeDataset";
import { formatNumber } from "../lib/formatters";
import { useEffect, useRef, useState } from "react";
import { analystApi, type Dataset, type AnalysisType } from "../api";
import {
  datasetEditorApi,
  type DatasetRows,
  type DatasetRow,
} from "../datasetEditorApi";
import EditableDatasetCell from "./EditableDatasetCell";
import { Button } from "./ui/button";

type Draft = {
  updates: Record<string, Record<string, string | null>>;
  additions: DatasetRow[];
  deletions: string[];
};
type ActiveCell = {
  row: DatasetRow;
  column: string;
  value: string | null;
  token: number;
};
const empty = (): Draft => ({ updates: {}, additions: [], deletions: [] });
const cellCount = (draft: Draft) =>
  Object.values(draft.updates).reduce(
    (n, values) => n + Object.keys(values).length,
    0,
  );
const changeCount = (draft: Draft) =>
  cellCount(draft) + draft.additions.length + draft.deletions.length;
function applyCell(
  draft: Draft,
  row: DatasetRow,
  column: string,
  value: string | null,
  columns: string[],
): Draft {
  if (row.id.startsWith("new-"))
    return {
      ...draft,
      additions: draft.additions.map((r) =>
        r.id === row.id
          ? {
              ...r,
              values: r.values.map((v, i) =>
                columns[i] === column ? value : v,
              ),
            }
          : r,
      ),
    };
  let values = { ...draft.updates[row.id] };
  if (value === row.values[columns.indexOf(column)]) delete values[column];
  else values = { ...values, [column]: value };
  const updates = { ...draft.updates };
  if (Object.keys(values).length) updates[row.id] = values;
  else delete updates[row.id];
  return { ...draft, updates };
}
export default function DatasetEditor({
  dataset,
  onSaved,
  onDirty,
  showExport = true,
}: {
  dataset: Dataset;
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
  showExport?: boolean;
}) {
  useDatasetGuard("dataset-editor",()=>dirty?{title:"Unsaved dataset changes",message:"Save or discard your changes before switching datasets.",save,discard:()=>{current(null);replaceDraft(empty());replaceHistory([]);mode(false);onDirty(false)}}:null);
  const [page, setPage] = useState<DatasetRows | null>(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<Draft>(empty),
    [history, setHistory] = useState<Draft[]>([]),
    [active, setActive] = useState<ActiveCell | null>(null),
    [offset, setOffset] = useState(0),
    [sort, setSort] = useState(""),
    [mapping, setMapping] = useState<Record<string, AnalysisType>>({}),
    [suggested, setSuggested] = useState<Record<string, AnalysisType>>({}),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const readOnly=!!dataset.archived_at;
  const draftRef = useRef(draft),
    historyRef = useRef(history),
    activeRef = useRef(active),
    editingRef = useRef(false),
    generation = useRef(0),
    token = useRef(0),
    baseline = useRef<number | null>(null);
  const effective =
    active && page
      ? applyCell(draft, active.row, active.column, active.value, page.columns)
      : draft;
  const count = changeCount(effective),
    dirty = count > 0;
  const visibleRows = page
    ? [...page.rows, ...draft.additions].filter(
        (r) => !draft.deletions.includes(r.id),
      )
    : [];
  function current(next: ActiveCell | null) {
    activeRef.current = next;
    setActive(next);
  }
  function mode(next: boolean) {
    editingRef.current = next;
    setEditing(next);
  }
  function replaceDraft(next: Draft) {
    draftRef.current = next;
    setDraft(next);
  }
  function replaceHistory(next: Draft[]) {
    historyRef.current = next;
    setHistory(next);
  }
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function load(force = false) {
    const requestId = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const data = await datasetEditorApi.rows(dataset.id, offset, sort);
      if (requestId !== generation.current) return;
      if (
        !force &&
        editingRef.current &&
        baseline.current !== null &&
        data.version !== baseline.current
      ) {
        setError(
          "Dataset changed while editing. Cancel and reopen before saving.",
        );
        return;
      }
      setPage(data);
      if (!editingRef.current) {
        setMapping(data.type_mapping);
        baseline.current = data.version;
      }
      if (data.total > 0 && offset >= data.total)
        setOffset(Math.floor((data.total - 1) / 25) * 25);
    } catch (e) {
      if (requestId === generation.current) setError((e as Error).message);
    } finally {
      if (requestId === generation.current) setBusy(false);
    }
  }
  // Intentional query-boundary effect: load reads current editing refs; changing its
  // identity must not reload/cancel an inline edit. generation is a request counter, not a DOM ref.
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [dataset.id, offset, sort]);
  function change(next: Draft) {
    if (JSON.stringify(next) === JSON.stringify(draftRef.current)) return;
    replaceHistory([...historyRef.current.slice(-49), draftRef.current]);
    replaceDraft(next);
    setNotice("");
  }
  function commit(expectedToken?: number) {
    const pending = activeRef.current;
    if (
      !pending ||
      !page ||
      (expectedToken !== undefined && pending.token !== expectedToken)
    )
      return draftRef.current;
    const next = applyCell(
      draftRef.current,
      pending.row,
      pending.column,
      pending.value,
      page.columns,
    );
    current(null);
    change(next);
    return next;
  }
  async function start() {
    if (!page || editingRef.current || readOnly) return;
    mode(true);
    baseline.current = page.version;
    setMapping(page.type_mapping);
    setConfirmed(Object.keys(page.type_mapping).length === page.columns.length);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const profile = await analystApi.profile(dataset.id);
      setSuggested(
        Object.fromEntries(
          profile.columns.map((c) => [c.name, c.suggested_type]),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(row: DatasetRow, column: string) {
    if(readOnly)return;
    const next = commit();
    if (!editingRef.current) void start();
    const value = row.id.startsWith("new-")
      ? next.additions.find((r) => r.id === row.id)!.values[
          page!.columns.indexOf(column)
        ]
      : column in (next.updates[row.id] || {})
        ? next.updates[row.id][column]
        : row.values[page!.columns.indexOf(column)];
    current({ row, column, value, token: ++token.current });
  }
  function finishCell(expectedToken: number, direction?: number) {
    const pending = activeRef.current;
    if (!pending || pending.token !== expectedToken) return false;
    commit(expectedToken);
    if (direction && page) {
      const index =
        visibleRows.findIndex((r) => r.id === pending.row.id) *
          page.columns.length +
        page.columns.indexOf(pending.column) +
        direction;
      const row = visibleRows[Math.floor(index / page.columns.length)];
      if (row) {
        open(row, page.columns[index % page.columns.length]);
        return true;
      }
    }
    return false;
  }
  function cancel() {
    if (
      changeCount(commit()) &&
      !window.confirm("Discard all unsaved dataset changes?")
    )
      return;
    current(null);
    replaceDraft(empty());
    replaceHistory([]);
    mode(false);
    setNotice("");
    setError("");
    void load(true);
  }
  async function save() {
    const batch = commit();
    if (
      readOnly || !page ||
      !changeCount(batch) ||
      !window.confirm("Save all dataset changes as a new version?")
    )
      return false;
    setBusy(true);
    setError("");
    try {
      await datasetEditorApi.save(dataset.id, {
        expected_version: page.version,
        types_confirmed: confirmed,
        type_mapping: mapping,
        updates: Object.entries(batch.updates).map(([id, values]) => ({
          id,
          values,
        })),
        additions: batch.additions.map((r) =>
          Object.fromEntries(page.columns.map((c, i) => [c, r.values[i]])),
        ),
        deletions: batch.deletions,
      });
      replaceDraft(empty());
      replaceHistory([]);
      mode(false);
      setNotice("Changes saved successfully.");
      await load(true);
      // Refresh the source profile as well as the preview/catalog. No retrieval or provider calls.
      const profile = await analystApi.profile(dataset.id);
      setSuggested(
        Object.fromEntries(
          profile.columns.map((c) => [c.name, c.suggested_type]),
        ),
      );
      onSaved();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dataset-editor" aria-label="Interactive dataset editor">
      <div className="editor-toolbar">
        <strong>
          {page ? <>{dirty ? "Unsaved changes" : "Saved"} · Version {formatNumber(page.version)}</> : "Preview"}
        </strong>
        {showExport && <a href={`/api/datasets/${dataset.id}/export`} download title="Latest saved CSV; unsaved edits are not included">
          Download CSV
        </a>}
      </div>
      {page?.saved_at && (
        <small>Last saved {formatDate(page.saved_at, "datetime")}</small>
      )}
      <div className="editor-toolbar edit-mode-toolbar">
        {readOnly?<span>Archived dataset — view only.</span>:<Button role="switch" aria-checked={editing} aria-label="Edit mode" variant={editing?'default':'outline'} disabled={busy||!page} onClick={()=>{if(editing)cancel();else void start()}}>Edit mode <span aria-hidden="true">{editing?'On':'Off'}</span></Button>}
        {editing&&<Button variant="outline" disabled={busy||draft.additions.length>=1000} onClick={()=>change({...draft,additions:[...draft.additions,{id:`new-${crypto.randomUUID()}`,values:page!.columns.map(()=>null)}]})}>Add Row</Button>}
      </div>
      {editing&&!dirty&&<span role="status">No unsaved changes</span>}
      {editing&&dirty&&<div className="editor-action-bar" role="region" aria-label="Unsaved dataset changes"><strong>{formatNumber(cellCount(effective))} changed {cellCount(effective)===1?'cell':'cells'}</strong>{!!draft.additions.length&&<span>{formatNumber(draft.additions.length)} added rows</span>}{!!draft.deletions.length&&<span>{formatNumber(draft.deletions.length)} removed rows</span>}
          <>
            <Button
              disabled={busy || !dirty || !confirmed}
              onClick={() => void save()}
            >
              Save changes
            </Button>
            <Button variant="outline" disabled={busy} onClick={cancel}>
              Discard
            </Button>
            <Button
              variant="ghost"
              disabled={busy || (!history.length && !active)}
              onClick={() => {
                commit();
                const previous =
                  historyRef.current[historyRef.current.length - 1];
                if (previous) {
                  replaceDraft(previous);
                  replaceHistory(historyRef.current.slice(0, -1));
                }
                setError("");
              }}
            >
              Undo
            </Button>
            <span role="status" className="sr-only">
              {count
                ? `${formatNumber(count)} unsaved ${count === 1 ? "change" : "changes"}`
                : "No unsaved changes"}
            </span>
          </>
      </div>}
      {editing&&<p id="dataset-edit-help" className="editor-help">Click a cell to edit. Enter applies, Escape cancels.{!confirmed&&" Confirm column types before saving."}</p>}
      {error && (
        <ErrorState as="div" role="alert" className="alert">
          {error}
          {!page && (
            <Button variant="ghost" onClick={() => void load()}>
              Retry preview
            </Button>
          )}
        </ErrorState>
      )}
      {notice && (
        <div role="status" className="success">
          {notice}
        </div>
      )}
      {editing && (
        <details open={!confirmed}>
          <summary>Column types</summary>
          <p>
            Check column types before saving. Missing values stay NULL;
            empty text stays empty.
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              setMapping(suggested);
              setConfirmed(false);
            }}
          >
            Use suggested types
          </Button>
          <div className="editor-mappings">
            {page?.columns.map((c) => (
              <label key={c}>
                {c}
                <select
                  aria-label={`Type for ${c}`}
                  value={mapping[c] || "VARCHAR"}
                  onChange={(e) => {
                    setMapping({
                      ...mapping,
                      [c]: e.target.value as AnalysisType,
                    });
                    setConfirmed(false);
                  }}
                >
                  {[
                    "VARCHAR",
                    "BIGINT",
                    "DOUBLE",
                    "DATE",
                    "TIMESTAMP",
                    "BOOLEAN",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setMapping(
                Object.fromEntries(
                  page!.columns.map((c) => [c, mapping[c] || "VARCHAR"]),
                ),
              );
              setConfirmed(true);
            }}
          >
            Confirm types
          </Button>
        </details>
      )}
      {busy && <LoadingState as="p" role="status">Loading dataset…</LoadingState>}
      {page && (
        <>
          <label>
            Sort rows{" "}
            <select
              aria-label="Sort editor rows"
              value={sort}
              disabled={busy}
              onChange={(e) => {
                commit();
                setSort(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Original order</option>
              {page.columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="table-scroll editor-scroll" tabIndex={0}>
            <table aria-label="Editable dataset">
              <thead>
                <tr>
                  <th scope="col" className="row-number">#</th>
                  {page.columns.map((c) => (
                    <th scope="col" key={c}>{c}</th>
                  ))}
                  {editing && <th scope="col">Row actions</th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r, ri) => (
                  <tr key={r.id} data-row-id={r.id}>
                    <td className="row-number">{formatNumber(offset + ri + 1)}</td>
                    {page.columns.map((c, ci) => {
                      const changes = effective.updates[r.id] || {};
                      const added = r.id.startsWith("new-");
                      const newRow = effective.additions.find(
                        (a) => a.id === r.id,
                      );
                      const value = added
                        ? newRow!.values[ci]
                        : c in changes
                          ? changes[c]
                          : r.values[ci];
                      const selected =
                        active?.row.id === r.id && active.column === c;
                      const activeToken = selected ? active.token : undefined;
                      return (
                        <EditableDatasetCell
                          key={c}
                          rowNumber={offset + ri + 1}
                          column={c}
                          type={mapping[c] || "VARCHAR"}
                          original={r.values[ci]}
                          value={value}
                          active={selected}
                          changed={c in changes}
                          added={added}
                          disabled={busy||readOnly}
                          onOpen={() => open(r, c)}
                          onChange={(value) => {
                            const pending = activeRef.current;
                            if (pending && pending.token === activeToken)
                              current({ ...pending, value });
                          }}
                          onCommit={(direction) => {
                            if (activeToken !== undefined)
                              return finishCell(activeToken, direction);
                            return false;
                          }}
                          onCancel={() => current(null)}
                          onNull={() => {
                            const next = commit();
                            change(applyCell(next, r, c, null, page.columns));
                          }}
                        />
                      );
                    })}
                    {editing && (
                      <td>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Delete row ${offset + ri + 1}`}
                          onClick={() => {
                            commit();
                            if (
                              !window.confirm(
                                "Delete this row when changes are saved?",
                              )
                            )
                              return;
                            const next = draftRef.current;
                            const updates = { ...next.updates };
                            delete updates[r.id];
                            change(
                              r.id.startsWith("new-")
                                ? {
                                    ...next,
                                    additions: next.additions.filter(
                                      (a) => a.id !== r.id,
                                    ),
                                  }
                                : {
                                    ...next,
                                    updates,
                                    deletions: [...next.deletions, r.id],
                                  },
                            );
                          }}
                        >
                          Delete Row
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!page.total && !draft.additions.length && (
              <div className="empty-results">
                No records. This dataset contains column headers only.
              </div>
            )}
          </div>
          <div className="pagination">
            <span>
              {formatNumber(page.total)} saved rows · {formatNumber(cellCount(effective))} modified{" "}
              {cellCount(effective) === 1 ? "cell" : "cells"} ·{" "}
              {formatNumber(draft.additions.length)} added · {formatNumber(draft.deletions.length)} deleted
            </span>
            <Button
              variant="ghost"
              disabled={busy || !offset}
              onClick={() => {
                commit();
                setOffset(Math.max(0, offset - 25));
              }}
            >
              Previous rows
            </Button>
            <Button
              variant="ghost"
              disabled={busy || offset + 25 >= page.total}
              onClick={() => {
                commit();
                setOffset(offset + 25);
              }}
            >
              Next rows
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
