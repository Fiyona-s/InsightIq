import DatasetTabs,{datasetTabId} from "./components/DatasetTabs";
import WorkspaceSettings from "./components/WorkspaceSettings";
import {ErrorState,LoadingState} from "./components/WorkspaceStates";
import DialogAccessibility from "./components/DialogAccessibility";
import DatasetHealth from "./components/DatasetHealth";
import DatasetCurrency from "./components/DatasetCurrency";
import DatasetProfile from "./components/DatasetProfile";
import DatasetHistory from "./components/DatasetHistory";
import {ActiveDatasetProvider,useActiveDataset} from "./lib/activeDataset";
import {adminPages,bookmarkedPage,pageLabel,pageRoutes} from "./lib/navigation";
import {AdminToolsProvider,ADMIN_NOTICE,useAdminNotice,useAdminTools} from "./lib/adminTools";
import TopMenu from "./components/TopMenu";
import ProjectSwitcher from "./components/ProjectSwitcher";
import ProjectsPage from "./components/ProjectsPage";
import {ProjectProvider} from "./lib/projects";
import DesignPage from "./components/DesignPage";
import {Card,PageHeader} from "./components/ui/layout";
import {EmptyState} from "./components/ui/states";
import {Drawer,Modal} from "./components/ui/overlay";
import {ToastProvider} from "./components/ui/toast";
import DatasetManager from "./components/DatasetManager";
import {displayName} from "./lib/datasetNames";
import DatasetName from "./components/DatasetName";
import { formatNumber } from "./lib/formatters";
import DatasetEditor from "./components/DatasetEditor";
import AutoMLStudio from "./components/AutoMLStudio";
import ExecutionTracesPage from "./components/ExecutionTracesPage";
import DashboardPage from "./components/DashboardPage";
import EvaluationPage from "./components/EvaluationPage";
import AnalyticsPage, { Overview } from "./components/AnalyticsPage";
import { BackupInfoPage, ChangeHistoryPage } from "./components/AdminExtras";
import KnowledgeEditor from "./components/KnowledgeEditor";
import Analyst from "./components/Analyst";
import Sidebar, { modules } from "./components/Sidebar";
import { useCallback,useMemo,useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Database,
  Loader2,
  Wrench,
  Menu,
  Plus,
  Search,
  Table2,
  UploadCloud,
  X,
} from "lucide-react";
import { api, type Dataset, type UploadProgress } from "./api";
import { useUploadLimits } from "./lib/uploadLimits";
import { useStillWorking } from "./lib/stillWorking";
import ErrorBoundary from "./components/ErrorBoundary";
import { plainUploadError } from "./lib/uploadErrors";
import { sampleFile } from "./lib/sampleData";
import { lifecycleApi } from "./datasetLifecycleApi";
import { Button } from "./components/ui/button";
import { useAuth } from "./lib/auth";
import { pageAccess } from "./lib/access";
import ViewerHome from "./components/ViewerHome";
import PanelLayout, {useNarrow} from "./components/PanelLayout";
import FilesPanel from "./components/FilesPanel";
import PeoplePage from "./components/PeoplePage";
import SecurityLogPage from "./components/SecurityLogPage";
import ChangePasswordPage from "./components/ChangePasswordPage";
export default function App(){return <AdminToolsProvider><ToastProvider><ProjectProvider><ActiveDatasetProvider><DialogAccessibility/><WorkspaceApp /></ActiveDatasetProvider></ProjectProvider></ToastProvider></AdminToolsProvider>}
function WorkspaceApp() {
  const context=useActiveDataset()!;
  const {datasets:allDatasets,loading,error,refresh:load}=context;
  const admin=useAdminTools();
  const narrow=useNarrow();
  const auth=useAuth();
  // Owner views never list the installed test benchmark (Admin-only).
  const ownerDatasets=useMemo(()=>allDatasets.filter(d=>!d.is_benchmark),[allDatasets]);
  const datasets=useMemo(()=>ownerDatasets.filter(d=>!d.archived_at),[ownerDatasets]);
  const [inspecting,setInspecting]=useState<Dataset|null>(null);
  useEffect(()=>setInspecting(null),[context.activeId]);
  const selected=inspecting?.archived_at?allDatasets.find(d=>d.id===inspecting.id)||context.active:context.active;

  const [importOpen,setImportOpen]=useState(false),[profileRevision,setProfileRevision]=useState(0),[editorEpoch,setEditorEpoch]=useState(0);
  const [uploading,setUploading]=useState(false),
    [uploadError,setError]=useState(""),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("Data preview"),
    [module, setModule] = useState(bookmarkedPage),
    [menu, setMenu] = useState(false),
    [drag, setDrag] = useState(false),
    [notice, setNotice] = useState("");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("insightiq-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  function collapse(value: boolean) {
    setCollapsed(value);
    try {
      localStorage.setItem("insightiq-sidebar-collapsed", String(value));
    } catch {
      /* Storage is optional. */
    }
  }
  const input = useRef<HTMLInputElement>(null);
  const [pendingUpload,setPendingUpload]=useState("");
  const afterUpload=useRef(false);
  const [progress,setProgress]=useState<UploadProgress|null>(null);
  const limits=useUploadLimits();
  const stillWorking=useStillWorking(!!progress&&progress.phase==="processing",6000);
  useEffect(()=>{if(pendingUpload&&allDatasets.some(d=>d.id===pendingUpload)){void context.select(pendingUpload);setPendingUpload("")}},[pendingUpload,allDatasets,context]);
  const [editorDirty, setEditorDirty] = useState(false);
  const editorChanged=useCallback((dirty:boolean)=>{setEditorDirty(dirty);if(dirty)setNotice("")},[]);
  const confirmEditorLeave=context.confirmEditorLeave;
  const [homeRunId,setHomeRunId]=useState("");
  const [homeQuestion,setHomeQuestion]=useState("");
  const [historyOpen,setHistoryOpen]=useState(false);
  const [homeDashboardId,setHomeDashboardId]=useState("");
  const moduleRef=useRef(module);moduleRef.current=module;
  const access=pageAccess(module,auth.role);          // login on: what this role may open; login off: everything, as before
  const navigate = useCallback(async(next: React.SetStateAction<string>) => {
    if(await confirmEditorLeave()){
      setEditorDirty(false);
      setHomeRunId("");setHomeDashboardId("");setHomeQuestion("");
      setModule(previous=>{const value=typeof next==='function'?next(previous):next;window.history.replaceState(null,'',`#${pageRoutes[value]||value}`);return value});
    }else window.history.replaceState(null,'',`#${pageRoutes[moduleRef.current]}`);
  },[confirmEditorLeave]);
  useEffect(()=>{const change=()=>{if(window.location.hash!=='#main-content')navigate(bookmarkedPage())};window.addEventListener('hashchange',change);window.addEventListener('popstate',change);return()=>{window.removeEventListener('hashchange',change);window.removeEventListener('popstate',change)}},[navigate]);
  async function upload(file?: File) {
    if (!file || !await confirmEditorLeave()) return;
    setError("");
    setNotice("");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError(plainUploadError("Select a .csv file."));
      return;
    }
    if (file.size > limits.mb * 1024 * 1024) {
      setError(plainUploadError(`Maximum upload size is ${limits.mb} MB.`));
      return;
    }
    setUploading(true);
    try {
      const item = await api.upload(file, setProgress);
      await load();
      window.dispatchEvent(new Event("insightiq:datasets-changed"));
      setPendingUpload(item.id);
      setNotice(`${item.name} imported successfully.`);
      setImportOpen(false);setTab("Data preview");setProfileRevision(v=>v+1);
      if (afterUpload.current) { afterUpload.current = false; void navigate("AI Analyst"); }       // first run from Home: straight on to the first question
    } catch (e) {
      setError(plainUploadError((e as Error).message));
    } finally {
      setUploading(false);
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }
  /** Home, empty workspace: "Upload a dataset" opens the import window; when the file is in, the owner lands on Ask. */
  async function startFirstUpload() { afterUpload.current = true; await navigate("Data workspace"); setImportOpen(true); }
  /** "Try sample data": adds the built-in fictional shop file only now, marks it as sample data, and goes to Ask. Never touches the owner's files. */
  async function trySample() {
    setError(""); setNotice(""); setUploading(true);
    try {
      const item = await api.upload(sampleFile());
      await lifecycleApi.bulkSample([item.id], true);
      await load();
      window.dispatchEvent(new Event("insightiq:datasets-changed"));
      setPendingUpload(item.id);
      await navigate("AI Analyst");
    } catch (e) { setError(plainUploadError((e as Error).message)); await navigate("Data workspace"); } finally { setUploading(false); }
  }
  const viewedId=selected?.id,viewProfile=context.viewProfile;
  useEffect(()=>{if(module==='Data workspace'&&tab==='Schema'&&viewedId)viewProfile(viewedId)},[module,tab,viewedId,viewProfile]);
  useEffect(()=>{const review=()=>setTab('Schema');window.addEventListener('insightiq:review-profile',review);return()=>window.removeEventListener('insightiq:review-profile',review)},[]);
  const importDrop=(<section
                className={drag ? "upload-zone dragging" : "upload-zone"}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  if (!uploading) void upload(e.dataTransfer.files[0]);
                }}
                aria-label="CSV import"
              >
                <span className="upload-icon">
                  {uploading ? (
                    <Loader2 className="spin" size={25} />
                  ) : (
                    <UploadCloud size={26} />
                  )}
                </span>
                <div>
                  <h2>
                    {uploading ? "Importing your dataset…" : "Upload a CSV"}
                  </h2>
                  <p>
                    {uploading
                      ? (progress?.phase === "sending" ? `Uploading… ${Math.round((progress.loaded / Math.max(1, progress.total)) * 100)}%` : stillWorking ? "Still working. Large files can take a minute or two. You can keep this window open." : "Reading and checking your file…")
                      : "Drop a file here or choose one."}
                  </p>
                  {uploading && <progress className="upload-progress" aria-label="Upload progress" max={100} value={progress?.phase === "sending" ? Math.round((progress.loaded / Math.max(1, progress.total)) * 100) : undefined} />}
                  <div className="upload-meta">
                    CSV format <span>·</span> Up to {limits.mb} MB <span>·</span> {limits.rows.toLocaleString("en-US")}
                    rows <span className="utf">· UTF-8 encoded</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  disabled={uploading}
                  onClick={() => input.current?.click()}
                >
                  <Plus size={16} />
                  {uploading ? "Importing…" : "Choose file"}
                </Button>
              </section>);
  const activeModule = modules.find((m) => m.name === module) || modules[0];
  return (
    <div className={collapsed ? "app nav-collapsed" : "app"}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        module={module}
        collapsed={collapsed}
        setCollapsed={collapse}
        menu={menu}
        setModule={navigate}
        setMenu={setMenu}
      />
      {menu && (
        <button
          className="nav-backdrop"
          aria-label="Dismiss navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main">
        <header>
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            aria-controls="workspace-navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
          {!(module==="Data workspace"&&!narrow&&ownerDatasets.length>0)&&<ProjectSwitcher onManage={() => void navigate("Projects")} canManage={pageAccess("Projects", auth.role).allowed} />}
          <div className="account-slot" data-slot="account" />
          <div className="header-right">
            <TopMenu current={module} onNavigate={page=>void navigate(page)} onSignOut={()=>{void confirmEditorLeave().then(ok=>{if(ok)void auth.signOut()})}} />
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {context.notice&&<div role="status" className="dataset-fallback-notice">{context.notice}<Button variant="ghost" onClick={context.clearNotice}>Dismiss</Button></div>}
          {context.jobs.length>0&&<aside className="running-dataset-jobs" aria-label="Running jobs">{context.jobs.map(job=><p key={job.id}>{job.kind} running · <DatasetName datasetId={job.datasetId} name={job.name}/> · continues using this dataset</p>)}</aside>}

          <ErrorBoundary key={module}>
          {!access.allowed ? (
            <>
              <PageHeader title="Not available" description={access.reason==="hosted"||access.reason==="signin"?`${pageLabel(module)} is not available here.`:`${pageLabel(module)} is not available for your role.`} />
              <Card className="admin-hidden-card">
                <p>{access.reason==="hosted"?"This area is not part of the hosted app.":access.reason==="signin"?"This page needs sign-in, and sign-in is not turned on for this app.":"Ask an owner if you need access to it."}</p>
                <Button onClick={()=>void navigate("Overview")}>Go to Home<ArrowRight size={16} /></Button>
              </Card>
            </>
          ) : module === "Data workspace" ? (
            <>
              <PageHeader
                className="datasets-header"
                title={pageLabel("Data workspace")}
              />
              <input
                ref={input}
                className="sr-only"
                type="file"
                aria-label="Upload CSV file"
                accept=".csv,text/csv"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
              {(error||(!importOpen&&uploadError)) && (
                <ErrorState as="div" role="alert" className="alert" details={JSON.stringify({workspace:module,error:error||uploadError},null,2)}>
                  {error||uploadError}{" "}
                  <Button variant="ghost" onClick={() => void load()}>
                    Refresh catalog
                  </Button>
                </ErrorState>
              )}
              {notice && (
                <div role="status" className="success">
                  <Check size={16} />
                  {notice}
                </div>
              )}
              {!loading&&!ownerDatasets.length&&importDrop}
              {importOpen&&<ImportDialog busy={uploading} error={uploadError} onClose={()=>setImportOpen(false)}>{importDrop}</ImportDialog>}
              {loading && <LoadingState as="p" role="status">Loading datasets…</LoadingState>}
              <PanelLayout title="Files" label="Files" className="datasets-panel-layout" hidden={ownerDatasets.length===0} panel={close=><FilesPanel datasets={ownerDatasets} selected={selected} query={query} setQuery={setQuery} uploading={uploading} canManageProjects={pageAccess("Projects", auth.role).allowed} onUpload={()=>{setError("");setImportOpen(true)}} onRefresh={()=>void load()} onSelect={d=>{if(d.archived_at){void confirmEditorLeave().then(ok=>{if(ok)setInspecting(d)})}else{setInspecting(null);void context.select(d.id)}}} onChanged={load} onNavigate={navigate} allowNavigation={confirmEditorLeave} onHistory={d=>{if(selected?.id===d.id){setHistoryOpen(true);return}void confirmEditorLeave().then(async ok=>{if(!ok)return;if(d.archived_at)setInspecting(d);else{setInspecting(null);if(!await context.select(d.id))return}setHistoryOpen(true)})}} onManage={()=>void navigate("Projects")} close={close}/>}>
              <div className="datasets-stack">
                {ownerDatasets.length>0&&<Card className="detail-panel" aria-label="Dataset explorer">
                  {selected ? (
                    <>
                      {selected.archived_at&&<p className="dataset-override">Using a different dataset from the global selection (archived dataset inspection). <Button variant="ghost" onClick={()=>setInspecting(null)}>Use global</Button></p>}
                      <div className="detail-heading">
                        <div className="detail-name">
                          <span className="file-icon">
                            <Table2 size={20} />
                          </span>
                          <div>
                            <h2><DatasetName name={displayName(selected)} /></h2>
                            <p>
                              {formatNumber(selected.rows)} records{" "}
                              <span>·</span> {formatNumber(selected.columns.length)} columns
                            </p>
                          </div>
                        </div>
                      </div>
                      {selected.display_name&&selected.display_name!==selected.name&&<p className="dataset-original-name">Original file: {selected.name}</p>}
                      <DatasetHealth key={selected.id} id={selected.id} revision={profileRevision}/>
                      <DatasetCurrency key={"cur-"+selected.id} id={selected.id} revision={profileRevision} onChange={()=>void navigate("Knowledge base")}/>
                      <DatasetTabs value={tab} onChange={setTab}/>
                      <div
                        id="dataset-panel"
                        role="tabpanel"
                        aria-labelledby={datasetTabId(tab)}
                      >
                        {tab === "Schema"&&<DatasetProfile key={selected.id} dataset={selected} revision={profileRevision} onEditDescriptions={()=>void navigate("Knowledge base")}/>}
                        <div hidden={tab !== "Data preview"}>
                          <DatasetEditor
                            key={`${selected.id}:${editorEpoch}`}
                            dataset={selected}
                            showExport={false}
                            onDirty={editorChanged}
                            onSaved={() => {setProfileRevision(v=>v+1);void load()}}
                          />
                        </div>
                      </div>
                      <Drawer open={historyOpen} title="Version history" onClose={()=>setHistoryOpen(false)}>
                        <DatasetHistory key={selected.id} dataset={selected} dirty={editorDirty} revision={profileRevision} onRestored={()=>{setProfileRevision(v=>v+1);setEditorEpoch(v=>v+1);void load()}}/>
                      </Drawer>
                    </>
                  ) : (
                    <EmptyState className="explorer-empty" title="No dataset selected" icon={<Table2 size={24} />}>
                      Choose a dataset from the table to see its rows and columns.
                    </EmptyState>
                  )}
                </Card>}
              </div>
              </PanelLayout>
            </>
          ) : module === "Overview" ? (
            auth.role==="viewer"?<ViewerHome onOpenDashboard={async id=>{await navigate("Dashboards");setHomeDashboardId(id)}} />:<Overview datasets={datasets} onNavigate={navigate} onUpload={()=>void startFirstUpload()} onSample={()=>void trySample()} sampleBusy={uploading} onOpenDashboard={async id=>{await navigate("Dashboards");setHomeDashboardId(id)}} onOpenRun={async run=>{if(!await context.select(run.dataset_id))return;await navigate("AI Analyst");setHomeRunId(run.id)}} onAsk={async question=>{await navigate("AI Analyst");setHomeQuestion(question)}} />
          ) : module === "Dashboards" ? (
            <DashboardPage initialDashboardId={homeDashboardId} />
          ) : adminPages.has(module) && !admin.enabled ? (
            <>
              <PageHeader title="Admin tools are hidden" description={`${pageLabel(module)} is a developer tool. It stays hidden from owners while the switch is off.`} />
              <Card className="admin-hidden-card">
                <Wrench size={24} aria-hidden="true" />
                <p>{ADMIN_NOTICE}</p>
                <Button onClick={()=>admin.setEnabled(true)}>Show admin tools</Button>
              </Card>
            </>
          ) : module === "People" ? (
            <PeoplePage />
          ) : module === "Security log" ? (
            <SecurityLogPage />
          ) : module === "Change password" ? (
            <ChangePasswordPage />
          ) : module === "Evaluation center" ? (
            <><AdminBanner /><EvaluationPage onDatasetChange={() => void load()} /></>
          ) : module === "Run analytics" ? (
            <><AdminBanner /><AnalyticsPage datasets={allDatasets} /></>
          ) : module === "Knowledge base" ? (
            <KnowledgeEditor key={context.activeId}
              datasets={ownerDatasets}
              onManage={()=>navigate("Data workspace")}
            />
          ) : module === "AutoML Studio" ? (
            <AutoMLStudio datasets={datasets} onUpload={()=>navigate("Data workspace")} />
          ) : module === "Change history" ? (
            <ChangeHistoryPage datasets={ownerDatasets} banner={<AdminBanner />} />
          ) : module === "Backup info" ? (
            <BackupInfoPage banner={<AdminBanner />} />
          ) : module === "Execution traces" ? (
            <><AdminBanner /><ExecutionTracesPage datasets={allDatasets} /></>
          ) : module === "AI Analyst" ? (
            <Analyst key={context.activeId}
              datasets={datasets}
              initialRunId={homeRunId}
              initialQuestion={homeQuestion}
              onQuestionUsed={()=>setHomeQuestion("")}
              initialDataset={selected?.id}
              onWorkspace={() => navigate("Data workspace")}
            />
          ) : module === "Settings" ? (
            <WorkspaceSettings />
          ) : module === "Projects" ? (
            <ProjectsPage />
          ) : module === "Design" && import.meta.env.DEV ? (
            <DesignPage />
          ) : (
            <EmptyState title="Page not found" icon={<activeModule.icon size={24} />} action={<Button onClick={() => navigate("Overview")}>Go to Home<ArrowRight size={16} /></Button>}>
              This page is not available.
            </EmptyState>
          )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  note: string;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong className="stat-value">{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function formatBytes(n: number) {
  return n >= 1024 * 1024
    ? `${formatNumber(n / 1024 / 1024, { decimals: 1 })} MB`
    : n >= 1024
      ? `${formatNumber(n / 1024, { decimals: 1 })} KB`
      : `${formatNumber(n)} B`;
}

function AdminBanner(){const notice=useAdminNotice();return <p className="admin-banner" role="note"><Wrench size={16} aria-hidden="true"/> {notice}</p>}

function ImportDialog({children,busy,error,onClose}:{children:React.ReactNode;busy:boolean;error:string;onClose:()=>void}){
 return <Modal open title="Import CSV" busy={busy} onClose={onClose} closeLabel="Close import" className="dataset-import-dialog">{error&&<ErrorState as="p" role="alert" className="alert">{error}</ErrorState>}{children}</Modal>
}
