// Internal route keys stay unchanged; visible names follow the owner-first information architecture.
export const pageLabels: Record<string, string> = {
  Overview: "Home",
  "AI Analyst": "Ask",
  "Data workspace": "Datasets",
  Dashboards: "Dashboards",
  "AutoML Studio": "Predictions",
  "Knowledge base": "Business definitions",
  "Evaluation center": "Accuracy check",
  "Run analytics": "Performance & errors",
  "Execution traces": "Execution traces",
  "Change history": "Dataset change history",
  "Backup info": "Backup info",
  People: "People",
  "Security log": "Security log",
  "Change password": "Change password",
  Settings: "Settings",
  Projects: "Projects",
  Design: "Design system",
};
/** Page headings where they differ from the short navigation label. */
const pageTitles: Record<string, string> = { "AI Analyst": "Ask your data" };
/** Pages that belong to the Admin / Developer area (hidden from owner navigation by default). */
export const adminPages = new Set(["Evaluation center", "Run analytics", "Execution traces", "Change history", "Backup info", "People", "Security log"]);
// Every earlier visible name remains a valid bookmark.
const previousLabels: Record<string, string[]> = {
  "Data workspace": ["Datasets", "My Data", "my-data"],
  "AI Analyst": ["Ask your data", "Ask InsightIQ", "ask"],
  "AutoML Studio": ["Build Models", "AutoML Studio", "predictions"],
  "Knowledge base": ["Knowledge Base", "definitions"],
  "Evaluation center": ["Check answer accuracy", "Evaluation Center", "accuracy"],
  "Run analytics": ["Performance & errors", "Run Analytics", "performance"],
  "Execution traces": ["Execution Traces"],
  "Change history": ["Audit log", "audit", "audit-log", "Change history"],
  "Backup info": ["backup", "backups"],
};
export const pageLabel = (page: string) => pageLabels[page] || page;
export const pageTitle = (page: string) => pageTitles[page] || pageLabel(page);
export const pageRoutes: Record<string, string> = {
  Overview: "overview",
  "Data workspace": "datasets",
  "AI Analyst": "analyst",
  Dashboards: "dashboards",
  "AutoML Studio": "automl",
  "Knowledge base": "knowledge",
  "Evaluation center": "evaluation",
  "Run analytics": "analytics",
  "Execution traces": "traces",
  "Change history": "change-history",
  "Backup info": "backups",
  People: "people",
  "Security log": "security-log",
  "Change password": "password",
  Settings: "settings",
  Projects: "projects",
  Design: "design",
};
const slugify = (text: string) => text.toLowerCase().replace(/&/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
export function bookmarkedPage() {
  let location = window.location.hash.slice(1) || window.location.pathname.slice(1);
  try { location = decodeURIComponent(location); } catch { /* Keep malformed bookmarks harmless. */ }
  const slug = slugify(location.replace(/\/$/, ""));
  return (
    Object.keys(pageRoutes).find((key) =>
      [pageRoutes[key], slugify(key), slugify(pageLabel(key)), slugify(pageTitle(key)), ...(previousLabels[key] || []).map(slugify)].includes(slug),
    ) || "Overview"
  );
}
