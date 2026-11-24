import type { Widget } from "../phase4api";

/**
 * The title shown on a dashboard tile. The owner's own text is shown exactly as saved. Only a title the
 * system generated from a column name (it contains an underscore, like "total_revenue") is shown in the
 * readable form the backend produces. A title the owner renamed (custom_title) is always shown as typed.
 */
export function tileTitle(widget: Pick<Widget, "title" | "display_title" | "custom_title" | "source">): string {
  if (widget.custom_title) return widget.custom_title;
  const saved = (widget.title || "").trim();
  if (saved && !saved.includes("_")) return saved;
  return widget.display_title || saved || widget.source?.title || "Insight note";
}
