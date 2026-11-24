import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, PageHeader } from "./ui/layout";
import { Button } from "./ui/button";
import { EmptyState, LoadingState } from "./ui/states";
import { TableFrame } from "./ui/data";
import { formatDate, formatNumber } from "../lib/formatters";
import { displayName } from "../lib/datasetNames";
import { datasetProfileApi, type RevisionHistory } from "../datasetProfileApi";
import type { Dataset } from "../api";

/** One plain sentence under every Admin page's heading: what the page is for, in everyday words. */
export function AdminPurpose({ children }: { children: ReactNode }) {
  return <p className="admin-purpose"><strong>What this is for:</strong> {children}</p>;
}

/** Why an Accuracy check can show "0 of N", and what to do. Shown on the empty page and on an all-unscored result. */
export function WhyNothingScored({ total, onLive, onOffline }: { total: number; onLive: () => void; onOffline?: () => void }) {
  return (
    <Card className="evaluation-why" aria-label="Why nothing is scored" title={`Why you may see “0 of ${formatNumber(total)}”`} headingLevel={2}>
      <p>
        Offline replay only re-scores answers that already exist for these {formatNumber(total)} questions. None have been run yet, so nothing can be
        scored. This is not a low accuracy: it means no accuracy has been measured.
      </p>
      <p>
        To get a score, use a <strong>live check</strong>, which runs the questions now through the AI provider (it uses API credits; you set a spend
        limit and confirm before anything runs), or ask the questions yourself on the benchmark dataset and replay again.
      </p>
      <div className="evaluation-why-actions">
        {onOffline && <Button onClick={onOffline}>Set up offline replay</Button>}
        <Button variant="outline" onClick={onLive}>Set up a live check</Button>
      </div>
    </Card>
  );
}

const CODE = (text: string) => <pre className="admin-code" tabIndex={0}>{text}</pre>;

