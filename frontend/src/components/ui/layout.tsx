import { createElement, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/** One heading per page. Put at most one primary Button in `actions`. */
export function PageHeader({ title, description, actions, className, id }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; id?: string;
}) {
  return (
    <div className={cn("ui-page-header page-title", className)}>
      <div>
        <h1 id={id}>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </div>
  );
}

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "article" | "aside" | "form";
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; headingLevel?: 2 | 3;
};
export function Card({ as = "section", title, description, actions, headingLevel = 2, className, children, ...props }: CardProps) {
  const heading = title ? createElement(`h${headingLevel}`, null, title) : null;
  return createElement(as, { ...props, className: cn("ui-card", className) },
    (title || actions) && (
      <div className="ui-card-header">
        <div>{heading}{description && <p>{description}</p>}</div>
        {actions}
      </div>
    ),
    children);
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
export function StatusChip({ tone = "neutral", children, className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span {...props} className={cn("ui-chip", `ui-chip-${tone}`, className)}>{children}</span>;
}

/** Consistent colour for run/job states across pages. */
export function statusTone(status: string): Tone {
  if (["succeeded", "completed", "success"].includes(status)) return "success";
  if (["failed", "error"].includes(status)) return "danger";
  if (["clarification", "needs_clarification"].includes(status)) return "warning";
  if (["queued", "running", "generating", "executing", "preparing"].includes(status)) return "info";
  return "neutral";
}

export function Skeleton({ width = "100%", height = 16, className, label }: { width?: number | string; height?: number | string; className?: string; label?: string }) {
  return <span role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    className={cn("ui-skeleton", className)} style={{ width, height }} />;
}
