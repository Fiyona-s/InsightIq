import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * Wraps any wide content (usually a <table>) so it scrolls inside its own box instead of
 * pushing the page sideways on small screens. Keyboard-focusable so the region can be scrolled.
 */
export function TableFrame({ label, className, children, ...props }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div {...props} className={cn("ui-table-frame table-scroll", className)} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
}

/** Simple, accessible table for new code. Existing tables use TableFrame + class "ui-table". */
export function DataTable<Row>({ label, columns, rows, rowKey, caption, empty = "Nothing to show yet." }: {
  label: string; columns: Column<Row>[]; rows: Row[]; rowKey: (row: Row, index: number) => string;
  caption?: ReactNode; empty?: ReactNode;
}) {
  return (
    <TableFrame label={label}>
      <table className="ui-table">
        {caption && <caption className="ui-table-caption">{caption}</caption>}
        <thead>
          <tr>{columns.map(c => <th key={c.key} scope="col" className={c.numeric ? "num" : undefined}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={columns.length}>{empty}</td></tr>
            : rows.map((row, i) => (
              <tr key={rowKey(row, i)}>
                {columns.map(c => <td key={c.key} className={c.numeric ? "num" : undefined}>{c.cell(row)}</td>)}
              </tr>
            ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