/** Where backups are and how to restore one. Static: the app cannot see your computer's folders. */
export function BackupInfoPage({ banner }: { banner: ReactNode }) {
  return (
    <div className="admin-backup-page">
      {banner}
      <PageHeader title="Backup info" description="Where copies of your data are kept and how to restore one." />
      <AdminPurpose>to know where your data and its backups live, how to make a new backup, and how to get your data back from one.</AdminPurpose>
      <p className="insight-note">This page cannot see the folders on your computer, so it shows what the app knows and the exact commands to run. Nothing here changes anything.</p>

      <Card title="Where your data and backups are" headingLevel={2}>
        <ul>
          <li><strong>Your live data:</strong> the Docker volume <code>project_insightiq-data</code>, mounted as <code>/data</code> inside the container <code>project-api-1</code>. It holds the catalog (<code>catalog.sqlite</code>), every dataset, your saved answers, dashboards, models and definitions.</li>
          <li><strong>Automatic copies before an upgrade:</strong> inside that same volume, under <code>/data/backups/&lt;name&gt;-&lt;date&gt;/</code> (for example <code>projects-v11-…</code>, <code>analyst-results-v12-…</code>). They are made before a structural change to the catalog. They live in the same volume, so they do not protect you if the volume is lost.</li>
          <li><strong>Full backups you make:</strong> in the project folder under <code>.backups/&lt;name&gt;/</code>, made with <code>backend/scripts/backup_workspace.py</code> (below). Each holds <code>data/</code>, <code>catalog-consistent.sqlite</code>, <code>datasets-before.json</code> and <code>preexisting-audit.json</code>.</li>
        </ul>
        <p className="admin-recommendation"><strong>Keep a copy of your newest backup somewhere that is not this computer</strong>, for example an external drive. A backup that sits next to the data it protects is lost with it. Backups contain your business data: keep them private.</p>
      </Card>

      <Card title="Make a backup" headingLevel={2}>
        <p>Let any running question, evaluation or model training finish first. From the project folder:</p>
        {CODE(`python3 backend/scripts/backup_workspace.py \\
  --container project-api-1 \\
  --api http://localhost:8000 \\
  --destination ".backups/manual-$(date -u +%Y%m%dT%H%M%SZ)"`)}
        <p>The app is paused for a moment while the data is copied, then started again. The script never overwrites an existing backup folder and checks the copy's integrity.</p>
      </Card>

      <Card title="Check a backup" headingLevel={2}>
        {CODE(`python3 - /absolute/path/to/backup <<'PY'
import pathlib, sqlite3, sys
root = pathlib.Path(sys.argv[1])
with sqlite3.connect(root / 'catalog-consistent.sqlite') as db:
    print(db.execute('PRAGMA integrity_check').fetchone()[0])
    print(db.execute('SELECT version FROM schema_migrations ORDER BY version').fetchall())
    print('datasets:', db.execute('SELECT COUNT(*) FROM datasets').fetchone()[0])
assert (root / 'data').is_dir()
PY`)}
        <p>You should see <code>ok</code>, a list of schema versions and the number of datasets you expect.</p>
      </Card>

      <Card title="Restore without touching your live data" headingLevel={2}>
        <p>These steps were rehearsed on 21 Nov 2026 on a copy of a real backup, never on the live workspace: the restored copy started, and its datasets, questions and dashboards matched the original exactly. They put the backup into a <strong>new</strong> volume and leave the current one alone.</p>
        <ol>
          <li><strong>Stop the app</strong> with <code>docker compose stop</code>. Never use <code>docker compose down -v</code>: it deletes the volume.</li>
          <li><strong>Prepare a staging copy</strong> in a new, empty folder, using the consistent catalog and removing the stale journal files <em>from the copy only</em>:
            {CODE(`mkdir /tmp/restore-staging
cp -a .backups/NAME/data/. /tmp/restore-staging/
cp .backups/NAME/catalog-consistent.sqlite /tmp/restore-staging/catalog.sqlite
rm -f /tmp/restore-staging/catalog.sqlite-wal /tmp/restore-staging/catalog.sqlite-shm`)}
          </li>
          <li><strong>Check the staging copy</strong> (the snippet above, pointed at the backup folder) before going on.</li>
          <li><strong>Import it into a new named volume</strong> owned by the app's user (uid 1000):
            {CODE(`docker volume create insightiq-restored
docker run --rm -v insightiq-restored:/data -v /tmp/restore-staging:/staging:ro alpine \\
  sh -c 'cp -a /staging/. /data/ && chown -R 1000:1000 /data'`)}
          </li>
          <li><strong>Point the app at the new volume</strong> with a Compose override file named <code>compose.restore.yaml</code>:
            {CODE(`services:
  api:
    volumes:
      - restored-data:/data
volumes:
  restored-data:
    external: true
    name: insightiq-restored`)}
            then start it: <code>docker compose -f compose.yaml -f compose.restore.yaml up -d</code>. Confirm with <code>docker inspect project-api-1</code> that <code>/data</code> is the new volume.
          </li>
          <li><strong>Look before you work:</strong> open the app, check your datasets, questions and dashboards, and only then start using it. To go back, stop the app and start it without the override file: your original volume is untouched.</li>
        </ol>
        <p className="insight-note">Never copy a backup over a running database. A newer app opening an older backup may add its own tables when it starts; exact rollback to an older schema needs the matching older app version.</p>
      </Card>
    </div>
  );
}

type Row = { key: string; time: string; datasetId: string; dataset: string; kind: "Saved version" | "Action"; what: string; detail: string; source: string };

