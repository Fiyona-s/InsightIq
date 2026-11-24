import {useAuth} from "../lib/auth";
import {freshnessHelp,freshnessLabel} from "../lib/freshness";
import { displayAmount } from "../lib/displayNumber";
import { CHART } from "../lib/chartTheme";
import {TableFrame} from "./ui/data";
import {Card,PageHeader,StatusChip} from "./ui/layout";
import {pageLabel} from "../lib/navigation";
import {ErrorState,LoadingState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import {dashboardWorkspaceApi,type Previous} from "../dashboardWorkspaceApi";
import {WidgetTitle,DuplicateDialog,DashboardCurrency} from "./DashboardWorkspaceControls";
import {useActiveDataset,useDatasetGuard} from "../lib/activeDataset";
import {useDatasetNames} from "../lib/datasetNames";
import {middleEllipsis} from "../lib/filenames";
import DatasetName from "./DatasetName";
import { formatNumber } from "../lib/formatters";
import {
  CurrencyControls,
  displayMoney,
  useCurrency,
  currencies,
} from "../lib/currency";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  RefreshCw,
  GripVertical,
  Copy,
  Trash2,
  Download,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  phase4Api,
  type Dashboard,
  type DashboardSummary,
  type SavedChart,
  type Widget,
} from "../phase4api";
import { Button } from "./ui/button";
import { Drawer, Modal } from "./ui/overlay";
import { Menu } from "./ui/menu";
import { tileTitle } from "../lib/tileTitle";
import { useTechnicalDetails } from "../lib/technicalDetails";
import { Tabs } from "./ui/tabs";
import FilterEditor from "./FilterEditor";
import { SQLCode } from "./RunInsights";
const ResultChart = lazy(() => import("./ResultChart"));
export function ResultTable({
  result,
  displayId = "",
}: {
  displayId?: string;
  result: NonNullable<Widget["result"]>;
}) {
  const state = useCurrency(displayId);
  return (
    <TableFrame label="Widget result rows" className="dashboard-table">
      <table>
        <thead>
          <tr>
            {result.columns.map((c, i) => (
              <th scope="col" key={i}>
                {c.name}
                <small>{c.type}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, 100).map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j} title={`Original value: ${v ?? "NULL"}`}>
                  {v === null ? (
                    <span className="null">NULL</span>
                  ) : (
                    displayAmount(v, result.columns[j].money, state, result.columns[j].type, result.columns[j].percent)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!result.rows.length && (
        <p className="empty-results">
          No matching output rows. This is a valid result.
        </p>
      )}
      {result.rows.length > 100 && (
        <p className="insight-note">
          Showing first 100 of {formatNumber(result.rows.length)} rows. Export CSV for all
          values.
        </p>
      )}
    </TableFrame>
  );
}
async function exportPng(element: HTMLElement, title: string) {
  const svg = element.querySelector("svg.recharts-surface");
  if (!svg)
    throw new Error(
      "PNG export requires a rendered chart. KPI and table data are available as CSV/PDF.",
    );
  const clone = svg.cloneNode(true) as SVGElement;
  const box = svg.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.min(1800, box.width)));
  clone.setAttribute("height", String(Math.min(1400, box.height)));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml;charset=utf-8",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(3600, Math.ceil(box.width * 2));
    canvas.height = Math.min(2800, Math.ceil(box.height * 2));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas export unavailable.");
    ctx.fillStyle = CHART.surface;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("PNG export failed.");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = title.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) + ".png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export default function DashboardPage({initialDashboardId=""}:{initialDashboardId?:string}={}) {
  const globalDataset=useActiveDataset();
  // Login on: a Viewer reads dashboards only; changing needs Analyst, deleting a dashboard needs Owner. Login off: everything, as before.
  const auth=useAuth(),canChange=auth.can("analyst"),canDelete=auth.can("owner");
  const [technical]=useTechnicalDetails();
  const [refreshSummary,setRefreshSummary]=useState<{id:string;title:string;status:string;error:string|null}[]>([]);
  const [refreshing,setRefreshing]=useState<Widget|'all'|null>(null);
  const [refreshErrors,setRefreshErrors]=useState<Record<string,string>>({});
  const [previous,setPrevious]=useState<{title:string;items:Previous[]}|null>(null);
  const [duplicates,setDuplicates]=useState<{chartId:string;matches:string[]}|null>(null);
  const [reportCurrency, setReportCurrency] = useState("");
  const names=useDatasetNames();
  const [list, setList] = useState<DashboardSummary[]>([]),
    [library, setLibrary] = useState<SavedChart[]>([]),
    [selected, setSelected] = useState(initialDashboardId),
    [doc, setDoc] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [newTitle, setNewTitle] = useState(""),
    [chartId, setChartId] = useState(""),
    [note, setNote] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [creating, setCreating] = useState(false),
    [libraryOpen, setLibraryOpen] = useState(false),
    [noteOpen, setNoteOpen] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    [detail, setDetail] = useState<Widget | null>(null),
    [detailTab, setDetailTab] = useState<"data" | "evidence">("data"),
    [widgetToDelete, setWidgetToDelete] = useState<Widget | null>(null);
  const [editingId,setEditingId]=useState<string|null>(null),[titleDraft,setTitleDraft]=useState(''),[descriptionDraft,setDescriptionDraft]=useState(''),[finishPrompt,setFinishPrompt]=useState(false);
  const editing=!!doc&&editingId===doc.id;
  const detailsDirty=!!doc&&(titleDraft!==doc.title||descriptionDraft!==doc.description);
  useEffect(()=>{setTitleDraft(doc?.title||'');setDescriptionDraft(doc?.description||'')},[doc?.id,doc?.title,doc?.description]);
  useEffect(()=>{if(initialDashboardId)setSelected(initialDashboardId)},[initialDashboardId]);
  const globalId=globalDataset?.activeId;
  useEffect(()=>{setChartId(library.find(chart=>chart.dataset_id===globalId)?.id||"")},[globalId,library]);
  const dragged = useRef<string | null>(null),
    grid = useRef<HTMLDivElement>(null);
  useDatasetGuard('dashboard-details',()=>{
    if(editing&&grid.current?.querySelector('input[aria-label="Widget title"]'))return {title:'Finish chart title edit',message:'Save or cancel the chart title edit before leaving this dashboard.',blocked:true};
    return editing&&detailsDirty&&doc?{title:'Unsaved dashboard details',message:'Save or discard the title or description before leaving this dashboard.',save:()=>commit({...doc,title:titleDraft,description:descriptionDraft}),discard:()=>{setTitleDraft(doc.title);setDescriptionDraft(doc.description)}}:null;
  });
  useEffect(()=>{if(!editing||!detailsDirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[editing,detailsDirty]);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboards, charts] = await Promise.all([
        phase4Api.dashboards(),
        canChange ? phase4Api.charts() : Promise.resolve([]),         // a viewer reaches only what is pinned: no saved-chart call
      ]);
      setList(dashboards);
      setLibrary(charts);
      setSelected((current) =>
        dashboards.some((d) => d.id === current)
          ? current
          : dashboards[0]?.id || "",
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [canChange]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    let current = true;
    setDoc(null);
    setEditingId(current=>current===selected?current:null);setFinishPrompt(false);
    setConfirmDelete(false);
    setRefreshing(null);setPrevious(null);setDuplicates(null);setRefreshErrors({});setRefreshSummary([]);setReportCurrency("");
    if (!selected) return;
    setLoading(true);
    phase4Api
      .dashboard(selected)
      .then((d) => {
        if (current) setDoc(d);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selected]);
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function commit(next: Dashboard) {
    return action(async () => {
      const saved = await phase4Api.saveDashboard(next);
      setDoc(saved);
      setList((list) =>
        list.map((d) =>
          d.id === saved.id
            ? { ...saved, widget_count: saved.widgets.length }
            : d,
        ),
      );
      setNotice(next.title===doc?.title&&next.description===doc?.description?"Layout saved.":"Dashboard saved.");
    });
  }
  function editWidget(id: string, patch: Partial<Widget>) {
    if (doc)
      void commit({
        ...doc,
        widgets: doc.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      });
  }
  async function attach(chart:string,choice='cancel',matches:string[]=[]){
    if(!doc)return;
    await action(async()=>{const result=await dashboardWorkspaceApi.attach(doc.id,chart,doc.revision,choice,matches[0]);if(result.duplicate){setDuplicates({chartId:chart,matches:result.matches})}else{setDoc(result.dashboard);setDuplicates(null);setNotice('Chart added.')}});
  }
  async function refreshConfirmed(){
    if(!doc||!refreshing)return;
    const target=refreshing;
    await action(async()=>{if(target==='all'){const response=await dashboardWorkspaceApi.all(doc.id,doc.revision);setDoc(response.dashboard);setRefreshSummary(response.results.map(r=>({...r,title:(()=>{const t=doc.widgets.find(w=>w.id===r.id);return t?tileTitle(t):'Chart'})()})));setRefreshErrors(Object.fromEntries(response.results.filter(r=>r.error).map(r=>[r.id,r.error!])));setNotice('Refresh all: '+response.results.filter(r=>r.status==='success').length+' succeeded; '+response.results.filter(r=>r.status==='failed').length+' failed.');}else{try{setDoc(await dashboardWorkspaceApi.refresh(doc.id,target.id,doc.revision,target.source?.result_hash||undefined));setRefreshErrors(v=>({...v,[target.id]:''}));setNotice('Snapshot refreshed. Previous snapshot kept in history.')}catch(e){setRefreshErrors(v=>({...v,[target.id]:(e as Error).message}));throw e;}}setRefreshing(null);});
  }
  function move(id: string, target: number) {
    if (!doc || target < 0 || target >= doc.widgets.length) return;
    const widgets = [...doc.widgets];
    const index = widgets.findIndex((w) => w.id === id);
    if (index < 0) return;
    const [widget] = widgets.splice(index, 1);
    widgets.splice(target, 0, widget);
    void commit({ ...doc, widgets });
  }
  function canLeaveDetails(){
    const pending=grid.current?.querySelector<HTMLInputElement>('input[aria-label="Widget title"]');
    if(pending){setNotice('Save or cancel the chart title edit first.');pending.focus();return false}
    return true;
  }
  const hasCurrency=!!doc&&doc.widgets.some(w=>w.result?.columns.some(c=>c.money?.currency));
  const sourceIds=doc?Array.from(new Set(doc.widgets.filter(w=>w.kind==="chart"&&w.source).map(w=>w.source!.dataset_id))):[];
  const sharedDataset=sourceIds.length===1;
  function switchTo(id:string){if(!canLeaveDetails())return;if(detailsDirty){setNotice("Save or discard dashboard details before switching dashboards.");return}setEditingId(null);setSelected(id)}
  function finishEditing(){if(!canLeaveDetails())return;if(detailsDirty)setFinishPrompt(true);else setEditingId(null)}
  return (
    <div className={editing?"dashboards-page dashboard-edit-mode":"dashboards-page dashboard-view-mode"}>
      <PageHeader title={pageLabel("Dashboards")} description="Your saved charts and numbers in one place." />
      <Card as="div" className="dashboard-manager">
        {list.length>0&&<Tabs label="Dashboards" value={selected} onChange={switchTo} items={list.map(d=>({value:d.id,label:d.title,id:"dashboard-tab-"+d.id}))} />}
        <div className="dashboard-manager-actions">
          {canChange&&<Button variant="outline" disabled={busy} onClick={()=>{if(!canLeaveDetails())return;if(detailsDirty){setNotice('Save or discard dashboard details before creating another dashboard.');return}setCreating(true)}}><Plus size={15} aria-hidden="true" /> New dashboard</Button>}
          {canChange&&<Button variant="ghost" onClick={()=>setLibraryOpen(true)}>Saved charts · {formatNumber(library.length)}</Button>}
        </div>
      </Card>
      <Modal open={creating} title="New dashboard" busy={busy} onClose={()=>setCreating(false)}
        footer={<><Button variant="outline" disabled={busy} onClick={()=>setCreating(false)}>Cancel</Button><Button type="submit" form="new-dashboard-form" disabled={busy||!newTitle.trim()}>Create dashboard</Button></>}>
        <form id="new-dashboard-form" onSubmit={(e)=>{e.preventDefault();void action(async()=>{const created=await phase4Api.createDashboard(newTitle);setNewTitle("");setCreating(false);await reload();setEditingId(created.id);setSelected(created.id)})}}>
          <label>
            New dashboard title
            <input required maxLength={120} value={newTitle} onChange={(e)=>setNewTitle(e.target.value)} placeholder="Quarterly review" autoFocus />
          </label>
        </form>
      </Modal>
      {error && (
        <ErrorState as="div" role="alert" className="alert">
          {error}
          <Button variant="ghost" disabled={busy} onClick={() => void reload()}>
            Reload dashboards
          </Button>
        </ErrorState>
      )}
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      {!!refreshSummary.length&&<ul aria-label="Refresh all results" className="refresh-summary">{refreshSummary.map(r=><li key={r.id}>{r.title}: {r.status}{r.error?" · "+r.error:""}</li>)}</ul>}
      {loading && (
        <LoadingState as="div" role="status" className="skeleton-block">
          Loading dashboards…
        </LoadingState>
      )}
      {!loading && !doc && (
        <Card className="premium-empty">
          <Plus size={28} />
          <h2>{canChange?"Create a dashboard":"No dashboards yet"}</h2>
          <p>
            {canChange?"Save results from Ask or add charts from your library.":"An analyst or owner can pin answers to a dashboard."}
          </p>
        </Card>
      )}
      {doc && (
        <>
          <Card className="dashboard-settings">
            <div className="dashboard-heading">
              <div>
                {editing?<><label>
                  Dashboard title
                  <input
                    value={titleDraft}
                    maxLength={120}
                    onChange={(e) => setTitleDraft(e.target.value)}
                  />
                </label>
                <details className="dashboard-description">
                  <summary>Description</summary>{" "}
                  <label>
                    Dashboard description
                    <textarea
                      maxLength={2000}
                      value={descriptionDraft}
                      onChange={(e) =>
                        setDescriptionDraft(e.target.value)
                      }
                    />
                  </label>
                </details></>:<><h2 className="dashboard-view-title">{doc.title}</h2>{doc.description&&<p className="dashboard-view-description">{doc.description}</p>}</>}
                {editing&&detailsDirty&&<small role="status" className="dashboard-unsaved-details">Unsaved title or description</small>}
                {doc.updated_at&&<span className="dashboard-saved-date muted-date">Updated {formatDate(doc.updated_at,"date")}</span>}
              </div>
              <div className="toolbar">
                {editing&&detailsDirty&&<Button disabled={busy||!titleDraft.trim()} onClick={()=>void commit({...doc,title:titleDraft,description:descriptionDraft})}>Save details</Button>}
                {canChange&&(editing?<Button variant="outline" disabled={busy} onClick={finishEditing}>Done editing</Button>:<Button variant="outline" disabled={busy} onClick={()=>setEditingId(doc.id)}>Edit dashboard</Button>)}
                <a className="button button-primary" href={`/api/dashboards/${doc.id}/report.pdf${reportCurrency?'?target_currency='+reportCurrency:''}`} download title="A printable report of your numbers. The last pages show how they were calculated.">Export PDF</a>
                <Menu label="More actions" items={[
                  ...(canChange?[{label:"Duplicate dashboard",disabled:busy,onSelect:()=>void action(async()=>{const duplicate=await phase4Api.duplicateDashboard(doc.id);await reload();setSelected(duplicate.id)})}]:[]),
                  {label:"Export PDF without calculation pages",href:`/api/dashboards/${doc.id}/report.pdf?appendix=false${reportCurrency?'&target_currency='+reportCurrency:''}`,download:true},
                  ...(canChange?[{label:"Refresh all",disabled:busy||!doc.widgets.some(w=>w.freshness?.can_refresh),onSelect:()=>setRefreshing('all')}]:[]),
                  ...(canDelete?[{label:"Delete dashboard",danger:true,disabled:busy,onSelect:()=>setConfirmDelete(true)}]:[]),
                ]}/>
                {hasCurrency&&<DashboardCurrency key={doc.id} dashboardId={doc.id} widgets={doc.widgets} onTarget={setReportCurrency}/>}
              </div>
            </div>
          </Card>
          {editing&&<div className="dashboard-edit-toolbar" role="group" aria-label="Edit tools">
            <Button variant="outline" onClick={()=>setLibraryOpen(true)}>Add chart</Button>
            <Button variant="outline" onClick={()=>setNoteOpen(true)}>Add note</Button>
            <Button variant="outline" onClick={()=>setFiltersOpen(true)}>Filters{doc.filters.length?` · ${formatNumber(doc.filters.length)}`:""}</Button>
            <small className="insight-note">Drag tiles or use the arrow buttons to reorder. Changes save automatically.</small>
          </div>}
          {finishPrompt&&<Modal open title="Save dashboard details?" label="Unsaved dashboard details" busy={busy} onClose={()=>setFinishPrompt(false)}
            footer={<><Button variant="outline" disabled={busy} onClick={()=>setFinishPrompt(false)}>Keep editing</Button><Button variant="outline" disabled={busy} onClick={()=>{setTitleDraft(doc.title);setDescriptionDraft(doc.description);setFinishPrompt(false);setEditingId(null)}}>Discard details and view</Button><Button disabled={busy||!titleDraft.trim()} onClick={()=>void (async()=>{if(await commit({...doc,title:titleDraft,description:descriptionDraft})){setFinishPrompt(false);setEditingId(null)}})()}>Save and view</Button></>}>
            <p>Layout changes are already saved. The title or description still has unsaved changes.</p></Modal>}
          {confirmDelete && <Modal open title="Delete this dashboard?" label="Delete dashboard" busy={busy} onClose={()=>setConfirmDelete(false)}
            footer={<><Button variant="outline" onClick={() => setConfirmDelete(false)}>Keep dashboard</Button><Button variant="danger" disabled={busy} onClick={() => void action(async () => { await phase4Api.deleteDashboard(doc.id); await reload(); })}>Delete dashboard permanently</Button></>}>
            <p>Delete dashboard “{doc.title}”? Saved charts remain in the library.</p></Modal>}
          {duplicates&&<DuplicateDialog disabled={busy} onChoice={choice=>{if(choice==='cancel')setDuplicates(null);else void attach(duplicates.chartId,choice,duplicates.matches)}}/>}
          {refreshing&&<Modal open title={refreshing==='all'?'Refresh all charts?':'Refresh chart?'} label="Confirm snapshot refresh" busy={busy} onClose={()=>setRefreshing(null)}
            footer={<><Button disabled={busy} variant="outline" onClick={()=>setRefreshing(null)}>Cancel refresh</Button><Button disabled={busy} onClick={()=>void refreshConfirmed()}>Confirm refresh</Button></>}>
            <p>Re-runs the saved query on the current data. The new result replaces the displayed snapshot. The previous snapshot is kept in history.</p></Modal>}
          {previous&&<Modal open title={`${previous.title} · Previous snapshots`} label="Previous snapshots" onClose={()=>setPrevious(null)}
            footer={<Button onClick={()=>setPrevious(null)}>Close history</Button>}>
            <p>Read-only · Up to 3 previous snapshots are retained.</p>{previous.items.map(item=><details key={item.id}><summary>Saved result · data as of {formatDate(item.chart.data_as_of||item.chart.last_successful_refresh, "datetime")}</summary>{item.chart.snapshot&&<ResultTable result={{...item.chart.snapshot,columns:item.chart.snapshot.columns.map((c,i)=>({...c,money:c.money||item.chart.currency_metadata?.[String(i)]}))}}/>}</details>)}</Modal>}
          {!editing&&!!doc.filters.length&&<div className="dashboard-view-filters"><details><summary>Saved filters · {formatNumber(doc.filters.length)}</summary>{doc.filters.map((filter,index)=><p key={index}>{filter.column} · {filter.kind} · {filter.kind==='category'?filter.values.join(', '):`${filter.minimum||'any'} → ${filter.maximum||'any'}`}</p>)}<p>These filters select saved result rows; source metrics are not recalculated.</p><Button variant="outline" onClick={()=>setEditingId(doc.id)}>Edit filters</Button></details></div>}
          {sharedDataset&&<p className="dashboard-source">Data: <DatasetName name={doc.widgets.find(w=>w.source)?.freshness?.label||names.label(sourceIds[0],doc.widgets.find(w=>w.source)?.source?.dataset_name||"",true)}/></p>}
          <div className="dashboard-grid" ref={grid}>
            {doc.widgets.map((widget, index) => (
              <Card
                as="article"
                key={widget.id}
                className="dashboard-widget"
                style={{
                  gridColumn: `span ${widget.width}`,
                  minHeight: widget.chart?.spec.kind === "kpi" ? undefined : widget.height * 85,
                }}
                data-widget-id={widget.id}
                id={"widget-"+widget.id} tabIndex={-1}
                onDragOver={(e) => {
                  if (editing&&dragged.current) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(e) => {
                  if(!editing)return;
                  e.preventDefault();
                  const identifier =
                    dragged.current || e.dataTransfer.getData("text/plain");
                  if (
                    identifier &&
                    doc.widgets.some((w) => w.id === identifier)
                  )
                    move(identifier, index);
                  dragged.current = null;
                }}
              >
                <div className="widget-header">
                  {editing&&<button
                    className="drag-handle"
                    aria-label={"Drag widget " + (index + 1)}
                    draggable={!busy}
                    disabled={busy}
                    onDragStart={(e) => {
                      dragged.current = widget.id;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", widget.id);
                    }}
                    onDragEnd={() => {
                      dragged.current = null;
                    }}
                  >
                    <GripVertical size={16} />
                  </button>}
                  {widget.kind==='chart'&&editing?<WidgetTitle widget={widget} disabled={busy} onSave={async title=>{const saved=await dashboardWorkspaceApi.title(doc.id,widget.id,title,doc.revision);setDoc(saved)}}/>:<h2>{tileTitle(widget)}</h2>}
                  {editing&&<div className="widget-actions">
                    <button
                      disabled={busy || !index}
                      aria-label={"Move widget " + (index + 1) + " up"}
                      onClick={() => move(widget.id, index - 1)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      disabled={busy || index === doc.widgets.length - 1}
                      aria-label={"Move widget " + (index + 1) + " down"}
                      onClick={() => move(widget.id, index + 1)}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      disabled={busy}
                      aria-label={"Duplicate widget " + (index + 1)}
                      onClick={()=>void action(async()=>{if(widget.kind==='chart')setDoc(await dashboardWorkspaceApi.duplicate(doc.id,widget.id));else await commit({...doc,widgets:[...doc.widgets,{...widget,id:crypto.randomUUID()}]})})}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      disabled={busy}
                      aria-label={"Delete widget " + (index + 1)}
                      onClick={() => setWidgetToDelete(widget)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>}
                </div>
                {editing&&<details className="widget-layout">
                  <summary>Layout</summary>
                  <div className="widget-sizing">
                    <label>
                      Width
                      <select
                        aria-label={"Widget width " + (index + 1)}
                        disabled={busy}
                        value={widget.width}
                        onChange={(e) =>
                          editWidget(widget.id, {
                            width: Number(e.target.value),
                          })
                        }
                      >
                        {[3, 6, 9, 12].map((n) => (
                          <option key={n} value={n}>
                            {formatNumber(n)}/12
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Height
                      <input
                        aria-label={"Widget height " + (index + 1)}
                        type="range"
                        min={2}
                        max={8}
                        defaultValue={widget.height}
                        disabled={busy}
                        onPointerUp={(e) =>
                          editWidget(widget.id, {
                            height: Number(e.currentTarget.value),
                          })
                        }
                        onKeyUp={(e) => {
                          if (
                            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                              e.key,
                            )
                          )
                            editWidget(widget.id, {
                              height: Number(e.currentTarget.value),
                            });
                        }}
                      />
                    </label>
                  </div>
                </details>}
                {widget.kind === "text" ? (
                  <div className="text-widget">
                    <span className="eyebrow">USER-AUTHORED NOTE</span>
                    <p>{widget.text}</p>
                  </div>
                ) : (
                  <>
                    {widget.error && (
                      <ErrorState as="p" role="alert" className="alert">
                        {widget.error}
                      </ErrorState>
                    )}
                    {widget.source && (
                      <>
                        <div className="widget-provenance">{(widget.source.data_as_of||widget.source.last_successful_refresh)&&<StatusChip>Updated {formatDate(widget.source.data_as_of||widget.source.last_successful_refresh,"date")}</StatusChip>}{!sharedDataset&&<span><DatasetName name={widget.freshness?.label||names.label(widget.source.dataset_id,widget.source.dataset_name,true)}/></span>}{widget.freshness?.status&&<StatusChip title={freshnessHelp(widget.freshness.status)} tone={widget.freshness.status==="Current"?"success":widget.freshness.status==="Source changed"||widget.freshness.status==="Source unavailable"?"warning":"neutral"}>{freshnessLabel(widget.freshness.status)}</StatusChip>}{widget.freshness?.archived&&<StatusChip tone="warning">Archived dataset</StatusChip>}</div>
                        {!!widget.matching_widget_ids?.length&&<div className="duplicate-indicator"><span>Possible duplicate</span><a href={'#widget-'+widget.matching_widget_ids[0]} onClick={e=>{e.preventDefault();const match=document.querySelector<HTMLElement>(`[data-widget-id="${widget.matching_widget_ids![0]}"]`);match?.scrollIntoView({behavior:'smooth',block:'center'});match?.focus()}}>Show matching chart</a></div>}
                        {refreshErrors[widget.id]&&<ErrorState as="div" role="alert">Refresh failed. Existing snapshot retained.<details><summary>View details</summary>{refreshErrors[widget.id]}</details></ErrorState>}
                        {widget.source.error && (
                          <ErrorState as="p" role="alert" className="alert">
                            Refresh failed: {widget.source.error}. Last good
                            snapshot retained.
                          </ErrorState>
                        )}
                        {widget.filters_applied?.unavailable.map((f, i) => (
                          <p key={i} className="filter-unavailable">
                            {f.column}: not applicable — {f.reason}
                          </p>
                        ))}
                        <div className="toolbar tile-toolbar">
                          {editing&&<label>
                            Chart type
                            <select
                              aria-label={"Widget chart type " + (index + 1)}
                              disabled={busy}
                              value={widget.chart?.spec.kind || "table"}
                              onChange={(e) =>
                                editWidget(widget.id, {
                                  spec:
                                    widget.chart_options?.find(
                                      (o) => o.kind === e.target.value,
                                    ) || null,
                                })
                              }
                            >
                              {widget.chart_options?.map((s) => (
                                <option value={s.kind} key={s.kind}>
                                  {s.kind}
                                </option>
                              ))}
                            </select>
                          </label>}
                          <Menu variant="ghost" label={"Actions for "+tileTitle(widget)} items={[
                            ...(canChange?[{label:"Refresh",disabled:busy||!widget.freshness?.can_refresh,title:widget.freshness?.reason||undefined,onSelect:()=>setRefreshing(widget)}]:[]),
                            ...(widget.history_count?[{label:"View previous snapshot",disabled:busy,onSelect:()=>void action(async()=>{const value=await dashboardWorkspaceApi.history(doc.id,widget.id);setPrevious({title:tileTitle(widget),items:value.snapshots})})}]:[]),
                            ...(widget.chart?.spec.kind!=="table"&&widget.chart?.spec.kind!=="kpi"?[{label:"Download PNG",onSelect:()=>{const card=document.querySelector<HTMLElement>(`[data-widget-id="${widget.id}"]`);if(card)void exportPng(card,widget.title||"chart").catch((e)=>setError(e.message))}}]:[]),
                            {label:"Download CSV",href:`/api/dashboards/${doc.id}/widgets/${widget.id}/results.csv`,download:true},
                            {label:"Details",onSelect:()=>{setDetailTab("data");setDetail(widget)}},
                          ]}/>
                        </div>
                        {editing&&widget.currency_metadata_available &&
                          widget.source?.snapshot_digest && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              title="Use confirmed dataset currencies without changing saved values"
                              onClick={() =>
                                void action(async () => {
                                  await phase4Api.confirmChartCurrency(
                                    widget.chart_id!,
                                    widget.source!.snapshot_digest!,
                                  );
                                  setDoc(await phase4Api.dashboard(doc.id));
                                  setNotice(
                                    "Source currencies applied. Original snapshot values are unchanged.",
                                  );
                                })
                              }
                            >
                              Apply confirmed currencies
                            </Button>
                          )}
                        {widget.chart && (
                          <Suspense
                            fallback={<LoadingState as="p" role="status">Loading chart…</LoadingState>}
                          >
                            {widget.result && !reportCurrency && (
                              <CurrencyControls
                                id={widget.id}
                                exportUrl={`/api/dashboards/${doc.id}/widgets/${widget.id}/results.csv`}
                                columns={widget.result.columns}
                              />
                            )}
                            <ResultChart
                              data={widget.chart}
                              displayId={widget.id}
                            />
                          </Suspense>
                        )}
                        {widget.fallback_reason && (
                          <p className="insight-note">
                            {widget.fallback_reason}
                          </p>
                        )}
                        {widget.result && widget.chart?.spec.kind === "table" && (
                          <ResultTable displayId={widget.id} result={widget.result} />
                        )}
                        {!!widget.filters.length&&<p className="widget-saved-filters">{formatNumber(widget.filters.length)} saved widget filters · {editing?"Change them under Filters":"Configure in Edit"}</p>}
                      </>
                    )}
                  </>
                )}
              </Card>
            ))}
          </div>
          {!doc.widgets.length && (
            <Card className="premium-empty">
              <h2>Your canvas is ready</h2>
              <p>{editing?'Add a saved result or a clearly labeled insight note below.':'Choose Edit dashboard to add a saved chart or note.'}</p>
            </Card>
          )}
        </>
      )}
      <Modal open={libraryOpen} title="Saved charts" busy={busy} onClose={()=>setLibraryOpen(false)} footer={<Button onClick={()=>setLibraryOpen(false)}>Close</Button>}>
        {doc&&editing?<div className="library-add">
          <label>
            Chart library
            <select value={chartId} onChange={(e) => setChartId(e.target.value)}>
              <option value="">Choose an actual saved result</option>
              {library.filter(chart=>!names.unavailable(chart.dataset_id)).map((chart) => (
                <option value={chart.id} key={chart.id} title={names.label(chart.dataset_id,chart.dataset_name,true)}>
                  {chart.title} · {middleEllipsis(names.label(chart.dataset_id,chart.dataset_name,true))}
                </option>
              ))}
            </select>
          </label>
          {globalDataset&&chartId&&library.find(c=>c.id===chartId)?.dataset_id!==globalDataset.activeId&&<p className="dataset-override">Using a different dataset from the global selection. <Button variant="ghost" onClick={()=>setChartId(library.find(c=>c.dataset_id===globalDataset.activeId&&!names.unavailable(c.dataset_id))?.id||"")}>Use global</Button></p>}
          <Button disabled={busy || !chartId || doc.widgets.length >= 24} onClick={()=>{setLibraryOpen(false);void attach(chartId)}}>Add chart widget</Button>
        </div>:<p className="insight-note">{doc?"Choose Edit dashboard to add a saved chart to this dashboard.":"Create a dashboard to add saved charts to it."}</p>}
        <h3>Your saved charts</h3>
        <p className="insight-note">Deleting a dashboard keeps its saved charts here. Remove a chart from every dashboard before deleting it.</p>
        {!library.length&&<p>No saved charts yet. Pin an answer from Ask.</p>}
        {library.map((chart) => (
          <div key={chart.id} className="library-row">
            <strong>{chart.title}</strong>
            <small><DatasetName name={chart.dataset_name} datasetId={chart.dataset_id} provenance /> · {chart.refresh_policy}</small>
            <Button variant="ghost" disabled={busy} onClick={() => void action(async () => { await phase4Api.deleteChart(chart.id); setLibrary(await phase4Api.charts()); })}>Delete saved chart</Button>
          </div>
        ))}
      </Modal>
      {doc&&<Modal open={!!widgetToDelete} title="Delete this widget?" label="Delete widget" busy={busy} onClose={()=>setWidgetToDelete(null)}
        footer={<><Button variant="outline" disabled={busy} onClick={()=>setWidgetToDelete(null)}>Keep widget</Button><Button variant="danger" disabled={busy} onClick={()=>{const target=widgetToDelete;if(!target)return;setWidgetToDelete(null);void commit({...doc,widgets:doc.widgets.filter((w)=>w.id!==target.id)})}}>Delete widget</Button></>}>
        <p>Delete this widget? Saved charts remain in your library.</p></Modal>}
      <Modal open={noteOpen} title="Add a note" onClose={()=>setNoteOpen(false)}
        footer={<><Button variant="outline" onClick={()=>setNoteOpen(false)}>Cancel</Button><Button disabled={busy || !note.trim() || !doc || doc.widgets.length >= 24} onClick={()=>{if(!doc)return;void commit({...doc,widgets:[...doc.widgets,{id:crypto.randomUUID(),chart_id:null,kind:"text",title:"Insight note",text:note,spec:null,filters:[],width:6,height:3}]});setNote("");setNoteOpen(false)}}>Add note widget</Button></>}>
        <label>
          Insight note
          <textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your interpretation, assumptions or next steps" />
        </label>
        <p className="insight-note">Notes are shown on the dashboard as your own words, labelled as a user-authored note.</p>
      </Modal>
      {doc&&<Drawer open={filtersOpen} title="Filters" onClose={()=>setFiltersOpen(false)}>
        <FilterEditor label="Dashboard filters" disabled={busy} filters={doc.filters} result={doc.widgets.find((w) => w.result)?.result} onChange={(filters) => void commit({ ...doc, filters })} />
        {doc.widgets.map((widget,index)=>widget.kind==="chart"&&widget.source?<FilterEditor key={widget.id} label={"Widget " + (index + 1) + " filters"} disabled={busy} result={widget.result} filters={widget.filters} onChange={(filters) => editWidget(widget.id, { filters })} />:null)}
      </Drawer>}
      <Drawer open={!!detail} title={`${detail?tileTitle(detail):"Chart"} · Details`} onClose={()=>setDetail(null)}>
        {detail&&detail.source&&<>
          <Tabs label="Tile details" value={detailTab} onChange={(v)=>setDetailTab(v as "data"|"evidence")} items={[{value:"data",label:"Exact rows",id:"detail-tab-data"},...(technical?[{value:"evidence",label:"Evidence & provenance",id:"detail-tab-evidence"}]:[])]} />
          {detailTab==="data"&&detail.result&&<div role="tabpanel" aria-labelledby="detail-tab-data"><p className="insight-note">{detail.source.question} · Source: <DatasetName name={detail.freshness?.label||names.label(detail.source.dataset_id,detail.source.dataset_name,true)}/> · Data as of {formatDate(detail.source.data_as_of||detail.source.last_successful_refresh,"date")}</p><h3>Exact result rows · {formatNumber(detail.result.row_count)}</h3><ResultTable displayId={detail.id} result={detail.result} /></div>}
          {detailTab==="evidence"&&technical&&<div role="tabpanel" aria-labelledby="detail-tab-evidence" className="widget-evidence">
            <p>Saved result · data as of {formatDate(detail.source.data_as_of||detail.source.last_successful_refresh, "datetime")}</p>
            <p>Source: <DatasetName name={detail.freshness?.label||names.label(detail.source.dataset_id,detail.source.dataset_name,true)}/> · {freshnessLabel(detail.freshness?.status)}</p>{freshnessHelp(detail.freshness?.status)&&<p className="insight-note">{freshnessHelp(detail.freshness?.status)}</p>}
            <p>{detail.source.question}</p>
            {detail.evidence?.facts.slice(0, 12).map((f) => (<p key={f.id}>[{f.id}] {f.statement}</p>))}
            {detail.summary?.map((n) => (<p key={n.fact_id}>AI-selected computed narrative: {n.text}</p>))}
            <pre><SQLCode sql={detail.source.sql} /></pre>
            <p className="fingerprint">Result {detail.evidence?.result_digest}</p>
          </div>}
        </>}
      </Drawer>
    </div>
  );
}
