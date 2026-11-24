import { useEffect, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import { Card, PageHeader, StatusChip } from "./ui/layout";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/states";
import { ErrorState, LoadingState } from "./WorkspaceStates";
import { phase4Api, type DashboardSummary } from "../phase4api";
import { formatDate } from "../lib/formatters";

/**
 * Home for the Viewer role (login on): dashboards only. It makes exactly one request, the dashboard list, a route a viewer
 * may call. It never touches questions, datasets or the analytics routes.
 */
export default function ViewerHome({ onOpenDashboard }: { onOpenDashboard: (id: string) => void | Promise<void> }) {
  const [boards, setBoards] = useState<DashboardSummary[] | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setBoards(null); setError("");
    phase4Api.dashboards().then((items) => { if (current) setBoards(items); }).catch((e) => { if (current) setError(e instanceof Error ? e.message : String(e)); });
    return () => { current = false; };
  }, [retry]);
  return (
    <div className="home-page">
      <PageHeader title="Home" />
      {error && <ErrorState>Dashboards could not load. <Button variant="ghost" onClick={() => setRetry((v) => v + 1)}>Try again</Button></ErrorState>}
      {!error && boards === null && <LoadingState>Loading dashboards…</LoadingState>}
      {boards && (
        <Card className="home-section" aria-label="Saved dashboards">
          <div className="home-section-heading"><h2>Dashboards</h2></div>
          {!boards.length ? (
            <EmptyState as="p">There are no dashboards yet. An analyst or owner can pin answers to a dashboard.</EmptyState>
          ) : (
            <ul className="home-dashboard-list">
              {[...boards].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((board) => (
                <li key={board.id}>
                  <LayoutDashboard size={18} aria-hidden="true" />
                  <div>
                    <strong>{board.title}</strong>
                    <StatusChip>Updated {formatDate(board.updated_at, "date")}</StatusChip>
                  </div>
                  <Button variant="outline" aria-label={"Open dashboard " + board.title} onClick={() => void onOpenDashboard(board.id)}>Open</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
