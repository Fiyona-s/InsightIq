import { Card } from "./ui/layout";
import { whenIdle } from "../lib/defer";
import { useAuth } from "../lib/auth";
import { hostedRuns, succeededCount } from "../lib/runActivity";
import {formatNumber} from "../lib/formatters";
import { useEffect, useState } from "react";
import { phase4Api, type SavedChart } from "../phase4api";
import { useActiveDataset, readLocal, writeLocal } from "../lib/activeDataset";
import { Button } from "./ui/button";
import type { Dataset } from "../api";
export function setupSteps(
  datasets: Dataset[],
  profileViews: string[],
  completed: Set<string>,
  charts: Pick<SavedChart, "dataset_id">[],
) {
  const real = datasets.filter((d) => !d.archived_at && !d.is_sample),
    ids = new Set(real.map((d) => d.id));
  return [
    real.length > 0,
    real.some((d) => profileViews.includes(d.id) || completed.has(d.id)),
    real.some((d) => completed.has(d.id)),
    charts.some((c) => ids.has(c.dataset_id)),
  ];
}
export default function SetupGuide({
  onNavigate,
}: {
  onNavigate: (page: string) => void;
}) {
  const context = useActiveDataset();
  const hosted = useAuth().hosted;
  const datasets = context?.datasets,
    loading = context?.loading;
  const [facts, setFacts] = useState<{
      completed: string[];
      charts: SavedChart[];
      established: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [dismissed, setDismissed] = useState(
      () => readLocal("insightiq-setup-dismissed-v1") === true,
    ),
    [force, setForce] = useState(false),
    [admitted, setAdmitted] = useState(
      () => readLocal("insightiq-setup-started-v1") === true,
    );
  useEffect(() => {
    // A dismissed guide is never shown, so it needs none of the requests below.
    if (!datasets || loading || dismissed) return;
    let current = true;
    setFacts(null);
    const runs = hosted ? hostedRuns() : null;      // login on: one call to a route this role may use
    // The checklist sits at the bottom of Home, so it can load once the first screen is done (Stage 7 follow-up).
    const cancel = whenIdle(() => void Promise.all([
      runs
        ? runs.then((all) => datasets.filter((d) => !d.archived_at && !d.is_sample).map((d) => ({ id: d.id, data: { succeeded: succeededCount(all, d.id) } })))
        : Promise.all(
            datasets
              .filter((d) => !d.archived_at && !d.is_sample)
              .map(async (d) => ({
                id: d.id,
                data: await phase4Api.analytics({ dataset_id: d.id }),
              })),
          ),
      phase4Api.charts(),
      runs ? runs.then((all) => ({ succeeded: succeededCount(all) })) : phase4Api.analytics(),
      phase4Api
        .dashboards()
        .then((items) =>
          Promise.all(
            items
              .filter((d) => d.widget_count > 0)
              .map((d) => phase4Api.dashboard(d.id)),
          ),
        ),
    ])
      .then(([runs, savedCharts, activity, dashboards]) => {
        if (!current) return;
        const completed = runs
          .filter((r) => r.data.succeeded > 0)
          .map((r) => r.id);
        const charts = savedCharts.filter((chart) =>
          dashboards.some((d) =>
            d.widgets.some(
              (w) => w.kind === "chart" && w.chart_id === chart.id,
            ),
          ),
        );
        // A deliberate saved answer + pinned chart is established use even when
        // the filename-only sample heuristic marks its source as a demo.
        const established = activity.succeeded > 0 && charts.length > 0;
        setFacts({ completed, charts, established });
        if (
          !established &&
          !completed.length &&
          !datasets.some(
            (d) => !d.is_sample && charts.some((c) => c.dataset_id === d.id),
          )
        ) {
          setAdmitted(true);
          writeLocal("insightiq-setup-started-v1", true);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      }));
    return () => {
      current = false;
      cancel();
    };
  }, [datasets, loading, dismissed, hosted]);
  if (!context || !facts)
    return error ? (
      <p className="setup-guide-error">
        Setup guide unavailable.{" "}
        <Button variant="ghost" onClick={() => onNavigate("Data workspace")}>
          Upload a dataset
        </Button>
      </p>
    ) : null;
  const steps = setupSteps(
      context.datasets,
      context.profileViews,
      new Set(facts.completed),
      facts.charts,
    ),
    count = steps.filter(Boolean).length;
  const hasExistingRealActivity =
    facts.established ||
    facts.completed.length > 0 ||
    facts.charts.some((c) =>
      context.datasets.some((d) => !d.is_sample && d.id === c.dataset_id),
    );
  const visible =
    count < 4 &&
    !dismissed &&
    (force || (!facts.established && admitted) || !hasExistingRealActivity);
  const labels = [
    "Upload a dataset",
    "Review the profile",
    "Ask a question",
    "Pin it to a dashboard",
  ];
  async function go(index: number) {
    const real = context!.datasets.filter(
      (d) => !d.archived_at && !d.is_sample,
    );
    const id = real.find((d) => d.id === context!.activeId)?.id || real[0]?.id;
    if (index > 0 && id && !(await context!.select(id))) return;
    onNavigate(
      index === 0 || index === 1
        ? "Data workspace"
        : index === 2
          ? "AI Analyst"
          : "Dashboards",
    );
    if (index === 1)
      window.dispatchEvent(new Event("insightiq:review-profile"));
  }
  return (
    <>
      {visible && (
        <Card className="setup-guide" aria-label="Setup guide">
          <div className="insight-heading">
            <h2>Get started</h2>
            <Button
              variant="ghost"
              onClick={() => {
                setDismissed(true);
                writeLocal("insightiq-setup-dismissed-v1", true);
              }}
            >
              Dismiss setup guide
            </Button>
          </div>
          <p>{formatNumber(count)} of 4 done</p>
          <ol>
            {labels.map((label, i) => (
              <li key={label}>
                <span aria-label={steps[i] ? "Complete" : "Incomplete"}>
                  {steps[i] ? "✓" : i + 1}
                </span>
                <Button variant="ghost" onClick={() => void go(i)}>
                  {label}
                </Button>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {!visible && count < 4 && (
        <div className="setup-guide-footer">
          <Button
            variant="ghost"
            onClick={() => {
              setForce(true);
              setDismissed(false);
              writeLocal("insightiq-setup-dismissed-v1", false);
            }}
          >
            Show setup guide
          </Button>
        </div>
      )}
    </>
  );
}
