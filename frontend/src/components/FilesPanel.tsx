import { useState } from "react";
import { FolderPlus, RefreshCw, Search, Upload } from "lucide-react";
import type { Dataset } from "../api";
import { useProjects } from "../lib/projects";
import { useActiveDataset } from "../lib/activeDataset";
import DatasetManager from "./DatasetManager";
import ProjectSwitcher from "./ProjectSwitcher";
import { NewProjectModal } from "./ProjectsPage";

/** Datasets side panel ("Files"): the active project's datasets, with import, new project and refresh at the top. */
export default function FilesPanel({ datasets, selected, query, setQuery, uploading, canManageProjects, onUpload, onRefresh, onSelect, onChanged, onNavigate, allowNavigation, onHistory, onManage, close }: {
  datasets: Dataset[]; selected: Dataset | null; query: string; setQuery: (value: string) => void; uploading: boolean; canManageProjects: boolean;
  onUpload: () => void; onRefresh: () => void; onSelect: (d: Dataset) => void; onChanged: () => Promise<void>;
  onNavigate: (m: string) => void; allowNavigation: () => boolean | Promise<boolean>; onHistory: (d: Dataset) => void; onManage: () => void; close: () => void;
}) {
  const projects = useProjects(), context = useActiveDataset();
  const [creating, setCreating] = useState(false);
  return <div className="files-panel">
    <div className="files-head">
      <h2>Files</h2>
      <div className="files-tools">
        <button type="button" className="icon-button" aria-label="Import CSV" title="Import CSV" disabled={uploading} onClick={() => { onUpload(); close(); }}><Upload size={18} aria-hidden="true" /></button>
        {canManageProjects && <button type="button" className="icon-button" aria-label="New project" title="New project" onClick={() => setCreating(true)}><FolderPlus size={18} aria-hidden="true" /></button>}
        <button type="button" className="icon-button" aria-label="Refresh files" title="Refresh files" onClick={onRefresh}><RefreshCw size={18} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="files-project"><ProjectSwitcher onManage={onManage} canManage={canManageProjects} /></div>
    {datasets.length > 1 && <label className="search"><Search size={16} aria-hidden="true" /><input placeholder="Find a dataset…" aria-label="Find a dataset" value={query} onChange={(e) => setQuery(e.target.value)} /></label>}
    <DatasetManager datasets={datasets} query={query} selected={selected} onSelect={(d) => { onSelect(d); close(); }} onChanged={onChanged} onNavigate={onNavigate} allowNavigation={allowNavigation} onHistory={(d) => { onHistory(d); close(); }} />
    {projects && <NewProjectModal open={creating} onClose={() => setCreating(false)} onCreated={async (p) => { setCreating(false); if (!context || await context.confirmEditorLeave()) projects.switchTo(p.id); }} />}
  </div>;
}
