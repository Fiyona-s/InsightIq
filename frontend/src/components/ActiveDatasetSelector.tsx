import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Database } from "lucide-react";
import { useActiveDataset, selectorDatasets } from "../lib/activeDataset";
import { displayName } from "../lib/datasetNames";
import { formatNumber } from "../lib/formatters";
import DatasetName from "./DatasetName";
export default function ActiveDatasetSelector() {
  const context = useActiveDataset(),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  // A project with no datasets has nothing to choose: the empty states on each page explain what to do.
  if (!context) return null;
  // While the list loads, keep the selector's place so the top bar does not jump when it appears (phones).
  if (context.loading && !context.datasets.length) return <div className="global-dataset-selector dataset-selector-placeholder" aria-hidden="true" />;
  if (!context.datasets.length) return null;
  const options = selectorDatasets(
      context.datasets,
      context.activeId,
      context.hideSamples,
      search,
    ),
    active = context.active;
  return (
    <div
      className="global-dataset-selector"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) && open) {
          const controls = [
            input.current,
            ...Array.from(
              root.current?.querySelectorAll<HTMLButtonElement>(
                '[role="option"]',
              ) || [],
            ),
          ].filter((v): v is HTMLInputElement | HTMLButtonElement => !!v);
          const at = controls.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? controls.length - 1
                : (at + (e.key === "ArrowDown" ? 1 : -1) + controls.length) %
                  controls.length;
          e.preventDefault();
          controls[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        disabled={context.loading}
        aria-busy={context.loading}
        className="dataset-trigger"
        aria-expanded={open}
        aria-controls="active-dataset-popup"
        title={active ? displayName(active) : "Select a dataset"}
        onClick={() => {
          setSearch("");
          setOpen((v) => !v);
        }}
      >
        <span className="sr-only">Active dataset </span>
        <Database size={16} />
        <span>
          {active ? (
            <>
              <DatasetName name={displayName(active)} />
              <small>
                {formatNumber(active.rows)} rows ·{" "}
                {formatNumber(active.columns.length)} columns
              </small>
            </>
          ) : (
            "Select a dataset"
          )}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="dataset-selector-popup" id="active-dataset-popup">
          <label>
            <span className="sr-only">Search active datasets</span>
            <input
              ref={input}
              value={search}
              placeholder="Search datasets…"
              onChange={(e) => setSearch(e.target.value)}
              aria-controls="active-dataset-options"
            />
          </label>
          <div
            role="listbox"
            id="active-dataset-options"
            aria-label="Active datasets"
          >
            {options.map((d) => (
              <button
                role="option"
                aria-selected={d.id === context.activeId}
                key={d.id}
                title={displayName(d)}
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                  void context.select(d.id);
                }}
              >
                <DatasetName name={displayName(d)} />
                <small>
                  {formatNumber(d.rows)} rows · {formatNumber(d.columns.length)}{" "}
                  columns{d.is_sample ? " · Sample" : ""}
                </small>
              </button>
            ))}
          </div>
          {!options.length && <p>No matching active datasets.</p>}
        </div>
      )}
    </div>
  );
}
