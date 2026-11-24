import { useEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import type { AnalysisType } from "../api";

export function displayCell(value: string | null) {
  return value === null ? "NULL" : value === "" ? "Empty text" : value;
}

export default function EditableDatasetCell({
  rowNumber,
  column,
  type,
  original,
  value,
  active,
  changed,
  added,
  disabled,
  onOpen,
  onChange,
  onCommit,
  onCancel,
  onNull,
}: {
  rowNumber: number;
  column: string;
  type: AnalysisType;
  original: string | null;
  value: string | null;
  active: boolean;
  changed: boolean;
  added: boolean;
  disabled: boolean;
  onOpen: () => void;
  onChange: (value: string) => void;
  onCommit: (direction?: number) => boolean;
  onCancel: () => void;
  onNull: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active && !disabled) {
      input.current?.focus();
      input.current?.select();
    }
  }, [active, disabled]);
  const restoreFocus = () =>
    requestAnimationFrame(() => button.current?.focus());
  return (
    <td
      className={changed || added ? "edited-cell" : undefined}
      data-modified={changed || undefined}
    >
      {active ? (
        <textarea
          ref={input}
          disabled={disabled}
          aria-label={`Row ${rowNumber}, ${column}`}
          aria-describedby="dataset-edit-help"
          inputMode={
            type === "BIGINT" || type === "DOUBLE" ? "decimal" : "text"
          }
          placeholder={
            value === null ? "NULL" : type === "DATE" ? "YYYY-MM-DD" : ""
          }
          value={value ?? ""}
          maxLength={65536}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
              restoreFocus();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onCommit();
              restoreFocus();
            } else if (e.key === "Tab") {
              e.preventDefault();
              if (!onCommit(e.shiftKey ? -1 : 1)) restoreFocus();
            }
          }}
        />
      ) : (
        <button
          ref={button}
          className="editor-cell-value"
          disabled={disabled}
          title={`Edit row ${rowNumber}, ${column} (${type})`}
          onClick={onOpen}
        >
          <span className={value === null ? "null" : ""}>
            {displayCell(value)}
          </span>
          <Pencil size={13} aria-hidden="true" />
        </button>
      )}
      {changed && !added && (
        <small className="editor-original">
          <span>Original: {displayCell(original)}</span>
          <span>Edited: {displayCell(value)}</span>
        </small>
      )}
      {(active || changed || added) && (
        <button
          disabled={disabled}
          className="null-control"
          aria-label={`Set row ${rowNumber} ${column} to NULL`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onNull}
        >
          Set NULL
        </button>
      )}
    </td>
  );
}
