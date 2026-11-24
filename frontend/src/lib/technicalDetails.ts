import { useSyncExternalStore } from "react";

/**
 * Whether technical details (the SQL, evidence codes and result digests) are shown next to answers and
 * dashboard tiles. Owners see the plain answer, the data and a plain-language "how this was calculated";
 * analysts switch this on in Settings. A display preference only: nothing is removed or hidden from the
 * exports, and the PDF appendix always carries the full detail.
 */
export const TECHNICAL_DETAILS_KEY = "insightiq-technical-details-v1";
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(TECHNICAL_DETAILS_KEY) === "true"; } catch { return false; } };

export function setTechnicalDetails(value: boolean) {
  try { localStorage.setItem(TECHNICAL_DETAILS_KEY, String(value)); } catch { /* preference is optional */ }
  listeners.forEach((listener) => listener());
}
export function useTechnicalDetails(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, read, () => false);
  return [value, setTechnicalDetails];
}
