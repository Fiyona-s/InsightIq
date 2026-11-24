/**
 * Approved fix 3b: DISPLAY-ONLY rounding for non-currency numbers.
 *
 * - Never changes stored values, exports, calculations or currency handling.
 * - Currency amounts keep going through the unchanged `displayMoney` (lib/currency.tsx).
 * - Exact values stay available: data tables put the exact value in a tooltip, CSV/JSON exports
 *   are unchanged, and evaluation diffs (which must show exact values) do not use this.
 */
import { displayMoney } from "./currency";
import { formatNumber } from "./formatters";

type Money = Parameters<typeof displayMoney>[1];
type Display = Parameters<typeof displayMoney>[2];

/** Rounded for reading: whole numbers as-is, |x| ≥ 1 to 2 decimals, |x| < 1 to 4 significant digits. */
export function formatDisplayNumber(value: unknown, locale?: string | null): string {
  if (value === null || value === undefined || value === "") return formatNumber(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return formatNumber(value); // exact big integers
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return formatNumber(value);
  if (Math.abs(n) >= 1e15 || Number.isInteger(n)) return formatNumber(value);
  const options: Intl.NumberFormatOptions = Math.abs(n) >= 1
    ? { maximumFractionDigits: 2 }
    : { maximumSignificantDigits: 4 };
  return new Intl.NumberFormat(locale || "en-US", options).format(n);
}

const NUMERIC = /INT|DOUBLE|FLOAT|DECIMAL|REAL|NUMERIC/i;

/**
 * Formats one result value for display. Columns with a confirmed currency are handed to the
 * unchanged currency formatter; other numeric values are rounded for display only.
 */
export function displayAmount(value: unknown, money?: Money, state?: Display, columnType?: string, percent?: boolean): string {
  if (money?.currency && !money.mixed) return displayMoney(value, money, state, columnType);
  if (percent === true && value != null && value !== "" && Number.isFinite(Number(value)))
    return formatDisplayNumber(value, state?.locale) + "%";
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && NUMERIC.test(columnType || "")))
    return formatDisplayNumber(value, state?.locale);
  return displayMoney(value, money, state, columnType);
}

/**
 * Exact value for calculation details ("How this was calculated"): no rounding of non-currency
 * numbers, so the owner can verify the underlying figure. Headline answers use displayAmount.
 * Confirmed-currency values still go through the unchanged currency formatter.
 */
export function displayExact(value: unknown, money?: Money, state?: Display, columnType?: string, percent?: boolean): string {
  if (money?.currency && !money.mixed) return displayMoney(value, money, state, columnType);
  if (percent === true && value != null && value !== "" && Number.isFinite(Number(value)))
    return formatNumber(value, { locale: state?.locale || undefined }) + "%";
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && NUMERIC.test(columnType || "")))
    return formatNumber(value, { locale: state?.locale || undefined });
  return displayMoney(value, money, state, columnType);
}
