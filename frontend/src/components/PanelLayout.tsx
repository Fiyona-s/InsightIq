import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Button } from "./ui/button";

const NARROW = "(max-width: 959px)";
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(NARROW);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}
function useCollapsed(): [boolean, (value: boolean) => void] {
  const [collapsed, set] = useState(() => { try { return localStorage.getItem("insightiq-panel-collapsed") === "true"; } catch { return false; } });
  return [collapsed, (value) => { set(value); try { localStorage.setItem("insightiq-panel-collapsed", String(value)); } catch { /* optional storage */ } }];
}

/**
 * A secondary panel next to the page (Ask: past questions, Datasets: files).
 * Wide screens: a collapsible ~280px column. Phones and small tablets: the SAME panel slides in from the left,
 * opened from a button (CSS does the switch), so resizing or rotating never rebuilds it or closes what is open in it.
 * `panel` receives `close`, so choosing something can close the slide-in.
 */
export default function PanelLayout({ title, label, panel, children, className = "", hidden }: {
  title: string; label: string; panel: (close: () => void) => ReactNode; children: ReactNode; className?: string; hidden?: boolean;
}) {
  const narrow = useNarrow();
  const [collapsed, setCollapsed] = useCollapsed();
  const [open, setOpen] = useState(false);
  const side = useRef<HTMLElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const slideIn = narrow && open;
  const close = () => { setOpen(false); opener.current?.focus(); };
  useEffect(() => { if (slideIn) side.current?.querySelector<HTMLElement>(".panel-close")?.focus(); }, [slideIn]);
  useEffect(() => {
    if (!slideIn) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [slideIn]);
  function keys(event: React.KeyboardEvent) {
    if (!slideIn) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const controls = Array.from(side.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)") || []).filter((el) => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div hidden={hidden} className={"panel-layout " + (collapsed ? "panel-collapsed " : "") + className}>
    {narrow ? <Button ref={opener} variant="outline" className="panel-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>{label}</Button> : null}
    <aside ref={side} className={"side-panel" + (slideIn ? " is-open" : "")} aria-label={title}
      role={slideIn ? "dialog" : undefined} aria-modal={slideIn ? true : undefined} inert={narrow && !open} onKeyDown={keys}>
      {narrow
        ? <button type="button" className="panel-close" aria-label={`Close ${title}`} onClick={close}><X size={18} aria-hidden="true" /></button>
        : <button type="button" className="panel-toggle" aria-expanded={!collapsed} aria-label={collapsed ? `Show ${title}` : `Hide ${title}`} title={collapsed ? `Show ${title}` : `Hide ${title}`} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
        </button>}
      {(narrow || !collapsed) && <div className="panel-body">{panel(narrow ? close : () => undefined)}</div>}
    </aside>
    {slideIn ? <button type="button" className="panel-backdrop" aria-label={`Close ${title}`} tabIndex={-1} onClick={close} /> : null}
    <div className="panel-main">{children}</div>
  </div>;
}
