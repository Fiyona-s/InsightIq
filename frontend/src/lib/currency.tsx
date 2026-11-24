import { formatNumber, formatCurrency } from "./formatters";
import { useEffect, useState, useSyncExternalStore } from "react";
import { request, type ResultColumn, type Money } from "../api";
export const currencies =
  "USD INR EUR GBP AED CAD AUD JPY SGD CHF CNY NZD SEK NOK DKK ZAR BRL MXN KRW HKD PLN TRY".split(
    " ",
  );
export type Quote = {
  source_currency: string;
  target_currency: string;
  rate: string;
  rate_source: string;
  effective_date: string;
  fetched_at: string;
  historical: boolean;
};
type Display = {
  quotes: Record<string, Quote>;
  locale: string;
  historicalDate?: string;
};
const empty: Display = { quotes: {}, locale: "" };
const states = new Map<string, Display>();
const listeners = new Set<() => void>();
function update(id: string, value: Display) {
  if (states.size > 100) states.clear();
  states.set(id, value);
  listeners.forEach((fn) => fn());
}
export function setCurrencyQuotes(id:string,quotes:Record<string,Quote>){update(id,{...(states.get(id)||empty),quotes});}
export function useCurrency(id = "") {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => states.get(id) || empty,
  );
}
// Exact decimal multiplication before Intl rounding; original values are never modified.
export function multiply(a: string, b: string) {
  function parts(s: string): [bigint, number] {
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!match) throw new Error("Invalid decimal");
    const scale = (match[3]?.length || 0) - Number(match[4] || 0);
    if (Math.abs(scale) > 1000) throw new Error("Decimal exponent too large");
    return [
      BigInt((match[1] === "-" ? "-" : "") + match[2] + (match[3] || "")),
      scale,
    ];
  }
  const [x, s] = parts(a),
    [y, t] = parts(b);
  const n = x * y;
  const scale = s + t;
  const digits = (n < 0n ? -n : n).toString();
  return (
    (n < 0n ? "-" : "") +
    (scale <= 0
      ? digits + "0".repeat(-scale)
      : digits.padStart(scale + 1, "0").slice(0, -scale) +
        "." +
        digits.padStart(scale + 1, "0").slice(-scale))
  );
}
export function displayMoney(
  value: unknown,
  money?: Money | null,
  state: Display = empty,
  columnType?: string,
) {
  if (value === null || value === undefined) return "NULL";
  if (money?.mixed || !money?.currency || typeof value === "boolean")
    return typeof value === "number" || (typeof value === "string" && /^(U?HUGEINT|U?BIGINT|U?INTEGER|U?SMALLINT|U?TINYINT|FLOAT|DOUBLE|DECIMAL)/.test(columnType || "")) ? formatNumber(value) : String(value);
  const q = state.quotes[money.currency];
  const code = q?.target_currency || money.currency;
  try {
    const amount = q ? multiply(String(value), q.rate) : String(value);
    return formatCurrency(amount, code, {locale: state.locale || undefined});
  } catch {
    return String(value);
  }
}
export function CurrencyControls({
  id,
  columns,
  exportUrl,
}: {
  id: string;
  columns: ResultColumn[];
  exportUrl?: string;
}) {
  const state = useCurrency(id);
  const sources = [
    ...new Set(
      columns
        .filter((c) => c.money?.currency && !c.money.mixed)
        .map((c) => c.money!.currency!),
    ),
  ];
  const [open, setOpen] = useState(false),
    [target, setTarget] = useState("USD"),
    [day, setDay] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    enabled: boolean;
    reason: string | null;
  } | null>(null);
  const sourceKey=sources.join(",");
  useEffect(() => {
    if (sourceKey)
      request<{ enabled: boolean; reason: string | null }>("/currency/status")
        .then(setStatus)
        .catch(() =>
          setStatus({
            enabled: false,
            reason: "Rate service unavailable. Original values retained.",
          }),
        );
  }, [sourceKey]);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("insightiq-currency:" + id) || "null",
      );
      if (saved) {
        setTarget(saved.target);
        update(id, {
          ...(states.get(id) || empty),
          locale: saved.locale || "",
        });
      }
    } catch {
      /* Invalid local preferences are ignored. */
    }
  }, [id]);
  if (!sources.length)
    return columns.some((c) => c.money) ? (
      <p>Confirm source currency in Knowledge base to enable conversion.</p>
    ) : null;
  return (
    <div
      className="currency-controls"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          e.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        className="button button-outline"
        disabled={!status?.enabled}
        aria-expanded={open}
        aria-controls={`currency-panel-${id}`}
        title={status?.reason || undefined}
        onClick={() => setOpen(!open)}
      >
        Convert Currency
      </button>
      {status?.reason && <small role="status">{status.reason}</small>}
      {status && !status.enabled && (
        <button
          type="button"
          className="button button-ghost"
          onClick={() =>
            request<{ enabled: boolean; reason: string | null }>(
              "/currency/status",
            )
              .then(setStatus)
              .catch(() => {})
          }
        >
          Retry rate service
        </button>
      )}
      <span className="currency-badge">
        {sources.join(" / ")}
        {Object.values(state.quotes)[0]
          ? " → " + Object.values(state.quotes)[0].target_currency
          : ""}
      </span>
      {open && (
        <div
          id={`currency-panel-${id}`}
          role="group"
          aria-label="Currency conversion"
        >
          <p>Source currencies: {sources.join(", ")}. Daily reference rates.</p>
          <label>
            Target currency
            <select
              aria-label="Target currency"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <details className="currency-help">
            <summary>Locale &amp; historical date</summary>
            <label>
              Locale
              <select
                aria-label="Currency locale"
                value={state.locale}
                onChange={(e) =>
                  update(id, { ...state, locale: e.target.value })
                }
              >
                <option value="">Currency default</option>
                <option value="en-US">English (US)</option>
                <option value="en-IN">English (India)</option>
                <option value="de-DE">German</option>
              </select>
            </label>
            <label>
              Historical date (optional)
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <p>
              Display only. Calculation evidence uses original currencies. Reset
              or reapply to change the rate.
            </p>
          </details>
          <button
            className="button button-primary"
            type="button"
            disabled={busy || !status?.enabled}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const quotes: Record<string, Quote> = {};
                for (const source of sources) {
                  if (source === target) continue;
                  quotes[source] = await request<Quote>("/currency/convert", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      source_currency: source,
                      target_currency: target,
                      amounts: ["1"],
                      historical_date: day || null,
                    }),
                  });
                }
                update(id, { ...state, quotes, historicalDate: day });
                localStorage.setItem(
                  "insightiq-currency:" + id,
                  JSON.stringify({ target, locale: state.locale }),
                );
              } catch (e) {
                setError((e as Error).message);
                try {
                  setStatus(
                    await request<{ enabled: boolean; reason: string | null }>(
                      "/currency/status",
                    ),
                  );
                } catch {
                  setStatus({
                    enabled: false,
                    reason:
                      "Rate service unavailable. Original amounts retained.",
                  });
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Converting…" : "Apply conversion"}
          </button>
        </div>
      )}
      {Object.values(state.quotes).map((q) => (
        <p key={q.source_currency}>
          1 {q.source_currency} = {q.rate} {q.target_currency} · {q.rate_source}{" "}
          · {q.historical ? "Historical" : "Latest available"}{" "}
          {q.effective_date} · fetched {q.fetched_at}. Display conversion;
          original values retained.
        </p>
      ))}
      {Object.keys(state.quotes).length > 0 && (
        <button
          type="button"
          onClick={() => update(id, { ...state, quotes: {} })}
        >
          Reset to Original Currency
        </button>
      )}
      {exportUrl && Object.values(state.quotes).length > 0 && (
        <a
          className="button button-outline"
          href={
            exportUrl +
            "?target_currency=" +
            Object.values(state.quotes)[0].target_currency +
            (state.historicalDate
              ? "&historical_date=" + state.historicalDate
              : "")
          }
          download
        >
          Export converted CSV (original columns retained)
        </a>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
