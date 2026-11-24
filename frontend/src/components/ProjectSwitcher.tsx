import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen, Plus, Settings2 } from "lucide-react";
import { useProjects } from "../lib/projects";
import { useActiveDataset } from "../lib/activeDataset";
import { NewProjectModal } from "./ProjectsPage";

/** Top-bar project switcher: the project is the main context; the dataset is chosen within it. */
export default function ProjectSwitcher({ onManage, canManage = true }: { onManage: () => void; canManage?: boolean }) {
  const projects = useProjects();
  const datasets = useActiveDataset();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[aria-checked="true"],[role^="menuitem"]')?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  if (!projects) return null;
  const name = projects.active?.name || (projects.loading ? "Loading…" : "Default project");
  const choices = projects.projects.filter((p) => !p.archived_at);
  async function choose(id: string) {
    setOpen(false);
    if (id === projects!.activeId) return;
    if (datasets && !(await datasets.confirmEditorLeave())) return;
    projects!.switchTo(id);
  }
  return (
    <div className="ui-menu project-switcher" ref={root} onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && open) {
        event.preventDefault();
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') || []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    }}>
      <button ref={trigger} type="button" className="project-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls="project-menu"
        onClick={() => setOpen(!open)}>
        <FolderOpen size={18} aria-hidden="true" />
        <span className="project-trigger-text"><small>Project</small>{" "}<strong>{name}</strong></span>
        <span className="sr-only">, change project</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="ui-menu-panel project-menu" role="menu" id="project-menu" aria-label="Projects">
          {choices.map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === projects.activeId} onClick={() => void choose(p.id)}>
              <span className="project-check" aria-hidden="true">{p.id === projects.activeId && <Check size={16} />}</span>{p.name}
            </button>
          ))}
          {canManage && <>
          <hr className="ui-menu-separator" />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setCreating(true); }}><Plus size={16} aria-hidden="true" /> New project</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onManage(); }}><Settings2 size={16} aria-hidden="true" /> Manage projects</button></>}
        </div>
      )}
      <NewProjectModal open={creating} onClose={() => setCreating(false)} onCreated={(p) => void choose(p.id)} />
    </div>
  );
}
