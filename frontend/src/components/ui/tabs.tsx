import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface TabItem { value: string; label: ReactNode; icon?: ReactNode; id?: string }

/** Accessible tablist (arrow keys, Home/End). The caller renders the matching role="tabpanel". */
export function Tabs({ items, value, onChange, label, panelId, className }: {
  items: TabItem[]; value: string; onChange: (value: string) => void; label: string; panelId?: string; className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function key(event: KeyboardEvent, index: number) {
    const last = items.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].value);
  }
  return (
    <div role="tablist" aria-label={label} className={cn("ui-tabs", className)}>
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={el => { refs.current[index] = el; }}
          id={item.id}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={item.value === value}
          aria-controls={panelId}
          tabIndex={item.value === value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={event => key(event, index)}
        >
          {item.icon}{item.label}
        </button>
      ))}
    </div>
  );
}
