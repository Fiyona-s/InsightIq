import {ErrorState} from "./WorkspaceStates";
import {formatDate} from "../lib/formatters";
import {useEffect,useState} from 'react';
import type {Dataset} from '../api';
import {lifecycleApi,type Dependencies,type Outcome} from '../datasetLifecycleApi';
import {displayName} from '../lib/datasetNames';
import {formatNumber} from '../lib/formatters';
import {Button} from './ui/button';
import {Modal} from './ui/overlay';
const groups:Record<string,[string,string]>={dashboards:['dashboards','Dashboards'],saved_charts:['saved charts','Dashboards'],saved_questions:['saved questions','Execution traces'],experiments:['model experiments','AutoML Studio'],models:['trained models','AutoML Studio'],predictions:['saved predictions','AutoML Studio'],knowledge_entries:['definitions and verified examples','Knowledge base'],evaluations:['evaluation runs','Evaluation center'],benchmark_records:['controlled benchmark installations','Evaluation center'],rag_indexes:['search indexes','Knowledge base'],active_jobs:['active jobs','Execution traces']};
function countLabel(key:string,count:number){const label=groups[key][0];return `${formatNumber(count)} ${count===1 ? ({knowledge_entries:'definition or verified example',benchmark_records:'controlled benchmark installation',rag_indexes:'search index'}[key] || label.replace(/s$/,'')) : label}`;}
export default function DatasetLifecycleDialog({datasets,action,bulkAction=false,onClose,onChanged,onNavigate}:{datasets:Dataset[];bulkAction?:boolean;action:'archive'|'delete';onClose:()=>void;onChanged:()=>Promise<void>;onNavigate:(module:string)=>void}){
 const [deps,setDeps]=useState<Dependencies[]|null>(null),[error,setError]=useState(''),[typed,setTyped]=useState(''),[ack,setAck]=useState(false),[benchmarkAck,setBenchmarkAck]=useState(false),[busy,setBusy]=useState(false),[outcomes,setOutcomes]=useState<Outcome[]|null>(null);
 const bulk=bulkAction||datasets.length>1;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;let current=true;Promise.all(datasets.map(d=>lifecycleApi.dependencies(d.id))).then(v=>{if(current)setDeps(v)}).catch(e=>{if(current)setError(e.message)});return()=>{current=false;previous?.focus()};},[datasets]);
 const blocked=deps?.some(d=>d.delete_blocked),hasDeps=deps?.some(d=>d.has_dependencies),benchmark=deps?.some(d=>d.benchmark_required);
 const confirmation=bulk?'DELETE':displayName(datasets[0]);
 async function perform(kind:'archive'|'delete'){
  setBusy(true);setError('');try{
   const items=datasets.map(d=>({id:d.id,confirm_name:displayName(d),acknowledge_dependencies:ack,acknowledge_benchmark:benchmarkAck}));
   const result=kind==='archive'?(bulk?await lifecycleApi.bulkArchive(datasets.map(d=>d.id)):(await lifecycleApi.archive(datasets[0].id),[{id:datasets[0].id,status:'success' as const,reason:null}])):bulk?await lifecycleApi.bulkDelete(items):(await lifecycleApi.delete(datasets[0].id,{confirm_name:items[0].confirm_name,acknowledge_dependencies:ack,acknowledge_benchmark:benchmarkAck}),[{id:datasets[0].id,status:'success' as const,reason:null}]);
   setOutcomes(result);await onChanged();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const title=`${action==='archive'?'Archive':'Delete'} ${bulk?`${formatNumber(datasets.length)} datasets`:displayName(datasets[0])}`;
 const canDelete=!(busy||typed!==confirmation||(!bulk&&!!blocked)||(!!hasDeps&&!ack)||(!!benchmark&&!benchmarkAck));
 const footer=outcomes?<Button variant="outline" disabled={busy} onClick={onClose}>Done</Button>:<><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>{deps&&action==='delete'&&<Button variant="danger" disabled={!canDelete} onClick={()=>void perform('delete')}>Delete permanently</Button>}{deps&&<Button disabled={busy} onClick={()=>void perform('archive')}>Archive{bulk?' selected':''}</Button>}</>;
 return <Modal open title={title} busy={busy} onClose={onClose} footer={footer} className="lifecycle-modal">
  <ul>{datasets.map(d=><li key={d.id}>{displayName(d)}{d.display_name&&<small> ({d.name})</small>}</li>)}</ul>
  {error&&<ErrorState as="p" role="alert">{error}</ErrorState>}
  {!deps&&!error&&<p role="status">Checking dependencies…</p>}
  {deps&&<>
   <p>{hasDeps?'Archive keeps your data available to restore. It is the recommended action.':'No saved dependencies found. Archive keeps the dataset available to restore.'}</p>
   {deps.map(d=><section key={d.dataset_id} aria-label={`Dependencies for ${d.name}`}>
    {bulk&&<h3>{d.name}</h3>}
    <p>{Object.entries(d.counts).filter(([,count])=>count).map(([key,count])=>countLabel(key,count)).join(' · ')||'No saved dependencies'}</p>
    {Object.entries(d.groups).filter(([,entries])=>entries.length).map(([key,entries])=><details key={key}><summary>{countLabel(key,entries.length)}</summary><ul>{entries.map((entry,i)=><li key={entry.id+':'+i}><a href={`#${key}/${entry.id}`} onClick={event=>{event.preventDefault();onClose();onNavigate(groups[key][1])}}>{entry.title}</a>{entry.timestamp&&<small> · {formatDate(entry.timestamp, "datetime")}</small>}</li>)}</ul></details>)}
    {d.benchmark_warning&&<p className="lifecycle-warning">{d.benchmark_warning}</p>}
   </section>)}
   {action==='delete'&&!outcomes&&<>
    <p>Removes dataset data, definitions and its search index. Dashboard snapshots, run history, evaluation records, trained models and saved predictions remain with their original provenance.</p>
    {hasDeps&&<label className="lifecycle-check"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} /> I acknowledge these dependencies and retained historical records.</label>}
    {benchmark&&<label className="lifecycle-check"><input type="checkbox" checked={benchmarkAck} onChange={e=>setBenchmarkAck(e.target.checked)} /> I understand that Evaluation will become unavailable.</label>}
    {blocked&&<ErrorState as="p" role="alert">Delete is blocked: wait for or cancel active jobs. Other selected datasets can still be processed in a bulk action.</ErrorState>}
    <label>Type {confirmation} to confirm{bulk?` deletion of ${formatNumber(datasets.length)} datasets`:''}<input aria-label="Delete confirmation" value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off" /></label>
   </>}
   {outcomes&&<div role="status"><h3>Results</h3><ul>{outcomes.map(r=><li key={r.id}>{displayName(datasets.find(d=>d.id===r.id)!)}: {r.status}{r.reason?` — ${r.reason}`:''}</li>)}</ul></div>}
  </>}
 </Modal>;
}
