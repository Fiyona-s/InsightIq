import { useSyncExternalStore } from "react";

/**
 * The currency OFFERED when the owner marks a column as money (USD unless changed in Settings, or
 * "none" to offer none). It never marks a column by itself: money and percentages are shown only
 * after the owner confirms them (decision 2026-11-20). Browser preference only.
 */
export const DEFAULT_CURRENCY_KEY = "insightiq-default-currency-v1";
export const CURRENCY_CHOICES = "USD INR EUR GBP AED CAD AUD JPY SGD CHF CNY NZD SEK NOK DKK ZAR BRL MXN KRW HKD PLN TRY".split(" ");
const listeners = new Set<() => void>();

export function readDefaultCurrency(): string | null {
  try {
    const value = localStorage.getItem(DEFAULT_CURRENCY_KEY);
    if (value === "none") return null;
    return value && CURRENCY_CHOICES.includes(value) ? value : "USD";
  } catch { return "USD"; }
}
export function setDefaultCurrency(value: string | null) {
  try { localStorage.setItem(DEFAULT_CURRENCY_KEY, value ?? "none"); } catch { /* optional preference */ }
  listeners.forEach((l) => l());
}
export function useDefaultCurrency(): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, readDefaultCurrency, () => "USD");
  return [value, setDefaultCurrency];
}
