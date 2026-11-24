import { useEffect, useState } from "react";
import { datasetProfileApi, type QualitySummary } from "../datasetProfileApi";
import { formatNumber } from "../lib/formatters";
import { Button } from "./ui/button";
import { Drawer } from "./ui/overlay";
import DatasetQuality from "./DatasetQuality";

/**
 * One line of counts for the selected dataset. Counts only: no "healthy" or "good" label, because
 * no documented threshold exists for one (Rule 4). "Details" opens the full quality review.
 */
export default function DatasetHealth({ id, revision }: { id: string; revision?: number }) {
  const [data, setData] = useState<QualitySummary | null>(null), [failed, setFailed] = useState(false), [open, setOpen] = useState(false);
  useEffect(() => {
    let current = true;
    setData(null); setFailed(false);
    datasetProfileApi.quality(id).then((v) => { if (current && Array.isArray(v.columns)) setData(v); else if (current) setFailed(true); }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [id, revision]);
  const missing = data ? data.columns.reduce((n, c) => n + c.missing, 0) : 0;
  return (
    <div className="dataset-health" role="group" aria-label="Data quality summary">
      {data ? (
        <p>
          {[
            [missing, "missing values"],
            [data.duplicate_rows, "duplicate rows"],
            [data.empty_columns.length, "empty columns"],
            [data.type_issues.reduce((n, i) => n + i.count, 0), "type issues"],
          ].map(([n, label], index) => (
            <span key={label as string}>{index > 0 && " · "}<span className={Number(n) ? "health-count nonzero" : "health-count"}>{formatNumber(Number(n))} {label}</span></span>
          ))}
        </p>
      ) : (
        <p>{failed ? "Quality counts unavailable." : "Checking data quality…"}</p>
      )}
      <Button variant="ghost" onClick={() => setOpen(true)}>Details</Button>
      <Drawer open={open} title="Data quality details" onClose={() => setOpen(false)}>
        <DatasetQuality id={id} revision={revision} />
      </Drawer>
    </div>
  );
}
