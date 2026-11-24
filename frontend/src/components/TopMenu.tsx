import { useEffect, useRef, useState } from "react";
import { FolderOpen, KeyRound, LogOut, MoreHorizontal, Palette, Settings, Wrench } from "lucide-react";
import { ADMIN_NOTICE, useAdminTools } from "../lib/adminTools";
import { useAuth } from "../lib/auth";
import { ROLE_LABEL, pageAccess } from "../lib/access";
import { useToast } from "./ui/toast";
import { ADMIN_GROUP, modules } from "./Sidebar";
import { pageLabel } from "../lib/navigation";

/** Top-bar menu: preferences and the Admin tools switch. No account/identity is implied. */
export default function TopMenu({ onNavigate, onSignOut, current }: { onNavigate: (page: string) => void; onSignOut?: () => void; current?: string }) {
  const [open, setOpen] = useState(false);
  const admin = useAdminTools();
  const auth = useAuth();
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  const adminPages = modules.filter((m) => m.group === ADMIN_GROUP && pageAccess(m.name, auth.role).allowed && (auth.hosted || admin.enabled));
  function close() { setOpen(false); trigger.current?.focus(); }
  function go(page: string) { setOpen(false); onNavigate(page); }
  return (
    <div className="ui-menu" ref={root} onKeyDown={event => {
      if (event.key === "Escape" && open) { event.preventDefault(); close(); }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && open) {
        event.preventDefault();
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') || []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    }}>
      <button ref={trigger} type="button" className="button button-outline button-sm" aria-haspopup="menu" aria-expanded={open} aria-controls="top-menu" onClick={() => setOpen(!open)}>
        <MoreHorizontal size={18} aria-hidden="true" /> Menu
      </button>
      {open && (
        <div className="ui-menu-panel" role="menu" id="top-menu" aria-label="Menu">
          {auth.hosted && auth.user && <p className="ui-menu-note">Signed in as {auth.user.email} ({ROLE_LABEL[auth.user.role]})</p>}
          {pageAccess("Settings", auth.role).allowed && <button type="button" role="menuitem" onClick={() => go("Settings")}><Settings size={16} aria-hidden="true" /> Settings</button>}
          {!auth.hosted && <><button type="button" role="menuitemcheckbox" aria-checked={admin.enabled} onClick={() => { const next = !admin.enabled; admin.setEnabled(next); toast(next ? "Admin tools are now listed in this menu." : "Admin tools are hidden."); }}>
            <Wrench size={16} aria-hidden="true" /> Show admin tools <span className="ui-switch" aria-hidden="true" />
          </button>
          <p className="ui-menu-note">{ADMIN_NOTICE}</p></>}
          {adminPages.length > 0 && <>
            <hr className="ui-menu-separator" />
            <p className="ui-menu-heading" id="menu-admin-heading"><Wrench size={14} aria-hidden="true" /> Admin tools{auth.hosted ? " (owners only)" : ""}</p>
            {adminPages.map((m) => <button key={m.name} type="button" role="menuitem" aria-current={current === m.name ? "page" : undefined} onClick={() => go(m.name)}><m.icon size={16} aria-hidden="true" /> {pageLabel(m.name)}</button>)}
            <hr className="ui-menu-separator" />
          </>}
          {pageAccess("Projects", auth.role).allowed && <button type="button" role="menuitem" onClick={() => go("Projects")}><FolderOpen size={16} aria-hidden="true" /> Projects</button>}
          {import.meta.env.DEV && pageAccess("Design", auth.role).allowed && <button type="button" role="menuitem" onClick={() => go("Design")}><Palette size={16} aria-hidden="true" /> Design system</button>}
          {auth.hosted && <button type="button" role="menuitem" onClick={() => go("Change password")}><KeyRound size={16} aria-hidden="true" /> Change password</button>}
          {auth.hosted && <button type="button" role="menuitem" onClick={() => { setOpen(false); (onSignOut || (() => void auth.signOut()))(); }}><LogOut size={16} aria-hidden="true" /> Sign out</button>}
        </div>
      )}
    </div>
  );
}
