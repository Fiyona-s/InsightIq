import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "./button";
import { cn } from "../../lib/utils";

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  /** Renders a link (e.g. a download) instead of a button. */
  href?: string;
  download?: boolean | string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

/**
 * Small "more actions" menu. The trigger is a real button (aria-haspopup="menu"); items are
 * role="menuitem"; Escape and outside clicks close it and Escape returns focus to the trigger.
 * Nothing here is hidden behind hover, so keyboard and touch users reach every action.
 */
export function Menu({ items, label = "More actions", trigger, align = "end", className, variant = "outline" }: {
  items: MenuItem[]; label?: string; trigger?: ReactNode; align?: "start" | "end"; className?: string; variant?: "outline" | "ghost" | "default";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  // The list is position: fixed so a table or card with overflow can never clip it. It opens below the
  // button, or above it when there is no room, and follows the button if the page scrolls or resizes.
  const position = () => {
    if (!button.current) return;
    const rect = button.current.getBoundingClientRect(), height = list.current?.offsetHeight ?? 0;
    const below = window.innerHeight - rect.bottom, flip = below < height + 8 && rect.top > below;
    setPlace({
      ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      ...(align === "start" ? { left: Math.max(8, rect.left) } : { right: Math.max(8, window.innerWidth - rect.right) }),
    });
  };
  useLayoutEffect(() => { if (open) position(); }, [open, align]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open, align]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); if (root.current?.contains(document.activeElement) || list.current?.contains(document.activeElement)) button.current?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus(); }, [open]);
  function key(event: React.KeyboardEvent) {
    const nodes = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); nodes[(at + 1) % nodes.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); nodes[(at - 1 + nodes.length) % nodes.length]?.focus(); }
    else if (event.key === "Tab") setOpen(false);
  }
  return (
    <div className={cn("ui-menu", className)} ref={root} onKeyDown={key}>
      <Button ref={button} variant={variant} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} onClick={() => setOpen(v => !v)}>
        {trigger ?? <MoreHorizontal size={18} aria-hidden="true" />}
      </Button>
      {open && createPortal(
        <div ref={list} style={place} className="ui-menu-list" role="menu" id={id} aria-label={label}>
          {items.map(item => {
            const common = { role: "menuitem" as const, className: cn("ui-menu-item", item.danger && "ui-menu-danger"), title: item.title, "aria-disabled": item.disabled || undefined };
            if (item.href && !item.disabled)
              return <a key={item.label} {...common} href={item.href} download={item.download} onClick={() => setOpen(false)}>{item.label}</a>;
            return (
              <button key={item.label} type="button" {...common} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect?.(); }}>{item.label}</button>
            );
          })}
        </div>
      , (button.current?.closest<HTMLElement>("dialog, main, header, nav, aside") ?? document.querySelector<HTMLElement>(".app") ?? document.body))}
    </div>
  );
}
