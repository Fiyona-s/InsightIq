import {ErrorState} from "./WorkspaceStates";
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {Widget} from '../phase4api';
import {request} from '../api';
import {currencies,setCurrencyQuotes,type Quote} from '../lib/currency';
import {Button} from './ui/button';
import {Modal} from './ui/overlay';
import {tileTitle} from "../lib/tileTitle";
export function WidgetTitle({widget,disabled,onSave}:{widget:Widget;disabled:boolean;onSave:(title:string|null)=>Promise<void>}){
 const [editing,setEditing]=useState(false),[value,setValue]=useState(''),[error,setError]=useState('');
 async function save(){const text=value.trim();if(!text||text.length>120||/\p{C}/u.test(text)){setError('Use 1 to 120 characters without control characters.');return}try{await onSave(text);setEditing(false)}catch(e){setError((e as Error).message)}}
 return <div className="widget-title"><h2>{editing?<input aria-label="Widget title" autoFocus value={value} maxLength={121} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void save()}if(e.key==='Escape'){setEditing(false);setError('')}}}/>:<button className="widget-title-button" disabled={disabled} title="Edit chart title" onClick={()=>{setValue(tileTitle(widget));setEditing(true)}}>{tileTitle(widget)}</button>}</h2>
 {editing&&<><Button disabled={disabled} onClick={()=>void save()}>Save title</Button><Button variant="ghost" onClick={()=>setEditing(false)}>Cancel title edit</Button></>}
 {!!widget.custom_title&&!editing&&<Button disabled={disabled} variant="ghost" onClick={()=>void onSave(null).catch(e=>setError(e.message))}>Reset to default</Button>}
 {error&&<ErrorState as="p" role="alert">{error}</ErrorState>}</div>;
}
export function DashboardMenu({children}:{children:ReactNode}){
 const [open,setOpen]=useState(false);const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(open)menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()},[open]);
 function close(){setOpen(false);trigger.current?.focus()}
 return <div className="dashboard-overflow" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close()}if(open&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)')||[]);const index=items.indexOf(document.activeElement as HTMLElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowUp'?-1:1)+items.length)%items.length]?.focus()}}}>
 <Button ref={trigger} variant="outline" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}>More actions</Button>
 {open&&<div ref={menu} role="menu" aria-label="Dashboard actions" onClick={e=>{if((e.target as HTMLElement).closest('[role=menuitem]'))close()}}>{children}</div>}
 </div>;
}
export function DuplicateDialog({onChoice,disabled}:{onChoice:(action:'replace'|'add_anyway'|'cancel')=>void;disabled:boolean}){
 return <Modal open title="Possible duplicate" label="Possible duplicate" busy={disabled} onClose={()=>onChoice('cancel')}
  footer={<><Button disabled={disabled} variant="outline" onClick={()=>onChoice('cancel')}>Cancel</Button><Button disabled={disabled} variant="outline" onClick={()=>onChoice('add_anyway')}>Add anyway</Button><Button disabled={disabled} onClick={()=>onChoice('replace')}>Replace</Button></>}>
  <p>This dashboard already has the same dataset, query and chart type.</p><p>Replace keeps the previous snapshot in history.</p>
 </Modal>;
}
const currencyKey=(dashboardId:string)=>'insightiq-dashboard-currency:'+dashboardId;
/** Display-currency choice remembered per dashboard in this browser only. Reads and writes never throw; a value that is no longer a listed currency is ignored. */
export function savedDashboardCurrency(dashboardId:string):string{try{const value=localStorage.getItem(currencyKey(dashboardId));return value&&(currencies as readonly string[]).includes(value)?value:''}catch{return ''}}
function rememberDashboardCurrency(dashboardId:string,value:string){try{if(value)localStorage.setItem(currencyKey(dashboardId),value);else localStorage.removeItem(currencyKey(dashboardId))}catch{/* optional preference: the choice still applies for this visit */}}
export function DashboardCurrency({dashboardId,widgets,onTarget}:{dashboardId:string;widgets:Widget[];onTarget:(value:string)=>void}){
 const [target,setTargetState]=useState(()=>savedDashboardCurrency(dashboardId)),setTarget=(value:string)=>{setTargetState(value);rememberDashboardCurrency(dashboardId,value)},[quotes,setQuotes]=useState<Quote[]>([]),[errors,setErrors]=useState<string[]>([]),[busy,setBusy]=useState(false);const generation=useRef(0);
 const signature=JSON.stringify(widgets.map(w=>({id:w.id,columns:w.result?.columns.map(c=>c.money)})));
 useEffect(()=>{let current=true;const value=JSON.parse(signature) as {id:string;columns:({currency:string|null;mixed?:boolean}|null)[]|undefined}[];
 const ticket=++generation.current;setErrors([]);setQuotes([]);
 value.forEach(w=>setCurrencyQuotes(w.id,{}));onTarget(target);
 if(!target){setBusy(false);return()=>{current=false}}
 setBusy(true);
 const sources=[...new Set(value.flatMap(w=>w.columns?.filter(c=>c?.currency&&!c.mixed).map(c=>c!.currency!)||[]))].filter(s=>s!==target);
 void Promise.all(sources.map(async source=>{try{return {source,quote:await request<Quote>('/currency/convert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_currency:source,target_currency:target,amounts:['1']})})}}catch(e){return {source,error:(e as Error).message}}})).then(results=>{if(!current||generation.current!==ticket)return;const successful=Object.fromEntries(results.filter(r=>r.quote).map(r=>[r.source,r.quote!]));value.forEach(w=>setCurrencyQuotes(w.id,successful));setQuotes(Object.values(successful));setErrors(results.filter(r=>r.error).map(r=>`${r.source} → ${target}: ${r.error}. Original currency retained.`));setBusy(false)});
 return()=>{current=false};
 },[target,signature,onTarget]);
 return <div className="dashboard-currency"><label>Display currency<select aria-label="Report currency" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Original currencies</option>{currencies.map(c=><option key={c}>{c}</option>)}</select></label>
 {busy&&<small role="status">Fetching daily reference rates…</small>}
 {quotes.map(q=><small key={q.source_currency}>1 {q.source_currency} = {q.rate} {q.target_currency} · {q.effective_date} · {q.rate_source}</small>)}
 {errors.map(e=><ErrorState as="p" role="alert" key={e}>{e}</ErrorState>)}
 {target&&widgets.some(w=>w.result&&!w.result.columns.some(c=>c.money?.currency&&!c.money.mixed))&&<small>No confirmed currency on some charts; those values stay unconverted.</small>}
 </div>;
}
