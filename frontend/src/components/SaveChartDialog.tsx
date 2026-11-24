import { useAuth } from "../lib/auth";
import { useEffect, useState } from "react";
import { dashboardWorkspaceApi } from "../dashboardWorkspaceApi";
import { DuplicateDialog } from "./DashboardWorkspaceControls";
import { phase4Api, type DashboardSummary } from "../phase4api";
import type { AnalystRun, ChartSpec } from "../api";
import { Button } from "./ui/button";
import { Modal } from "./ui/overlay";
import { ErrorState } from "./WorkspaceStates";

/** Select value meaning "create a dashboard now" (the owner never has to leave this dialog). */
const NEW_DASHBOARD = "__new__";
/** Shown next to the Pin / Save button. The explicit click on that button is the owner's consent. */
export const SAVE_SENTENCE = "Pinning saves up to 1,000 result rows in this project on this computer.";
/** Login on only: who can read the saved rows. */
export const VIEWER_PIN_SENTENCE = "People with the Viewer role can see the rows pinned to this dashboard.";
const LIBRARY_SENTENCE = "Saving keeps up to 1,000 result rows in this project on this computer.";

/**
 * Pin an answer to a dashboard (mode "pin") or keep it in the chart library (mode "library").
 * Nothing is saved until the owner presses the Pin / Save button; that click is the only place
 * the API's confirmation flag is sent from (Stage 3 decision D5).
 */
export default function SaveChartDialog({ run, spec, mode, open, onClose, onDone, titleHint }: {
  run: AnalystRun; spec: ChartSpec; mode: "pin" | "library"; open: boolean; onClose: () => void;
  onDone: (message: string) => void; titleHint?: string;
}) {
  const pin = mode === "pin";
  const hosted = useAuth().hosted;
  const [title, setTitle] = useState(titleHint || spec.title),
    [policy, setPolicy] = useState<"snapshot" | "manual">("snapshot"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dashboards, setDashboards] = useState<DashboardSummary[]>([]),
    [loaded, setLoaded] = useState(false),
    [dashboardId, setDashboardId] = useState(""),
    [newTitle, setNewTitle] = useState("My dashboard");
  const [duplicate, setDuplicate] = useState<{ chartId: string; matches: string[]; revision: number } | null>(null);

  useEffect(() => {
    if (!open || !pin) return;
    let current = true;
    setError(""); setLoaded(false);
    phase4Api.dashboards().then(existing => {
      if (!current) return;
      setDashboards(existing);
      // No dashboard yet used to be a dead end: create one right here. Otherwise the most recent one.
      setDashboardId(existing.length ? existing[0].id : NEW_DASHBOARD);
      setLoaded(true);
    }).catch(e => { if (current) { setError((e as Error).message); setLoaded(true); } });
    return () => { current = false; };
  }, [open, pin]);

  function finish(message: string) { setDuplicate(null); onClose(); onDone(message); }
  async function chooseDuplicate(choice: "replace" | "add_anyway" | "cancel") {
    if (!duplicate) return;
    if (choice === "cancel") { setDuplicate(null); finish("Pin cancelled. The chart is saved in your library."); return; }
    setBusy(true);
    try {
      await dashboardWorkspaceApi.attach(dashboardId, duplicate.chartId, duplicate.revision, choice, duplicate.matches[0]);
      finish("Pinned to your dashboard.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try {
      // The explicit click on this button is the confirmation sent to the API.
      const chart = await phase4Api.saveChart(run.id, title, spec, policy, true);
      let targetId = pin ? dashboardId : "", created = "";
      if (pin && dashboardId === NEW_DASHBOARD) {
        // The chart is already saved, so a failure here can never lose the owner's answer.
        try {
          const dashboard = await phase4Api.createDashboard(newTitle.trim());
          targetId = dashboard.id; created = dashboard.title;
          setDashboardId(dashboard.id);
        } catch (e) {
          setError("The chart is saved in your library, but the new dashboard could not be created: " + (e as Error).message);
          return;
        }
      }
      if (targetId) {
        const dashboard = await phase4Api.dashboard(targetId);
        const attached = await dashboardWorkspaceApi.attach(targetId, chart.id, dashboard.revision);
        if (attached.duplicate) { setDuplicate({ chartId: chart.id, matches: attached.matches, revision: dashboard.revision }); return; }
      }
      finish((targetId ? "Pinned to your dashboard." : "Saved to your chart library.") + (created ? ` New dashboard “${created}” created.` : ""));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const newOk = dashboardId !== NEW_DASHBOARD || !!newTitle.trim();
  const ready = !!title.trim() && newOk && (!pin || (loaded && !!dashboardId));
  return (
    <>
      <Modal
        open={open && !duplicate}
        title={pin ? "Pin to dashboard" : "Save to library"}
        busy={busy}
        onClose={onClose}
        footer={<>
          <p className="save-sentence">{pin ? SAVE_SENTENCE : LIBRARY_SENTENCE}</p>
          {hosted && pin && <p className="save-sentence">{VIEWER_PIN_SENTENCE}</p>}
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !ready} onClick={() => void save()}>{busy ? "Saving…" : pin ? "Pin" : "Save"}</Button>
        </>}
      >
        <label>
          Title
          <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} />
        </label>
        {pin && (
          <label>
            Dashboard
            <select value={dashboardId} disabled={!loaded} onChange={e => setDashboardId(e.target.value)}>
              {dashboards.map(d => <option value={d.id} key={d.id}>{d.title}</option>)}
              <option value={NEW_DASHBOARD}>New dashboard…</option>
            </select>
          </label>
        )}
        {pin && dashboardId === NEW_DASHBOARD && (
          <label>
            New dashboard name
            <input value={newTitle} maxLength={120} onChange={e => setNewTitle(e.target.value)} />
          </label>
        )}
        <details>
          <summary>Advanced</summary>
          <label>
            Refresh policy
            <select value={policy} onChange={e => setPolicy(e.target.value as "snapshot" | "manual")}>
              <option value="snapshot">Fixed snapshot</option>
              <option value="manual">Manual safe SQL refresh</option>
            </select>
          </label>
        </details>
        {error && <ErrorState as="p" className="alert" role="alert">{error}</ErrorState>}
      </Modal>
      {duplicate && <DuplicateDialog disabled={busy} onChoice={choice => void chooseDuplicate(choice)} />}
    </>
  );
}
