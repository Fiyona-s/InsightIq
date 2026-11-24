import { useAuth } from "../lib/auth";
import { StatusChip } from "./ui/layout";
import { ErrorState } from "./WorkspaceStates";
import { formatDate, formatNumber } from "../lib/formatters";
import { useActiveDataset } from "../lib/activeDataset";
import { useState } from "react";
import type { Dataset } from "../api";
import { lifecycleApi } from "../datasetLifecycleApi";
import { displayName } from "../lib/datasetNames";
import DatasetLifecycleDialog from "./DatasetLifecycleDialog";
import { Button } from "./ui/button";
import { Menu, type MenuItem } from "./ui/menu";
import { TableFrame } from "./ui/data";

/**
 * Table-first list of the project's datasets (Stage 3). Every action the old list offered is
 * still here: select, rename (double-click or menu), archive/restore, delete, bulk archive/delete,
 * filter, hide samples. Download CSV and Version history moved into each row's menu.
 */
export default function DatasetManager({ datasets, query, selected, onSelect, onChanged, onNavigate, allowNavigation, onHistory }: {
  datasets: Dataset[]; query: string; selected: Dataset | null; onSelect: (d: Dataset) => void; onChanged: () => Promise<void>;
  onNavigate: (m: string) => void; allowNavigation: () => boolean | Promise<boolean>; onHistory: (d: Dataset) => void;
}) {
  const globalDataset = useActiveDataset();
  const canDelete = useAuth().can("owner");      // login on: deleting datasets needs the Owner role; login off: as before
  const [filter, setFilter] = useState<"Active" | "Archived" | "All">("Active"),
    [localHideSamples, setLocalHideSamples] = useState(() => { try { return localStorage.getItem("insightiq-hide-samples") === "true"; } catch { return false; } }),
    [checked, setChecked] = useState<string[]>([]), [editing, setEditing] = useState(""), [draft, setDraft] = useState(""),
    [error, setError] = useState(""), [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState<{ datasets: Dataset[]; action: "archive" | "delete"; bulk: boolean } | null>(null);
  const hideSamples = globalDataset?.hideSamples ?? localHideSamples;
  const setHideSamples = globalDataset?.setHideSamples ?? setLocalHideSamples;
  const hasSamples = datasets.some((d) => d.is_sample);
  const filtered = datasets.filter((d) => (filter === "All" || (filter === "Archived" ? !!d.archived_at : !d.archived_at)) && (!hideSamples || !d.is_sample) && (displayName(d) + " " + d.name).toLowerCase().includes(query.toLowerCase()));
  // Selection belongs to the currently filtered view; hidden rows are never acted on.
  const selectedRows = filtered.filter((d) => checked.includes(d.id));
  const duplicate = editing && draft.trim() && datasets.some((d) => d.id !== editing && displayName(d).toLocaleLowerCase() === draft.trim().toLocaleLowerCase());
  const several = datasets.length > 1;
  function rename(d: Dataset) { setEditing(d.id); setDraft(d.display_name || ""); setError(""); }
  async function save(id: string) {
    if (busy) return;
    const name = draft.trim();
    if (name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(draft)) { setError("Use at most 120 characters without control characters."); return; }
    setBusy(true); setError("");
    try { await lifecycleApi.rename(id, draft); await onChanged(); setEditing(""); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function markSample(rows: Dataset[], value: boolean) {
    if (busy || !rows.length) return;
    setBusy(true); setError("");
    try { await lifecycleApi.bulkSample(rows.map((d) => d.id), value); await onChanged(); setChecked([]); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function open(rows: Dataset[], action: "archive" | "delete", bulk = false) { if (await allowNavigation()) setDialog({ datasets: rows, action, bulk }); }
  function rowMenu(d: Dataset): MenuItem[] {
    return [
      { label: "Rename", onSelect: () => rename(d) },
      { label: "Download CSV", href: `/api/datasets/${d.id}/export`, download: true, title: "Latest saved CSV; unsaved edits are not included" },
      { label: "Version history", onSelect: () => onHistory(d) },
      { label: d.is_sample ? "Not a sample" : "Mark as sample", disabled: busy, onSelect: () => void markSample([d], !d.is_sample) },
      d.archived_at
        ? { label: "Restore", disabled: busy, onSelect: async () => { if (!await allowNavigation()) return; setBusy(true); void lifecycleApi.restore(d.id).then(onChanged).catch((e) => setError(e.message)).finally(() => setBusy(false)); } }
        : { label: "Archive", onSelect: () => void open([d], "archive") },
      ...(canDelete ? [{ label: "Delete", danger: true, onSelect: () => void open([d], "delete") }] : []),
    ];
  }
  return <section className="dataset-management" aria-label="Manage datasets">
    <div className="dataset-toolbar">
      <label className="lifecycle-check show-archived"><input type="checkbox" checked={filter === "All"} onChange={(e) => { setFilter(e.target.checked ? "All" : "Active"); setChecked([]); }} /> Show archived</label>
      {filtered.some((d) => d.is_sample) && <Button variant="outline" disabled={busy} onClick={() => setChecked(filtered.filter((d) => d.is_sample).map((d) => d.id))}>Select all samples</Button>}
      {hasSamples && <label className="lifecycle-check"><input type="checkbox" checked={hideSamples} onChange={(e) => { setHideSamples(e.target.checked); setChecked([]); try { localStorage.setItem("insightiq-hide-samples", String(e.target.checked)); } catch { /* optional storage */ } }} /> Hide sample data</label>}
    </div>
    <TableFrame label="Datasets" className="dataset-table-frame">
      <table className="ui-table dataset-table">
        <thead>
          <tr>
            {several && <th scope="col" className="dataset-check-cell"><input type="checkbox" aria-label="Select all visible datasets" checked={!!filtered.length && selectedRows.length === filtered.length} disabled={!filtered.length} onChange={(e) => setChecked(e.target.checked ? filtered.map((d) => d.id) : [])} /></th>}
            <th scope="col">Name</th><th scope="col" className="num">Rows</th><th scope="col" className="num hide-narrow">Columns</th><th scope="col" className="hide-narrow">Added</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((d) => <tr key={d.id} className={(d.archived_at ? "archived " : "") + (selected?.id === d.id ? "selected" : "")} aria-selected={selected?.id === d.id}>
            {several && <td className="dataset-check-cell"><input type="checkbox" aria-label={`Select ${displayName(d)}`} checked={checked.includes(d.id)} onChange={(e) => setChecked((ids) => e.target.checked ? [...ids, d.id] : ids.filter((id) => id !== d.id))} /></td>}
            <th scope="row" className="dataset-name-cell">
              {editing === d.id
                ? <div className="dataset-inline-rename"><label>Dataset display name<input autoFocus aria-label="Dataset display name" placeholder={d.name} value={draft} disabled={busy} onChange={(e) => { setDraft(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(d.id); } if (e.key === "Escape") { e.stopPropagation(); setEditing(""); setError(""); } }} /></label><small>Leave empty to use {d.name}.</small>{duplicate && <p role="status">Another dataset uses this display name.</p>}{error && <ErrorState as="p" role="alert">{error}</ErrorState>}<Button disabled={busy} onClick={() => void save(d.id)}>Save name</Button><Button variant="ghost" disabled={busy} onClick={() => setEditing("")}>Cancel rename</Button></div>
                : <button type="button" className={selected?.id === d.id ? "dataset selected" : "dataset"} title={d.name} onClick={() => onSelect(d)} onDoubleClick={() => rename(d)}>
                  <span className="dataset-full-name" title={displayName(d)}>{displayName(d)}</span>
                  {d.display_name && d.display_name !== d.name && <small className="dataset-file-name">{d.name}</small>}
                </button>}
              {editing !== d.id && <small className="dataset-dims" aria-hidden="true">{formatNumber(d.rows)} × {formatNumber(d.columns.length)}</small>}
              {d.is_sample && <StatusChip className="sample-badge">Sample</StatusChip>}{d.archived_at && <StatusChip>Archived</StatusChip>}
            </th>
            <td className="num">{formatNumber(d.rows)}</td>
            <td className="num hide-narrow">{formatNumber(d.columns.length)}</td>
            <td className="hide-narrow">{formatDate(d.created_at, "date", { year: "numeric", month: "short", day: "numeric" })}</td>
            <td className="dataset-actions-cell"><Menu variant="ghost" label={`Actions for ${displayName(d)}`} items={rowMenu(d)} /></td>
          </tr>)}
          {!filtered.length && <tr><td colSpan={several ? 6 : 5}>{query ? "No matching datasets" : "No datasets in this view."}</td></tr>}
        </tbody>
      </table>
    </TableFrame>
    {error && !editing && <ErrorState as="p" role="alert">{error}</ErrorState>}
    {!!selectedRows.length && <div className="dataset-bulk-bar" role="region" aria-label="Selected dataset actions"><strong>{formatNumber(selectedRows.length)} selected</strong><Button disabled={busy || selectedRows.every((d) => !!d.archived_at)} onClick={() => void open(selectedRows, "archive", true)}>Archive</Button><Button variant="outline" disabled={busy || selectedRows.every((d) => d.is_sample)} onClick={() => void markSample(selectedRows, true)}>Mark as sample</Button><Button variant="outline" disabled={busy || selectedRows.every((d) => !d.is_sample)} onClick={() => void markSample(selectedRows, false)}>Not a sample</Button>{canDelete && <Button variant="outline" onClick={() => void open(selectedRows, "delete", true)}>Delete</Button>}<Button variant="ghost" onClick={() => setChecked([])}>Clear</Button></div>}
    {dialog && <DatasetLifecycleDialog datasets={dialog.datasets} action={dialog.action} bulkAction={dialog.bulk} onClose={() => setDialog(null)} onChanged={async () => { await onChanged(); setChecked([]); }} onNavigate={onNavigate} />}
  </section>;
}
