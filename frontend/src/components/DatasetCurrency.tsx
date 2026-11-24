import { useEffect, useState } from "react";
import { insightApi, type KnowledgeInfo } from "../api";
import { Button } from "./ui/button";

/** Open Business definitions with the "Confirmed currencies" section already open. */
export function openCurrencySettings() {
  try { sessionStorage.setItem("insightiq-open-currencies", "1"); } catch { /* optional */ }
}

/** One line under a dataset: which columns are money, in which currency, and a button to change it. */
export default function DatasetCurrency({ id, revision, onChange }: { id: string; revision?: number; onChange: () => void }) {
  const [info, setInfo] = useState<KnowledgeInfo | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setInfo(null); setFailed(false);
    insightApi.knowledge(id).then((v) => { if (!current) return; if (v && typeof v === "object" && (v as KnowledgeInfo).settings) setInfo(v); else setFailed(true); }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [id, revision]);
  if (failed) return null;
  const money = Object.entries(info?.settings.monetary_columns || {}).filter(([, m]) => m.currency && !m.mixed);
  const codes = Array.from(new Set(money.map(([, m]) => m.currency)));
  return (
    <div className="dataset-currency" role="group" aria-label="Currency">
      <p>
        {!info ? "Checking currency…" : money.length
          ? <>Money columns: {money.map(([name]) => name).join(", ")} · {codes.join(", ")}</>
          : "No columns are confirmed as money, so amounts are shown as plain numbers."}
      </p>
      <Button variant="outline" disabled={!info} onClick={() => { openCurrencySettings(); onChange(); }}>{money.length ? "Change currency" : "Set currency"}</Button>
    </div>
  );
}
