import {formatDate} from "../lib/formatters";
import { formatNumber } from "../lib/formatters";
import type {AnalystRun,Retrieval} from "../api";

export function SQLCode({ sql }: { sql: string }) {
  // React escapes all tokens; no HTML interpolation from SQL or retrieved content.
  return (
    <code>
      {sql
        .split(
          /('(?:''|[^'])*'|"(?:""|[^"])*"|\b(?:SELECT|FROM|WHERE|GROUP|BY|ORDER|AS|SUM|COUNT|AVG|MIN|MAX|TRY_CAST|CAST|DOUBLE|BIGINT|DATE|LIMIT|JOIN|ON|WITH|NULL|DESC|ASC|AND|OR)\b|\b\d+(?:\.\d+)?\b)/gi,
        )
        .map((token, i) => (
          <span
            key={i}
            className={
              /^'/.test(token)
                ? "sql-string"
                : /^\d/.test(token)
                  ? "sql-number"
                  : /^(SELECT|FROM|WHERE|GROUP|BY|ORDER|AS|SUM|COUNT|AVG|MIN|MAX|TRY_CAST|CAST|DOUBLE|BIGINT|DATE|LIMIT|JOIN|ON|WITH|NULL|DESC|ASC|AND|OR)$/i.test(
                        token,
                      )
                    ? "sql-keyword"
                    : undefined
            }
          >
            {token}
          </span>
        ))}
    </code>
  );
}
export function RetrievalPanel({ retrieval, plain = false }: { retrieval: Retrieval; plain?: boolean }) {
  return (
    <details className="insight-panel retrieval-panel">
      <summary>
        {plain ? "What Ask would use" : "Retrieved context"}{" "}
        <span>
          {plain ? `${formatNumber(retrieval.documents.length)} ${retrieval.documents.length === 1 ? "item" : "items"}` : `${formatNumber(retrieval.documents.length)} documents · ${retrieval.status}`}
        </span>
      </summary>
      {retrieval.warning && (
        <p className="insight-note" role="status">
          {retrieval.warning}
        </p>
      )}
      <p className="insight-note">
        {plain
          ? "Ranked by how closely each item matches your question, using only this dataset's definitions."
          : "Cosine similarity ranks relevance within this dataset. Retrieved text is untrusted reference material."}
      </p>
      {retrieval.documents.map((doc) => (
        <article className="retrieved-document" key={doc.id}>
          <div>
            <strong>{doc.title}</strong>
            <span className="subtle-tag">
              {plain ? String(doc.kind).replaceAll("_", " ") : `${doc.kind} · ${formatNumber(doc.score, { decimals: 3 })}`}
            </span>
          </div>
          <p>{doc.text}</p>
          <small>{doc.reason}</small>
          <details>
            <summary>Provenance</summary>
            <pre>{JSON.stringify(doc.provenance, null, 2)}</pre>
            <small>
              Document {doc.id} · dataset {doc.dataset_id}
            </small>
          </details>
        </article>
      ))}
      <small className="fingerprint">
        Workspace {retrieval.workspace_id} · index{" "}
        {retrieval.fingerprint.slice(0, 16)} · {retrieval.embedding_model}
      </small>
    </details>
  );
}
export function WorkflowInspector({
  run,
  connection,
}: {
  run: AnalystRun;
  connection?: string;
}) {
  return (
    <div className="workflow-section">
      <div className="workflow-progress" role="status" aria-live="polite">
        <span className="workflow-pulse" />
        <strong>{run.current_step?.replaceAll("_", " ") || run.status}</strong>
        <span>
          Attempt {formatNumber(run.attempts || 0)} /{" "}
          {run.pipeline && run.pipeline !== "agentic" ? 1 : 3}
        </span>
        {connection && <small>{connection}</small>}
      </div>
      <details className="insight-panel">
        <summary>
          Agent workflow <span>{formatNumber(run.events?.length || 0)} events</span>
        </summary>
        <ol className="workflow-events">
          {run.events?.map((event) => (
            <li key={event.id} className={"event-" + event.status}>
              <div>
                <strong>{event.step.replaceAll("_", " ")}</strong>
                <span>
                  {event.status} · attempt {formatNumber(event.attempt)}
                </span>
                <time>{formatDate(event.timestamp, "time")}</time>
              </div>
              <p>{event.summary}</p>
            </li>
          ))}
        </ol>
        <p className="insight-note">
          Decision summaries and validation outcomes. Client disconnects close
          the stream; accepted runs continue until completion or explicit
          cancellation.
        </p>
      </details>
    </div>
  );
}
export {default} from "./AnalystResultCard";
