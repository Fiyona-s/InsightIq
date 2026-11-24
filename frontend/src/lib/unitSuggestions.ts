/**
 * Name hints for what a number column might be. These are ONLY a pre-selected "suggested" value in
 * the confirmation card and Business definitions (decision 2026-11-20): nothing is shown as money or a
 * percentage until the owner confirms it. Never used for display or calculation.
 */
const MONEY = new Set("revenue revenues sales sale amount amounts price prices cost costs profit profits income expense expenses spend spending fee fees charge charges salary salaries wage wages payment payments budget turnover mrr arr gmv earnings balance".split(" "));
const NOT_MONEY = new Set("pct percent percentage rate ratio count counts qty quantity id ids num number days day age score rank index code flag year month week".split(" "));
const PERCENT = new Set(["pct", "percent", "percentage"]);

export type UnitChoice = "money" | "percent" | "neither";

export function suggestUnit(name: string): UnitChoice {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (parts.some((p) => PERCENT.has(p))) return "percent";
  if (parts.some((p) => MONEY.has(p)) && !parts.some((p) => NOT_MONEY.has(p))) return "money";
  return "neither";
}
