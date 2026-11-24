import {PageHeader} from "./ui/layout";
import {Tabs} from "./ui/tabs";
import {Modal} from "./ui/overlay";
import {CURRENCY_CHOICES} from "../lib/defaultCurrency";
import {pageLabel} from "../lib/navigation";
import {EmptyState,ErrorState,LoadingState} from "./WorkspaceStates";
import KnowledgeReview from "./KnowledgeReview";
import {lifecycleApi} from "../datasetLifecycleApi";
import {useActiveDataset} from "../lib/activeDataset";
import ActiveDatasetSelector from "./ActiveDatasetSelector";
import DatasetName from "./DatasetName";
import {displayName} from "../lib/datasetNames";
import { middleEllipsis } from "../lib/filenames";
import { formatNumber } from "../lib/formatters";
import { useEffect, useState } from "react";
import {
  insightApi,
  type KnowledgeInfo,
  type KnowledgeSettings,
  type Dataset,
  type Retrieval,
} from "../api";
import { Button } from "./ui/button";
import { suggestUnit } from "../lib/unitSuggestions";
import { Card } from "./ui/layout";
import { RetrievalPanel } from "./RunInsights";
export default function KnowledgeEditor({
  datasets,
  onManage,
}: {
  datasets: Dataset[];
  onDeleted?: () => void;
  onManage?: () => void;
}) {
  const globalDataset=useActiveDataset();
  const globalId=globalDataset?.activeId;
  const [inspection,setInspection]=useState('');
  const [tab,setTab]=useState<'columns'|'metrics'>('columns');
  const [impact,setImpact]=useState<Record<string,number>|null>(null);
  const [confirmCurrency,setConfirmCurrency]=useState(false);
  const [id, setId] = useState(datasets[0]?.id || ""),
    [info, setInfo] = useState<KnowledgeInfo | null>(null),
    [settings, setSettings] = useState<KnowledgeSettings | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [question, setQuestion] = useState(""),
    [retrieval, setRetrieval] = useState<Retrieval | null>(null);
  useEffect(() => {
    if(inspection){setId(inspection);return}
    if(globalId!==undefined){setId(globalId);return}
    if (!datasets.some((d) => d.id === id)) setId(datasets[0]?.id || "");
  }, [datasets, id,globalId,inspection]);
  useEffect(() => {
    let current = true;
    setInfo(null);
    setSettings(null);
    setRetrieval(null);
    setError("");
    setNotice("");
    if (!id) return;
    insightApi
      .knowledge(id)
      .then((data) => {
        if (current) {
          setInfo(data);
          setSettings(data.settings);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [id]);
  // "Change currency" elsewhere sends the owner here; the currency choice sits on each column row of the first tab.
  useEffect(() => { try { sessionStorage.removeItem("insightiq-open-currencies"); } catch { /* optional */ } }, []);
  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const archived=!!datasets.find(d=>d.id===id)?.archived_at;
  async function refresh(){const saved=await insightApi.knowledge(id);setInfo(saved);setSettings(saved.settings);}
  const described=info?.columns.filter(c=>settings?.columns[c]?.trim()).length||0;
  const currencies=info?.columns.filter(c=>settings?.monetary_columns?.[c]?.currency&&!settings.monetary_columns[c].mixed).length||0;
  const dirty=!!info&&JSON.stringify(info.settings)!==JSON.stringify(settings);
  return (
    <div className="knowledge-workspace">
      <PageHeader title={pageLabel("Knowledge base")} description="Tell InsightIQ what your columns and key numbers mean." actions={globalDataset && datasets.length ? <ActiveDatasetSelector /> : undefined} />
      {!datasets.length ? (
        <section><EmptyState as="p">Upload a dataset to add definitions.</EmptyState><Button onClick={onManage}>Upload a dataset</Button></section>
      ) : (
        <>
          {globalDataset?<><p className="active-dataset-label"><DatasetName name={datasets.find(d=>d.id===id)?displayName(datasets.find(d=>d.id===id)!):"No active dataset"}/></p></>:<>
          <label className="knowledge-selector">
            Dataset
            <select
              value={id}
              title={datasets.find(d=>d.id===id)?.name}
              disabled={busy}
              onChange={(e) => setId(e.target.value)}
            >
              {datasets.map((d) => (
                <option value={d.id} key={d.id} title={d.name}>
                  {middleEllipsis(displayName(d))}
                </option>
              ))}
            </select>
          </label>
</>}
          {error && (
            <ErrorState as="p" role="alert" className="alert">
              Could not load your definitions ({error}). <Button variant="ghost" onClick={()=>void refresh()}>Try again</Button>
            </ErrorState>
          )}
          {notice && (
            <p role="status" className="success">
              {notice}
            </p>
          )}
          {!info && !error && <LoadingState as="p" role="status">Loading your definitions…</LoadingState>}
          {info && settings && (
            <>
            <p className="knowledge-progress" aria-label="Knowledge summary">{formatNumber(described)} of {formatNumber(info.columns.length)} columns described · {formatNumber(settings.metrics.length)} key {settings.metrics.length===1?"metric":"metrics"}</p>
            <Tabs label="Business definitions" value={tab} onChange={(v)=>setTab(v as typeof tab)} panelId="knowledge-panel" className="knowledge-tabs" items={[
              {value:"columns",label:"What your columns mean",id:"knowledge-tab-columns"},
              {value:"metrics",label:"Your key metrics",id:"knowledge-tab-metrics"},
            ]} />
            <div role="tabpanel" id="knowledge-panel" aria-labelledby={"knowledge-tab-"+tab} className="knowledge-grid">
              <Card as="form"
                id="knowledge-form"
                className="knowledge-card knowledge-definitions"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    if(JSON.stringify(info.settings.monetary_columns)!==JSON.stringify(settings.monetary_columns)&&!confirmCurrency){
                      const dependencies=await lifecycleApi.dependencies(id);setImpact(dependencies.counts);return;
                    }
                    const saved = await insightApi.saveKnowledge(id, settings);
                    setConfirmCurrency(false);setImpact(null);
                    setInfo(saved);
                    setSettings(saved.settings);
                    setRetrieval(null);
                    setNotice("Definitions saved.");
                  });
                }}
              >
                <fieldset disabled={archived||busy}>
                {tab==="columns"&&<>
                <section id="knowledge-context" className="knowledge-definition-section"><h2 tabIndex={-1}>What your columns mean</h2>
                <p className="insight-note">Describe the data and each column in your own words. Mark the columns that hold money and choose their currency; amounts then show with the right symbol. Shared with Datasets; saving does not change your file.</p>
                <label>
                  Dataset description
                  <textarea
                    value={settings.description}
                    maxLength={1000}
                    onChange={(e) =>
                      setSettings({ ...settings, description: e.target.value })
                    }
                  />
                </label>
                </section>
                <section id="knowledge-columns" className="knowledge-definition-section currency-settings">
                  {info.columns.map((name) => {
                    const money = settings.monetary_columns?.[name];
                    return (
                      <div className="knowledge-column-row" key={name}>
                        <label>
                          {name}
                          <input
                            maxLength={500}
                            value={settings.columns[name] || ""}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                columns: { ...settings.columns, [name]: e.target.value },
                              })
                            }
                          />
                        </label>
                        <span className="knowledge-currency-choice">
                          <select
                            aria-label={`Currency for ${name}`}
                            value={settings.percent_columns?.includes(name) ? "percent" : money ? (money.mixed ? "mixed" : money.currency || "unknown") : "none"}
                            onChange={(e) => {
                              const columns = { ...settings.monetary_columns };
                              const percents = (settings.percent_columns || []).filter((n) => n !== name);
                              if (e.target.value === "percent") percents.push(name);
                              if (e.target.value === "none" || e.target.value === "percent") delete columns[name];
                              else
                                columns[name] = {
                                  currency: ["unknown", "mixed"].includes(e.target.value) ? null : e.target.value,
                                  mixed: e.target.value === "mixed",
                                };
                              setSettings({
                                ...settings,
                                monetary_columns: columns,
                                percent_columns: percents,
                                units_confirmed: true,
                              });
                            }}
                          >
                            <option value="none">No unit</option>
                            <option value="percent">Percentage</option>
                            <option value="mixed">Mixed currencies (blocks totals)</option>
                            <option value="unknown">Money, currency not chosen</option>
                            {CURRENCY_CHOICES.map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                          {!settings.units_confirmed && suggestUnit(name) !== "neither" && (
                            <small>Suggested: {suggestUnit(name) === "money" ? "money" : "percentage"}. Not shown as such until you choose it.</small>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </section>
                </>}
                {tab==="metrics"&&<section id="knowledge-metrics" className="knowledge-definition-section">
                <h2 tabIndex={-1}>Your key metrics</h2>
                <p className="insight-note">A metric is a number you check often, such as “Total sales”. Describe it in plain words and give the read-only query that calculates it.</p>
                {settings.metrics.map((metric, i) => (
                  <fieldset key={i}>
                    <legend>Metric {formatNumber(i + 1)}</legend>
                    <label>
                      Name
                      <input
                        required
                        maxLength={80}
                        value={metric.name}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            metrics: settings.metrics.map((m, j) => j === i ? { ...m, name: e.target.value } : m),
                          })
                        }
                      />
                    </label>
                    <label>
                      Definition
                      <textarea
                        required
                        maxLength={800}
                        value={metric.description}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            metrics: settings.metrics.map((m, j) => j === i ? { ...m, description: e.target.value } : m),
                          })
                        }
                      />
                    </label>
                    <label>
                      Currency of this metric
                      <select
                        aria-label={`Metric ${i + 1} currency`}
                        value={metric.money?.currency || ""}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            metrics: settings.metrics.map((m, j) => j === i ? { ...m, money: e.target.value ? { currency: e.target.value } : null } : m),
                          })
                        }
                      >
                        <option value="">Not money</option>
                        {CURRENCY_CHOICES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <details className="metric-calculation" ref={(el) => { if (el && el.dataset.init !== "1") { el.dataset.init = "1"; el.open = !metric.sql.trim(); } }}>
                    <summary>Show the calculation</summary>
                    <label>
                      The calculation (a read-only query)
                      <textarea
                        required
                        maxLength={2000}
                        value={metric.sql}
                        placeholder="SELECT SUM(TRY_CAST(amount AS DOUBLE)) FROM data"
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            metrics: settings.metrics.map((m, j) => j === i ? { ...m, sql: e.target.value } : m),
                          })
                        }
                      />
                    </label>
                    </details>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSettings({ ...settings, metrics: settings.metrics.filter((_, j) => j !== i) })}
                    >
                      Remove metric {formatNumber(i + 1)}
                    </Button>
                  </fieldset>
                ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || settings.metrics.length >= 20}
                    onClick={() => setSettings({ ...settings, metrics: [...settings.metrics, { name: "", description: "", sql: "" }] })}
                  >
                    Add metric
                  </Button>
                </section>}
                <div className="knowledge-actions knowledge-save-bar">
                  {dirty&&<span className="knowledge-unsaved">Unsaved changes</span>}
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save definitions"}
                  </Button>
                </div>
                </fieldset>
              </Card>
              {impact&&<Modal open title="Currency change" label="Currency dependency impact" busy={busy} onClose={()=>setImpact(null)}
                footer={<><Button type="button" variant="outline" onClick={()=>setImpact(null)}>Cancel</Button><Button type="submit" form="knowledge-form" disabled={!confirmCurrency}>Save confirmed change</Button></>}>
                <p>Currency changes affect future answers. Dashboards and saved results keep their saved snapshots.</p>
                <ul>{Object.entries(impact).filter(([,n])=>n>0).map(([key,n])=><li key={key}>{key}: {formatNumber(n)}</li>)}</ul>
                <label><input type="checkbox" checked={confirmCurrency} onChange={e=>setConfirmCurrency(e.target.checked)}/> Confirm source-currency change</label>
              </Modal>}
              {tab==="columns"&&<KnowledgeReview key={id} id={id} archived={archived} onChanged={refresh} view="drafts"/>}
            </div>
            </>
          )}
          {(!!datasets.length&&((!!info&&!!settings)||datasets.some(d=>d.archived_at)))&&<details className="knowledge-advanced-disclosure ui-card" id="knowledge-advanced">
              <summary>Advanced: verified examples and search</summary>
              {datasets.some(d=>d.archived_at)&&<label>View an archived dataset’s definitions<select aria-label="View an archived dataset’s definitions" value={inspection} onChange={e=>setInspection(e.target.value)}><option value="">Use global dataset</option>{datasets.filter(d=>d.archived_at).map(d=><option key={d.id} value={d.id}>{displayName(d)}</option>)}</select></label>}
              {info&&settings&&<>
              <KnowledgeReview key={id} id={id} archived={archived} onChanged={refresh} view="examples"/>
              <section className="knowledge-search">
                  <h2>What Ask can find</h2>
                  <p className="insight-note">
                    Type a question to see which of your descriptions and metrics Ask would use for it.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        setRetrieval(await insightApi.retrieve(id, question));
                      });
                    }}
                  >
                    <label>
                      Question
                      <textarea
                        required
                        maxLength={2000}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="Which columns describe revenue?"
                      />
                    </label>
                    <Button variant="outline" disabled={busy || !question.trim()}>
                      Show what Ask would use
                    </Button>
                  </form>
                  {retrieval && <RetrievalPanel retrieval={retrieval} plain />}
                  <p className="insight-note">After you save changes, this list updates the next time you try a question.</p>
                </section>
              <p><button className="button button-ghost" onClick={onManage}>Manage in Datasets</button></p>
              </>}
            </details>}
        </>
      )}
    </div>
  );
}
