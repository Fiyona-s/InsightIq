import { Plus } from "lucide-react";
import type { AnalystRun } from "../api";
import { formatDate, formatNumber } from "../lib/formatters";
import { groupHistory } from "../lib/historyGroups";
import { Button } from "./ui/button";
import { ErrorState } from "./WorkspaceStates";

const STATUS: Record<string, string> = { succeeded: "Answered", failed: "Failed", clarification: "Needs clarification", cancelled: "Stopped", queued: "Waiting", generating: "In progress", executing: "In progress" };

/** Ask side panel: the one primary New question button, then the saved questions grouped Today / Yesterday / Earlier. */
export default function AskPanel({ history, currentId, error, more, loadingMore, disabled, onNew, onOpen, onMore, close }: {
  history: AnalystRun[]; currentId?: string; error: string; more: boolean; loadingMore: boolean; disabled: boolean;
  onNew: () => void; onOpen: (run: AnalystRun) => void; onMore: () => void; close: () => void;
}) {
  const groups = groupHistory(history);
  return <div className="ask-panel">
    <Button className="panel-primary" disabled={disabled} onClick={() => { onNew(); close(); }}><Plus size={16} aria-hidden="true" /> New question</Button>
    <h2 className="panel-heading">Recent questions <span>{formatNumber(history.length)}</span></h2>
    {error && <ErrorState as="div" role="alert" className="alert">{error}</ErrorState>}
    {!history.length && !error && <p className="history-empty">Your questions will appear here.</p>}
    {groups.map((group) => <section key={group.label} aria-label={group.label} className="history-group">
      <h3>{group.label}</h3>
      <div className="run-history">
        {group.rows.map(({ run, count, ids }) => <button key={run.id} type="button" disabled={disabled}
          className={ids.includes(currentId || "") ? "history-item chosen" : "history-item"} aria-current={ids.includes(currentId || "") ? "true" : undefined}
          onClick={() => { onOpen(run); close(); }}>
          <span>{run.question}</span>
          <small><i className={"status-dot " + run.status} />{STATUS[run.status] || run.status} · {formatDate(run.created_at, "datetime", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}{count > 1 && <b className="asked-count"> · asked {count}x</b>}</small>
        </button>)}
      </div>
    </section>)}
    {more && <Button variant="ghost" disabled={disabled || loadingMore} onClick={onMore}>{loadingMore ? "Loading earlier runs…" : "Load earlier runs"}</Button>}
    <p className="history-policy">Each answer is saved with its question on this computer (up to 1,000 rows; the newest 500 answers are kept).</p>
  </div>;
}