/** Dataset change history: a read-only list built from the history the app already keeps per dataset. Not a complete audit trail. */
export function ChangeHistoryPage({ datasets, banner }: { datasets: Dataset[]; banner: ReactNode }) {
  const [histories, setHistories] = useState<{ dataset: Dataset; history: RevisionHistory | null }[] | null>(null);
  const [failed, setFailed] = useState(0);
  const [filter, setFilter] = useState({ dataset: "", kind: "" });
  const key = datasets.map((d) => d.id).join("|");
  useEffect(() => {
    let current = true;
    setHistories(null);
    setFailed(0);
    Promise.allSettled(datasets.map((d) => datasetProfileApi.history(d.id))).then((results) => {
      if (!current) return;
      setHistories(results.map((r, i) => ({ dataset: datasets[i], history: r.status === "fulfilled" ? r.value : null })));
      setFailed(results.filter((r) => r.status === "rejected").length);
    });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const { dataset, history } of histories || []) {
      if (!history) continue;
      const name = displayName(dataset);
      for (const a of history.audit || [])
        out.push({ key: `a-${dataset.id}-${a.id}`, time: a.timestamp, datasetId: dataset.id, dataset: name, kind: "Action", what: a.action, detail: [a.result, a.reason].filter(Boolean).join(" · "), source: a.actor || "Not recorded" });
      for (const r of history.revisions || [])
        out.push({ key: `r-${dataset.id}-${r.revision}`, time: r.timestamp || "", datasetId: dataset.id, dataset: name, kind: "Saved version", what: `Version ${r.revision} (${r.source})`,
          detail: [r.changed_cells != null ? `${formatNumber(r.changed_cells)} cells changed` : "", r.row_count != null ? `${formatNumber(r.row_count)} rows` : "", r.status !== "available" ? `snapshot ${r.status}` : ""].filter(Boolean).join(" · "), source: "Not recorded" });
    }
    return out.sort((a, b) => (b.time || "").localeCompare(a.time || ""));
  }, [histories]);
  const shown = rows.filter((r) => (!filter.dataset || r.datasetId === filter.dataset) && (!filter.kind || r.kind === filter.kind));
  return (
    <div className="admin-history-page">
      {banner}
      <PageHeader title="Dataset change history" description="A read-only list of changes recorded for the datasets in this project." />
      <AdminPurpose>to see what was changed on your datasets and when.</AdminPurpose>
      <Card title="What this covers, and what it does not" headingLevel={2} className="admin-coverage">
        <p><strong>Covers:</strong> the datasets in the active project (including archived ones): actions such as rename, archive, restore and delete that the app recorded, and the saved versions of each dataset (imports, edits, restores) that its version history still lists.</p>
        <p><strong>Does not cover:</strong> questions, dashboards, models, saved definitions or settings; datasets that were deleted; anything done outside the app; the newest saved versions beyond the first page of each dataset's history; and <strong>who</strong> made a change, because there is no login. The source column is a local label, not an identity. This is <strong>not a complete audit trail</strong> and not tamper-proof.</p>
      </Card>
      {histories === null ? <LoadingState as="p" role="status">Loading the change history…</LoadingState> : (
        <>
          {failed > 0 && <p role="status" className="insight-note">The history of {formatNumber(failed)} {failed === 1 ? "dataset" : "datasets"} could not be loaded and is missing from this list.</p>}
          <div className="admin-history-filters">
            <label>Dataset<select value={filter.dataset} onChange={(e) => setFilter({ ...filter, dataset: e.target.value })}><option value="">All datasets</option>{datasets.map((d) => <option key={d.id} value={d.id}>{displayName(d)}</option>)}</select></label>
            <label>Kind<select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}><option value="">All</option><option value="Action">Actions</option><option value="Saved version">Saved versions</option></select></label>
          </div>
          {!shown.length ? <EmptyState as="p">No recorded changes match.</EmptyState> : (
            <TableFrame label="Dataset change history">
              <table>
                <thead><tr><th scope="col">When</th><th scope="col">Dataset</th><th scope="col">What</th><th scope="col">Details</th><th scope="col">Source</th></tr></thead>
                <tbody>{shown.map((r) => <tr key={r.key}><td>{r.time ? formatDate(r.time, "datetime") : "Not recorded"}</td><td>{r.dataset}</td><td>{r.what}</td><td>{r.detail || "—"}</td><td>{r.source}</td></tr>)}</tbody>
              </table>
            </TableFrame>
          )}
        </>
      )}
    </div>
  );
}
