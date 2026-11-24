import { createElement, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

type Props = HTMLAttributes<HTMLElement> & { as?: "div" | "p" | "span" | "section"; children?: ReactNode; details?: string };

/** Inline loading message (announced politely). Use Skeleton for layout placeholders. */
export function LoadingState({ as = "div", className = "", children = "Loading…", ...props }: Props) {
  return createElement(as, { role: "status", "aria-live": "polite", ...props, className: cn("state-loading ui-loading", className) }, children);
}

/**
 * Empty state. Inline by default (one sentence). Pass `title` (and optionally `icon`/`action`)
 * for the block version used when a whole panel or page has nothing to show yet.
 */
export function EmptyState({ as, className = "", children, title, icon, action, ...props }: Props & { title?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  if (!title) return createElement(as || "p", { ...props, className: cn("state-empty ui-empty", className) }, children);
  return createElement(as || "section", { ...props, className: cn("state-empty ui-empty ui-empty-block", className) },
    icon && <span className="ui-empty-icon" aria-hidden="true">{icon}</span>,
    <h2>{title}</h2>,
    children && <p>{children}</p>,
    action);
}

/** Error with optional technical details tucked away. */
export function ErrorState({ as = "div", className = "", children, details, ...props }: Props) {
  return createElement(as, { role: "alert", ...props, className: cn("state-error ui-error alert", className) },
    children,
    details && <details><summary>View details</summary><pre>{details}</pre></details>);
}
