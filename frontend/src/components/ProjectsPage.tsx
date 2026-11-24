import { useAuth } from "../lib/auth";
import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { projectsApi, useProjects, type Project, type ProjectDependencies } from "../lib/projects";
import { formatDate, formatNumber } from "../lib/formatters";
import { Button, Card, DataTable, Menu, EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusChip, useToast } from "./ui";

/** Create, rename, archive (reversible) and delete projects. */
export default function ProjectsPage() {
  const canDelete = useAuth().can("owner");      // login on: deleting a project needs the Owner role; login off: as before
  const ctx = useProjects();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const ids = (ctx?.projects ?? []).map((p) => p.id).join(",");
  // Counts come from the existing read-only dependencies endpoint; they only help owners tell projects apart.
  useEffect(() => {
    if (!ids) return;
    let current = true;
    void Promise.all(ids.split(",").map((id) => projectsApi.dependencies(id).then((d) => [id, d.counts] as const).catch(() => [id, {}] as const)))
      .then((entries) => { if (current) setCounts(Object.fromEntries(entries)); });
    return () => { current = false; };
  }, [ids]);
  if (!ctx) return null;
  const count = (p: Project, key: string) => (counts[p.id] && key in counts[p.id] ? formatNumber(counts[p.id][key]) : "—");
  const active = ctx.projects.filter((p) => !p.archived_at);
  const archived = ctx.projects.filter((p) => p.archived_at);

  async function archive(project: Project, restore = false) {
    setBusy(project.id); setError("");
    try {
      await (restore ? projectsApi.restore(project.id) : projectsApi.archive(project.id));
      toast(restore ? `${project.name} restored.` : `${project.name} archived. Its data is kept and can be restored.`);
      if (!restore && project.id === ctx!.activeId) ctx!.switchTo("default");
      else await ctx!.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  const status = (p: Project) => (
    <span className="project-status">
      {p.id === ctx.activeId && <StatusChip tone="success">Current</StatusChip>}
      {p.is_default && <StatusChip>Default</StatusChip>}
      {p.archived_at && <StatusChip tone="warning">Archived</StatusChip>}
    </span>
  );
  const actions = (p: Project) => (
    <span className="project-actions">
      {!p.archived_at && p.id !== ctx.activeId && <Button size="sm" variant="outline" onClick={() => ctx.switchTo(p.id)} aria-label={`Open ${p.name}`}>Open</Button>}
      {p.archived_at && <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => void archive(p, true)} aria-label={`Restore ${p.name}`}>Restore</Button>}
      <Menu variant="ghost" label={`Actions for ${p.name}`} items={[
        ...(!p.archived_at ? [{ label: "Rename", onSelect: () => setRenaming(p) }] : []),
        ...(!p.is_default && !p.archived_at ? [{ label: "Archive", disabled: busy === p.id, onSelect: () => void archive(p) }] : []),
        ...(!p.is_default && canDelete ? [{ label: "Delete", danger: true, onSelect: () => setDeleting(p) }] : []),
      ]} />
    </span>
  );
  const columns = [
    { key: "name", header: "Project", cell: (p: Project) => <strong>{p.name}</strong> },
    { key: "datasets", header: "Datasets", numeric: true, cell: (p: Project) => count(p, "datasets") },
    { key: "dashboards", header: "Dashboards", numeric: true, cell: (p: Project) => count(p, "dashboards") },
    { key: "status", header: "Status", cell: status },
    { key: "created", header: "Created", cell: (p: Project) => (p.created_at ? formatDate(p.created_at) : "—") },
    { key: "actions", header: <span className="sr-only">Actions</span>, cell: actions },
  ];
  return (
    <div className="projects-page">
      <PageHeader title="Projects" description="A project keeps one business's datasets, questions, dashboards and models together, so each page shows only that business. Projects organise your work; they do not protect it: anyone using this computer can open any project."
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> New project</Button>} />
      {error && <ErrorState>{error}</ErrorState>}
      {ctx.loading ? <LoadingState>Loading projects…</LoadingState> : ctx.error ? <ErrorState>Could not load your projects. <Button variant="ghost" onClick={() => void ctx.refresh()}>Try again</Button></ErrorState> : (
        <>
          <Card title="Your projects" headingLevel={2}>
            <DataTable label="Projects" rows={active} rowKey={(p) => p.id} columns={columns} />
          </Card>
          <Card title="Archived" headingLevel={2} description="Archived projects are hidden from the project switcher. Their data is kept.">
            {archived.length ? <DataTable label="Archived projects" rows={archived} rowKey={(p) => p.id} columns={columns} />
              : <EmptyState>Nothing is archived.</EmptyState>}
          </Card>
        </>
      )}
      <NewProjectModal open={creating} onClose={() => setCreating(false)} onCreated={async (p) => { toast(`${p.name} created.`); await ctx.refresh(); }} />
      <RenameProjectModal project={renaming} onClose={() => setRenaming(null)} onRenamed={async (p) => { toast(`Renamed to ${p.name}.`); await ctx.refresh(); }} />
      <DeleteProjectModal project={deleting} onClose={() => setDeleting(null)} onDeleted={async (p, moved) => {
        toast(`${p.name} deleted. ${formatNumber(moved)} ${moved === 1 ? "item" : "items"} moved to the Default project.`);
        if (p.id === ctx.activeId) ctx.switchTo("default"); else await ctx.refresh();
      }} />
    </div>
  );
}

