/** Presentation only. Never use formatted strings as calculation inputs. */
export type CompactUnit = "" | "K" | "L" | "Cr" | "M" | "B";
export interface FormatOptions { compact?: boolean; decimals?: number; locale?: string }
const powers: Record<CompactUnit, number> = { "": 0, K: 3, L: 5, Cr: 7, M: 6, B: 9 };
const valid = (value: unknown): value is number | string | bigint =>
  typeof value === "bigint" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value)));
const precision = (n: number) => Math.max(0, Math.min(100, Math.trunc(n)));
const print = (value: number | string | bigint, locale: string, options: Intl.NumberFormatOptions) =>
  (new Intl.NumberFormat(locale, options).format as (n: unknown) => string)(value);

export function compactUnit(magnitude: number, currency?: string): CompactUnit {
  const n = Math.abs(magnitude);
  return currency === "INR" ? n >= 1e7 ? "Cr" : n >= 1e5 ? "L" : n >= 1e3 ? "K" : ""
    : n >= 1e9 ? "B" : n >= 1e6 ? "M" : n >= 1e3 ? "K" : "";
}

/** Divide by an exact power of ten without first coercing a decimal string to float. */
function scaled(value: number | string | bigint, unit: CompactUnit): string {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value))!;
  const digits = (match[2] || "0") + (match[3] || "");
  const places = (match[3]?.length || 0) - Number(match[4] || 0) + powers[unit];
  const body = places <= 0 ? digits + "0".repeat(-places) : digits.padStart(places + 1, "0").slice(0, -places) + "." + digits.padStart(places + 1, "0").slice(-places);
  return match[1] + body;
}

export function formatNumber(value: unknown, options: FormatOptions = {}): string {
  try {
    if (!valid(value)) return "—";
    const unit = options.compact ? compactUnit(Number(value)) : "";
    const decimals = options.decimals == null ? undefined : precision(options.decimals);
    return print(unit ? scaled(value, unit) : value, options.locale || "en-US", options.compact
      ? { minimumFractionDigits: 0, maximumFractionDigits: decimals ?? 1 }
      : decimals == null ? (Number(value) !== 0 && Math.abs(Number(value)) < 1e-100
        ? { notation: "scientific", maximumSignificantDigits: 21 }
        : { maximumFractionDigits: 100 })
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + unit;
  } catch { return "—"; }
}

export function formatCurrency(value: unknown, currency: string, options: FormatOptions = {}): string {
  try {
    if (!valid(value) || !/^[a-z]{3}$/i.test(currency)) return "—";
    const code = currency.toUpperCase();
    const unit = options.compact ? compactUnit(Number(value), code) : "";
    const decimals = options.decimals == null ? undefined : precision(options.decimals);
    return print(unit ? scaled(value, unit) : value, options.locale || (code === "INR" ? "en-IN" : "en-US"), {
      style: "currency", currency: code,
      ...(options.compact ? { minimumFractionDigits: 0, maximumFractionDigits: decimals ?? 1 }
        : decimals == null ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    }) + unit;
  } catch { return "—"; }
}

/** Axis only: callers supply ONE unit chosen from the complete axis domain. */
export function formatAxisTick(value: unknown, {currency, unit}: {currency?: string; unit: CompactUnit}): string {
  try {
    if (!valid(value)) return "—";
    const amount = scaled(value, unit);
    const scientific = !unit && Number(amount) !== 0 && Math.abs(Number(amount)) < 0.1;
    return print(amount, currency === "INR" ? "en-IN" : "en-US", {
      ...(currency ? {style: "currency", currency} : {}),
      minimumFractionDigits: 0, maximumFractionDigits: 1,
      ...(scientific ? {notation: "scientific"} : {}),
    }) + unit;
  } catch { return "—"; }
}

/** Dates are display-only; invalid or unrecorded timestamps remain unavailable. */
export function formatDate(value:unknown, mode:'datetime'|'date'|'time'='datetime',options?:Intl.DateTimeFormatOptions):string{
 if(value==null||value==='')return 'Not recorded';
 // One explicit, locale-independent style ("16 Nov 2026, 10:30"): the month is always a word, never a number.
 try{const date=value instanceof Date?value:new Date(value as string|number);if(!Number.isFinite(date.getTime()))return 'Not recorded';return new Intl.DateTimeFormat('en-GB',options||(mode==='date'?{year:'numeric',month:'short',day:'numeric'}:mode==='time'?{hour:'2-digit',minute:'2-digit',hour12:false}:{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})).format(date);}catch{return 'Not recorded'}
}