function NameModal({ open, title, label, initial, submitLabel, onClose, onSubmit }: {
  open: boolean; title: string; label: string; initial: string; submitLabel: string; onClose: () => void; onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setName(initial); setError(""); } }, [open, initial]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError("");
    try { await onSubmit(name.trim()); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} title={title} busy={busy} onClose={onClose}
      footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" form="project-name-form" disabled={busy || !name.trim()}>{submitLabel}</Button></>}>
      <form id="project-name-form" className="project-form" onSubmit={(e) => void submit(e)}>
        <label htmlFor="project-name">{label}</label>
        <input id="project-name" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="For example: Main Street shop" />
        {error && <ErrorState as="p">{error}</ErrorState>}
      </form>
    </Modal>
  );
}

export function NewProjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Project) => void | Promise<void> }) {
  return <NameModal open={open} title="New project" label="Project name" initial="" submitLabel="Create project" onClose={onClose}
    onSubmit={async (name) => { const p = await projectsApi.create(name); await onCreated(p); }} />;
}

function RenameProjectModal({ project, onClose, onRenamed }: { project: Project | null; onClose: () => void; onRenamed: (p: Project) => void | Promise<void> }) {
  return <NameModal open={!!project} title="Rename project" label="New name" initial={project?.name || ""} submitLabel="Save name" onClose={onClose}
    onSubmit={async (name) => { const p = await projectsApi.rename(project!.id, name); await onRenamed(p); }} />;
}

const LABELS: Record<string, [string, string]> = { datasets: ["dataset", "datasets"], archived_datasets: ["archived dataset", "archived datasets"], dashboards: ["dashboard", "dashboards"], questions: ["saved question", "saved questions"], saved_charts: ["saved chart", "saved charts"], experiments: ["model experiment", "model experiments"], models: ["trained model", "trained models"] };

function DeleteProjectModal({ project, onClose, onDeleted }: { project: Project | null; onClose: () => void; onDeleted: (p: Project, moved: number) => void | Promise<void> }) {
  const [deps, setDeps] = useState<ProjectDependencies | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDeps(null); setTyped(""); setError("");
    if (!project) return;
    let current = true;
    projectsApi.dependencies(project.id).then((d) => { if (current) setDeps(d); }).catch((e) => { if (current) setError((e as Error).message); });
    return () => { current = false; };
  }, [project]);
  async function remove() {
    setBusy(true); setError("");
    try { const result = await projectsApi.remove(project!.id, typed); await onDeleted(project!, result.items_moved_to_default); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const counts = deps ? Object.entries(deps.counts).filter(([, n]) => n > 0) : [];
  return (
    <Modal open={!!project} title={`Delete ${project?.name || "project"}?`} busy={busy} onClose={onClose}
      footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="danger" disabled={busy || !deps || typed !== project?.name} onClick={() => void remove()}>Delete project</Button></>}>
      {error && <ErrorState as="p">{error}</ErrorState>}
      {!deps && !error && <LoadingState as="p">Checking what is in this project…</LoadingState>}
      {deps && (
        <div className="project-delete">
          <p>{deps.on_delete}</p>
          {counts.length ? (
            <>
              <p><strong>These will move to the Default project:</strong></p>
              <ul>{counts.map(([key, n]) => <li key={key}>{formatNumber(n)} {LABELS[key] ? LABELS[key][n === 1 ? 0 : 1] : key}</li>)}</ul>
            </>
          ) : <EmptyState>This project is empty.</EmptyState>}
          <label htmlFor="project-delete-confirm">Type <strong>{project?.name}</strong> to confirm</label>
          <input id="project-delete-confirm" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

